import { api, session, setNetworkLostHandler, setUnauthorizedHandler, lastSyncAt } from './api.ts';
import { PRODUCT_NAME } from './brand.ts';
import { ApiError } from './errors.ts';
import { errorText } from './error-text.ts';
import { t } from './i18n.ts';
import { installInput, type NavState } from './input.ts';
import { loginView } from './login.ts';
import { resolve, routes } from './routes.ts';
import { bootStage, bootView } from './screens/boot.ts';
import { RETRY_EVERY_S, offlineView, type OfflineState } from './screens/offline.ts';
import { slideDirection } from './motion.ts';
import { preloadScenes } from './scenes.ts';
import { TABS, type Screen } from './screen.ts';
import { fitStage, mount, showScreen, withLoading } from './shell.ts';
import { loadSnapshot, type BootStep, type Snapshot } from './snapshot.ts';
import { additionalOnboarding, freshOnboarding, onboardingState, runOnboarding, type OnboardingRun } from './onboarding.ts';
import type { Onboarding } from './onboarding-types.ts';
import { h, notify } from './ui.ts';

const root = document.getElementById('app')!;
let snap: Snapshot | null = null;
let nav: NavState = null;
/** What is on screen (its tab and whether it is the offline screen), to pick the enter animation; null = no HUD screen (login, loading). */
let shown: { tab: Screen['tab']; offline: boolean } | null = null;
let showSeq = 0;
let offline: (OfflineState & { timer: number; tick: (now: number) => void }) | null = null;
let wizard: OnboardingRun | null = null;
let obSupported = false;

installInput({ state: () => nav, go: (hash) => { location.hash = hash; } });
fitStage();
void preloadScenes();
window.addEventListener('resize', fitStage);

function signedOut(): void {
  stopOnboarding();
  stopOffline();
  snap = null;
  nav = null;
  shown = null;
  loginView(root, () => { location.hash = '#dashboard'; void boot(); });
}
setUnauthorizedHandler(() => { session.signOut(); signedOut(); notify(t('session.ended'), 'error'); });
setNetworkLostHandler(() => { if (snap && !offline) startOffline(); });

/** Load the account and what the shell needs, showing progress; if the server cannot be reached, fall back to the login screen, whose server check explains why and offers a retry. */
async function boot(): Promise<void> {
  const seen = new Set<BootStep>();
  const draw = (partial: Partial<Snapshot>): void => { shown = null; mount(root, bootStage(bootView(partial, seen))); };
  draw({});
  try {
    const ob = await onboardingState();
    obSupported = ob.supported;
    if (ob.pending) return beginOnboarding(ob.pending, false);
    snap = await loadSnapshot((step, partial) => { seen.add(step); draw(partial); });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'no_company') return beginOnboarding(freshOnboarding(), false);
    if (!(e instanceof ApiError && (e.status === 401 || e.code === 'network'))) notify(errorText(e), 'error');
    return signedOut();
  }
  await show(true);
}

// ------------------------------------------------------------------ onboarding (lot fe-onboarding): the six-step wizard replaces the HUD screens while it runs

function stopOnboarding(): void {
  wizard?.stop();
  wizard = null;
}

function beginOnboarding(ob: Onboarding, additional: boolean): void {
  stopOnboarding();
  const before = session.company;
  stopOffline();
  nav = null;
  wizard = runOnboarding({
    root,
    setNav: (n) => { nav = n; },
    onDone: (dest) => { stopOnboarding(); history.replaceState(null, '', dest); void refresh().catch((e) => { notify(errorText(e), 'error'); signedOut(); }); },
    onQuit: (add) => {
      stopOnboarding();
      if (add && snap) { session.company = before; history.replaceState(null, '', '#dashboard'); void refresh().catch((e) => notify(errorText(e), 'error')); } else { session.signOut(); signedOut(); }
    },
  }, ob, additional);
}

async function refresh(): Promise<void> {
  snap = await loadSnapshot();
  await show();
}

async function switchCompany(id: number): Promise<void> {
  session.company = id;
  try {
    await refresh();
  } catch (e) {
    notify(errorText(e), 'error');
  }
}

async function logout(remote: boolean): Promise<void> {
  stopOffline();
  if (remote) await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  session.signOut();
  signedOut();
}

/** Draw the screen of the current hash. `navigate` = the player moved here (enter animation, skeleton while it loads); otherwise it is a redraw of the screen already shown, which keeps the old one up until the new is ready and does not animate. */
async function show(navigate = false): Promise<void> {
  if (wizard) return;
  if (!snap) return signedOut();
  if (offline) return showOffline();
  const current = snap;
  const seq = ++showSeq;
  const { name, arg } = resolve(location.hash);
  if (name === 'company' && obSupported) { void additionalOnboarding().then((ob) => { if (!wizard) beginOnboarding(ob, true); }); return; }
  let screen: Screen;
  try {
    const load = routes[name]!({ snap: current, arg, refresh, go: (hash) => { location.hash = hash; } });
    screen = navigate ? await withLoading(load, () => seq === showSeq) : await load;
  } catch (e) {
    if (offline) return; // the connection dropped under us: the offline screen is already up
    screen = { title: t('error.title'), scene: 'dashboard', tab: null, hints: [], back: '#dashboard', view: h('p', { class: 'error-text', role: 'alert' }, errorText(e)) };
  }
  if (snap !== current || seq !== showSeq) return; // signed out, reloaded or navigated elsewhere while this screen was loading
  draw(screen, current, false, navigate);
}

function draw(screen: Screen, s: Snapshot, isOffline: boolean, animate: boolean): void {
  nav = { tab: screen.tab, back: screen.back, keys: screen.keys };
  const view = h('main', { id: 'main', class: `view${screen.wide ? ' wide' : ''}`, tabindex: -1 }, screen.view);
  const enter = animate ? slideDirection(shown?.tab ?? null, screen.tab, TABS) : null;
  showScreen(root, screen.scene, view,
    { me: s.me, tab: screen.tab, antiCheat: s.antiCheat, offline: isOffline, jobCount: s.board.jobs.length, onCompany: (id) => void switchCompany(id), onChangeServer: () => void logout(!isOffline) }, screen.hints, enter);
  shown = { tab: screen.tab, offline: isOffline };
  document.title = `${screen.title} - ${PRODUCT_NAME}`;
}

// ------------------------------------------------------------------ offline: read-only snapshot, retry every 30 s

function stopOffline(): void {
  if (offline) clearInterval(offline.timer);
  offline = null;
}

function startOffline(): void {
  const now = Date.now();
  const state: OfflineState = { since: now, attempt: 1, nextAt: now + RETRY_EVERY_S * 1000, lastSync: lastSyncAt() };
  offline = { ...state, timer: window.setInterval(() => void offlineTick(), 1000), tick: () => undefined };
  showOffline();
}

function showOffline(): void {
  if (!snap || !offline) return;
  const o = offline;
  const { view, tick } = offlineView(snap, o, Date.now(), () => void retry(), () => void logout(false));
  o.tick = tick;
  draw({
    title: t('offline.title'), scene: 'dashboard', tab: 'dashboard', back: null, wide: true, view,
    hints: [{ key: t('key.enter'), label: t('hint.retryNow') }, { key: 'S', label: t('hint.changeServer') }],
    keys: { s: () => void logout(false) },
  }, snap, true, !shown?.offline);
}

async function offlineTick(): Promise<void> {
  if (!offline) return;
  const now = Date.now();
  if (now >= offline.nextAt) await retry();
  else offline.tick(now);
}

let retrying = false;
async function retry(): Promise<void> {
  const o = offline;
  if (!o || retrying) return;
  retrying = true;
  try {
    const fresh = await loadSnapshot();
    if (offline !== o) return;
    stopOffline();
    snap = fresh;
    await show();
  } catch (e) {
    if (offline !== o || !(e instanceof ApiError && e.code === 'network')) return; // a 401 was handled by the session handler
    o.attempt += 1;
    o.nextAt = Date.now() + RETRY_EVERY_S * 1000;
    o.tick(Date.now());
    showOffline();
  } finally {
    retrying = false;
  }
}

window.addEventListener('hashchange', () => { void show(true).then(() => document.getElementById('main')?.focus()); });
/** Redraw the current screen in place (filters, language) and put the focus back where it was. */
window.addEventListener('opc:redraw', () => {
  const id = document.activeElement?.id;
  void show().then(() => { if (id) document.getElementById(id)?.focus(); });
});
/** The Settings screen's "Change" link does what the HUD's does: sign out to pick another server. */
window.addEventListener('opc:change-server', () => void logout(true));
window.addEventListener('opc:lang', () => { if (wizard) wizard.redraw(); else if (snap) void show(); else signedOut(); });

if (session.token) void boot();
else signedOut();
