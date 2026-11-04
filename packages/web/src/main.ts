import type { Me } from '@opc/shared';
import { api, ApiError, session, setUnauthorizedHandler } from './api.ts';
import { loginView } from './login.ts';
import { pages } from './pages.ts';
import { h, notify } from './ui.ts';

const root = document.getElementById('app')!;
let me: Me | null = null;

const pageName = (): string => {
  const p = location.hash.slice(1);
  return p in pages ? p : 'dashboard';
};

function signedOut(): void {
  me = null;
  loginView(root, (m) => { me = m; location.hash = '#dashboard'; void show(); });
}
setUnauthorizedHandler(() => { session.set(session.server, null); signedOut(); notify('Your session ended, please sign in again.', 'error'); });

async function refresh(): Promise<void> {
  me = await api<Me>('/me');
  await show();
}

async function show(): Promise<void> {
  if (!me) return signedOut();
  const name = pageName();
  const page = pages[name]!;
  const main = h('main', { id: 'main', tabindex: -1, 'aria-busy': 'true' }, h('p', { class: 'muted' }, 'Loading...'));
  const nav = h('nav', { 'aria-label': 'Main' }, Object.entries(pages).map(([key, p]) =>
    h('a', { href: `#${key}`, 'aria-current': key === name ? 'page' : null }, p.title)));
  root.replaceChildren(
    h('header', { class: 'bar' }, h('span', { class: 'brand' }, 'OpenPilotCareer'), nav,
      h('span', { class: 'who' }, `${me.username} - ${me.company.name} - `, h('button', { type: 'button', class: 'link', onclick: () => void logout() }, 'Sign out'))),
    main);
  document.title = `${page.title} - OpenPilotCareer`;
  try {
    main.replaceChildren(await page.render({ me, refresh, go: (p) => { location.hash = `#${p}`; } }));
  } catch (e) {
    main.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, e instanceof ApiError ? e.message : String(e)));
  }
  main.removeAttribute('aria-busy');
}

async function logout(): Promise<void> {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  session.set(session.server, null);
  signedOut();
}

window.addEventListener('hashchange', () => { void show().then(() => document.getElementById('main')?.focus()); });

if (session.token) {
  api<Me>('/me').then((m) => { me = m; return show(); }).catch((e: unknown) => {
    if (!(e instanceof ApiError && e.status === 401)) notify(e instanceof ApiError ? e.message : String(e), 'error');
    signedOut();
  });
} else {
  signedOut();
}
