import { api, GLOBAL_URL, fetchInfo, isOwnOrigin, session } from './api.ts';
import { ApiError } from './errors.ts';
import { normalizeServer } from './server-url.ts';
import { h, field, input } from './ui.ts';
import type { Me } from '@opc/shared';

const CUSTOM = 'custom';
/** Login / register with the server picker. `done` runs once a session exists. */
export function loginView(root: HTMLElement, done: () => void): void {
  const isGlobal = session.server === GLOBAL_URL;
  const globalRadio = input({ type: 'radio', name: 'server', id: 'srv-global', value: 'global', checked: isGlobal });
  const customRadio = input({ type: 'radio', name: 'server', id: 'srv-custom', value: CUSTOM, checked: !isGlobal });
  const url = input({ type: 'url', name: 'url', autocomplete: 'url', placeholder: 'https://opc.example.org', value: isGlobal ? '' : session.server });
  const username = input({ type: 'text', name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 24, pattern: '[A-Za-z0-9_\\-]{3,24}' });
  const password = input({ type: 'password', name: 'password', autocomplete: 'current-password', required: true, minlength: 8 });
  const serverState = h('p', { id: 'server-state', class: 'muted', role: 'status' }, '');
  const register = h('button', { type: 'button', class: 'secondary' }, 'Create account');
  const submit = h('button', { type: 'submit' }, 'Sign in');
  const error = h('p', { class: 'error-text', role: 'alert' });

  const chosen = (): string => normalizeServer(globalRadio.checked ? GLOBAL_URL : url.value);
  const syncUrl = (): void => { url.disabled = !customRadio.checked; url.required = customRadio.checked; };
  syncUrl();

  /** Verify the chosen server speaks OPC and show what it offers. */
  async function check(): Promise<string> {
    const server = chosen();
    const info = await fetchInfo(server);
    serverState.textContent = `${info.name} v${info.version} - ${info.registrationOpen ? 'registration open' : 'registration closed'}`;
    register.disabled = !info.registrationOpen;
    return server;
  }

  async function enter(path: '/auth/login' | '/auth/register'): Promise<void> {
    error.textContent = '';
    try {
      const server = await check();
      const r = await api<Me & { token: string }>(path, { server, auth: false, body: { username: username.value, password: password.value } });
      session.set(server, r.token);
      password.value = '';
      done();
    } catch (e) {
      error.textContent = e instanceof ApiError ? e.message : String(e);
    }
  }

  for (const r of [globalRadio, customRadio]) r.addEventListener('change', () => { syncUrl(); serverState.textContent = ''; });
  url.addEventListener('change', () => { void check().catch((e: unknown) => { serverState.textContent = e instanceof ApiError ? e.message : String(e); }); });
  register.addEventListener('click', () => { if (form.reportValidity()) void enter('/auth/register'); });
  const form = h('form', { class: 'card narrow', onsubmit: (e: Event) => { e.preventDefault(); void enter('/auth/login'); } },
    h('h1', null, 'OpenPilotCareer'),
    h('p', { class: 'muted' }, 'Open-source flight sim career and economy. Accounts exist per server and are not shared between servers.'),
    h('fieldset', null,
      h('legend', null, 'Server'),
      h('div', { class: 'radio' }, globalRadio, h('label', { for: 'srv-global' }, `${isOwnOrigin ? 'This server' : 'Global server'} (${GLOBAL_URL})`)),
      h('div', { class: 'radio' }, customRadio, h('label', { for: 'srv-custom' }, 'Custom server')),
      field('Server URL', url, 'Anyone can self-host; paste the address of the server you want to play on.'),
      serverState),
    field('Username', username),
    field('Password', password, 'At least 8 characters.'),
    error,
    h('div', { class: 'row' }, submit, register));
  root.replaceChildren(h('main', { id: 'main', class: 'center' }, form));
  username.focus();
}
