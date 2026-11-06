import type { Me } from '@opc/shared';
import { api, fetchInfo, session, setUnauthorizedHandler } from './api.ts';
import { PRODUCT_NAME } from './brand.ts';
import { ApiError } from './errors.ts';
import { t } from './i18n.ts';
import { installInput, type NavState } from './input.ts';
import { loginView } from './login.ts';
import { resolve, routes } from './routes.ts';
import { bareView, fitStage, hudStage, stage } from './shell.ts';
import { h, notify } from './ui.ts';

const root = document.getElementById('app')!;
let me: Me | null = null;
let antiCheat = true;
let nav: NavState = null;

installInput({ state: () => nav, go: (hash) => { location.hash = hash; } });
fitStage();
window.addEventListener('resize', fitStage);

function signedOut(): void {
  me = null;
  nav = null;
  document.title = PRODUCT_NAME;
  loginView(root, () => { location.hash = '#dashboard'; void refresh(); });
}
setUnauthorizedHandler(() => { session.set(session.server, null); signedOut(); notify(t('session.ended'), 'error'); });

/** The account as the remembered company: if that company is gone or was never ours (another account on this server), fall back to the default. */
async function loadMe(): Promise<Me> {
  let m: Me;
  try {
    m = await api<Me>('/me');
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'not_your_company')) throw e;
    session.company = null;
    m = await api<Me>('/me');
  }
  session.company = m.company.id;
  antiCheat = await fetchInfo(session.server).then((i) => i.antiCheat, () => true); // a badge is a courtesy: an unreachable /info must not break the page
  return m;
}

async function refresh(): Promise<void> {
  me = await loadMe();
  await show();
}

async function switchCompany(id: number): Promise<void> {
  session.company = id;
  try {
    await refresh();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : String(e), 'error');
  }
}

async function logout(): Promise<void> {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  session.set(session.server, null);
  signedOut();
}

async function show(): Promise<void> {
  if (!me) return signedOut();
  const current = me;
  const { name, arg } = resolve(location.hash);
  let screen;
  try {
    screen = await routes[name]!({ me: current, arg, refresh, go: (hash) => { location.hash = hash; } });
  } catch (e) {
    const message = e instanceof ApiError ? e.message : String(e);
    screen = { title: t('error.title'), scene: 'dashboard' as const, tab: null, hints: [], back: '#dashboard', view: h('p', { class: 'error-text', role: 'alert' }, message) };
  }
  if (me !== current) return; // signed out or switched company while loading
  nav = { tab: screen.tab, back: screen.back };
  const view = h('main', { id: 'main', class: 'view', tabindex: -1 }, screen.view);
  root.replaceChildren(hudStage(screen.scene, view, { me: current, tab: screen.tab, antiCheat, onCompany: (id) => void switchCompany(id), onChangeServer: () => void logout() }, screen.hints));
  document.title = `${screen.title} - ${PRODUCT_NAME}`;
}

window.addEventListener('hashchange', () => { void show().then(() => document.getElementById('main')?.focus()); });
window.addEventListener('opc:lang', () => { if (me) void show(); else signedOut(); });

if (session.token) {
  root.replaceChildren(stage('dashboard', bareView(h('p', { class: 'muted' }, t('common.loading')))));
  loadMe().then((m) => { me = m; return show(); }).catch((e: unknown) => {
    if (!(e instanceof ApiError && e.status === 401)) notify(e instanceof ApiError ? e.message : String(e), 'error');
    signedOut();
  });
} else {
  signedOut();
}
