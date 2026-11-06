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
import type { Screen } from './screen.ts';
import { fitStage, hudStage } from './shell.ts';
import { loadSnapshot, type BootStep, type Snapshot } from './snapshot.ts';
import { h, notify } from './ui.ts';

const root = document.getElementById('app')!;
let snap: Snapshot | null = null;
let nav: NavState = null;
let offline: (OfflineState & { timer: number; tick: (now: number) => void }) | null = null;

installInput({ state: () => nav, go: (hash) => { location.hash = hash; } });
fitStage();
window.addEventListener('resize', fitStage);

function signedOut(): void {
  stopOffline();
  snap = null;
  nav = null;
  loginView(root, () => { location.hash = '#dashboard'; void boot(); });
}
setUnauthorizedHandler(() => { session.set(session.server, null); signedOut(); notify(t('session.ended'), 'error'); });
setNetworkLostHandler(() => { if (snap && !offline) startOffline(); });

/** Load the account and what the shell needs, showing progress; if the server cannot be reached, fall back to the login screen, whose server check explains why and offers a retry. */
async function boot(): Promise<void> {
  const seen = new Set<BootStep>();
  const draw = (partial: Partial<Snapshot>): void => root.replaceChildren(bootStage(bootView(partial, seen)));
  draw({});
  try {
    snap = await loadSnapshot((step, partial) => { seen.add(step); draw(partial); });
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 401 || e.code === 'network'))) notify(errorText(e), 'error');
    return signedOut();
  }
  await show();
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
  session.set(session.server, null);
  signedOut();
}

async function show(): Promise<void> {
  if (!snap) return signedOut();
  if (offline) return showOffline();
  const current = snap;
  const { name, arg } = resolve(location.hash);
  let screen: Screen;
  try {
    screen = await routes[name]!({ snap: current, arg, refresh, go: (hash) => { location.hash = hash; } });
  } catch (e) {
    if (offline) return; // the connection dropped under us: the offline screen is already up
    screen = { title: t('error.title'), scene: 'dashboard', tab: null, hints: [], back: '#dashboard', view: h('p', { class: 'error-text', role: 'alert' }, errorText(e)) };
  }
  if (snap !== current) return; // signed out or reloaded while this screen was loading
  draw(screen, current, false);
}

function draw(screen: Screen, s: Snapshot, isOffline: boolean): void {
  nav = { tab: screen.tab, back: screen.back, keys: screen.keys };
  const view = h('main', { id: 'main', class: `view${screen.wide ? ' wide' : ''}`, tabindex: -1 }, screen.view);
  root.replaceChildren(hudStage(screen.scene, view,
    { me: s.me, tab: screen.tab, antiCheat: s.antiCheat, offline: isOffline, jobCount: s.board.jobs.length, onCompany: (id) => void switchCompany(id), onChangeServer: () => void logout(!isOffline) }, screen.hints));
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
  }, snap, true);
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

window.addEventListener('hashchange', () => { void show().then(() => document.getElementById('main')?.focus()); });
window.addEventListener('opc:lang', () => { if (snap) void show(); else signedOut(); });

if (session.token) void boot();
else signedOut();
