import { API_VERSION, type Me, type ServerInfo } from '@opc/shared';
import { api, GLOBAL_URL, fetchInfo, isOwnOrigin, session } from './api.ts';
import { PRODUCT_NAME } from './brand.ts';
import { badge, brandBlock, button, icon, inputField, keycap, panel, titleBlock } from './components.ts';
import { ApiError } from './errors.ts';
import { errorText } from './error-text.ts';
import { LANGS, getLang, setLang, t } from './i18n.ts';
import { normalizeServer } from './server-url.ts';
import { bareView, stage } from './shell.ts';
import { h } from './ui.ts';

type Probe =
  | { state: 'checking' }
  | { state: 'ok'; info: ServerInfo }
  | { state: 'fail'; code: string };

type Draft = { username: string; password: string; custom: boolean; url: string };

/** One of three outcomes of asking a server who it is: reachable, unreachable, or not one of ours. */
export function probeView(p: Probe, retry: () => void): HTMLElement {
  if (p.state === 'checking') return h('div', { class: 'probe', role: 'status' }, icon('loader-circle', 18), h('span', { class: 'dim' }, t('login.checking')));
  if (p.state === 'ok') {
    const { info } = p;
    const details = [
      `${t('login.version', { v: info.version })}, ${info.apiVersion === API_VERSION ? t('login.compatible') : t('login.apiMismatch', { n: info.apiVersion, expected: API_VERSION })}`,
      info.registrationOpen ? t('login.regOpen') : t('login.regClosed'),
      info.antiCheat ? null : t('login.antiCheatOff'),
    ].filter(Boolean).join(' · ');
    return h('div', { class: 'probe ok', role: 'status' }, icon('circle-check', 18),
      h('div', { class: 'probe-text' }, h('span', { class: 'probe-title' }, info.name), h('span', { class: 'dim' }, details)));
  }
  const unreachable = p.code === 'network';
  const [title, message] = unreachable ? [t('login.probeNetwork'), t('login.probeNetworkMsg')]
    : p.code === 'bad_url' ? [t('login.probeBadUrl'), t('login.probeBadUrlMsg')]
      : [t('login.probeNotOpc', { product: PRODUCT_NAME }), t('login.probeNotOpcMsg', { product: PRODUCT_NAME })];
  return h('div', { class: 'probe fail', role: 'alert' }, icon('circle-alert', 18),
    h('div', { class: 'probe-text' }, h('span', { class: 'probe-title' }, title), h('span', { class: 'dim' }, message)),
    unreachable ? button(t('login.retry'), { icon: 'rotate-cw', variant: 'secondary', onclick: retry }) : null);
}

const languageSelect = (onChange: () => void): HTMLElement => {
  const select = h('select', { id: 'lang', name: 'lang', onchange: (e: Event) => { setLang((e.target as HTMLSelectElement).value as (typeof LANGS)[number]); onChange(); } },
    LANGS.map((l) => h('option', { value: l, selected: l === getLang() }, t(`lang.${l}`))));
  return h('div', { class: 'lang' }, icon('globe', 14), h('label', { for: 'lang' }, t('lang.label')), select);
};

/** Login / register with the server picker. `done` runs once a session exists. */
export function loginView(root: HTMLElement, done: () => void, draft: Draft = { username: '', password: '', custom: session.server !== GLOBAL_URL, url: session.server !== GLOBAL_URL ? session.server : '' }): void {
  const globalRadio = h('input', { type: 'radio', name: 'server', id: 'srv-global', value: 'global', checked: !draft.custom });
  const customRadio = h('input', { type: 'radio', name: 'server', id: 'srv-custom', value: 'custom', checked: draft.custom });
  const { root: urlField, control: url } = inputField({ label: t('login.url'), icon: 'link', hint: t('login.urlHint') },
    { type: 'url', name: 'url', autocomplete: 'url', placeholder: 'https://opc.example.org', value: draft.custom ? draft.url : GLOBAL_URL, disabled: !draft.custom, spellcheck: 'false' });
  urlField.querySelector('label')!.classList.add('sr');
  const { root: userField, control: username } = inputField({ label: t('login.username'), icon: 'user', hint: t('login.usernameHint') },
    { type: 'text', name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 24, pattern: '[A-Za-z0-9_\\-]{3,24}', value: draft.username, spellcheck: 'false' });
  const passwordInput = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, minlength: 8, value: draft.password });
  const reveal = h('button', { type: 'button', class: 'reveal-btn', 'aria-label': t('login.showPassword'), 'aria-pressed': 'false' }, icon('eye', 16));
  reveal.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(show));
    reveal.replaceChildren(icon(show ? 'eye-off' : 'eye', 16));
  });
  const { root: passwordField } = inputField({ label: t('login.password'), icon: 'lock', hint: t('login.passwordHint'), control: passwordInput, trailing: reveal });
  const error = h('p', { class: 'error-text', role: 'alert' });
  const register = button(t('login.register'), { variant: 'secondary', disabled: true });
  const submit = button(t('login.signIn'), { variant: 'primary', type: 'submit', key: t('key.enter') });
  const probeHost = h('div', { class: 'probe-host' });
  const credentials = h('div', { class: 'credentials', hidden: true }, userField, passwordField,
    h('div', { class: 'note' }, icon('info', 14), t('login.perServer')),
    error,
    h('div', { class: 'row' }, submit, register));
  const pending = h('p', { class: 'hint-text' }, t('login.pending'));

  const chosen = (): string => normalizeServer(globalRadio.checked ? GLOBAL_URL : url.value);
  let probeId = 0;
  /** Ask the chosen server who it is; the newest answer wins when several are in flight. */
  async function check(): Promise<string> {
    const id = ++probeId;
    credentials.hidden = true;
    pending.hidden = false;
    probeHost.replaceChildren(probeView({ state: 'checking' }, () => void recheck()));
    let server: string, info: ServerInfo;
    try {
      server = chosen();
      info = await fetchInfo(server);
    } catch (e) {
      if (id === probeId) probeHost.replaceChildren(probeView({ state: 'fail', code: e instanceof ApiError ? e.code : 'network' }, () => void recheck()));
      throw e;
    }
    if (id === probeId) {
      probeHost.replaceChildren(probeView({ state: 'ok', info }, () => void recheck()));
      register.disabled = !info.registrationOpen;
      const first = credentials.hidden;
      credentials.hidden = false;
      pending.hidden = true;
      if (first && (document.activeElement === document.body || document.activeElement === null)) (username.value ? passwordInput : username).focus();
    }
    return server;
  }
  const recheck = (): Promise<void> => check().then(() => undefined, () => undefined);

  async function enter(path: '/auth/login' | '/auth/register'): Promise<void> {
    error.textContent = '';
    try {
      const server = await check();
      const r = await api<Me & { token: string }>(path, { server, auth: false, body: { username: username.value, password: passwordInput.value } });
      session.set(server, r.token);
      passwordInput.value = '';
      done();
    } catch (e) {
      error.textContent = errorText(e);
    }
  }

  const syncUrl = (): void => {
    url.disabled = !customRadio.checked;
    url.required = customRadio.checked;
    url.value = customRadio.checked ? draft.url : GLOBAL_URL;
  };
  for (const r of [globalRadio, customRadio]) r.addEventListener('change', () => {
    if (!customRadio.checked) draft.url = url.value; // remember the typed address while the global server is selected
    syncUrl();
    if (customRadio.checked) { url.focus(); if (url.value) void recheck(); else { credentials.hidden = true; probeHost.replaceChildren(); } } else void recheck();
  });
  url.addEventListener('input', () => { draft.url = url.value; });
  url.addEventListener('change', () => { void recheck(); });
  register.addEventListener('click', () => { if (form.reportValidity()) void enter('/auth/register'); });
  // Enter in the address field (credentials still hidden) re-checks the server; once they show, Enter signs in.
  const submitForm = (e: Event): void => {
    e.preventDefault();
    if (credentials.hidden) void recheck();
    else if (form.reportValidity()) void enter('/auth/login');
  };

  const option = (radio: HTMLInputElement, label: string): HTMLElement => h('label', { class: 'option', for: radio.id }, radio, h('span', null, label));
  const form = h('form', { class: 'login-form', novalidate: true, onsubmit: submitForm },
    h('fieldset', { class: 'server-choice' },
      h('legend', null, t('login.server')),
      h('div', { class: 'choice' }, option(globalRadio, isOwnOrigin ? t('login.thisServer') : t('login.globalServer')), option(customRadio, t('login.customServer'))),
      urlField,
      probeHost),
    pending,
    credentials);

  const column = h('div', { class: 'login-column' },
    titleBlock(t('login.step1'), t('login.title')),
    panel({ title: t('login.title'), headless: true, class: 'login-panel' }, form));
  const footer = h('div', { class: 'login-footer' },
    languageSelect(() => loginView(root, done, { username: username.value, password: passwordInput.value, custom: customRadio.checked, url: draft.url })),
    h('div', { class: 'hints' },
      h('span', { class: 'hint' }, keycap(t('key.tab')), t('hint.nextField')),
      h('span', { class: 'hint' }, keycap(t('key.enter')), t('login.signIn')),
      h('span', { class: 'hint' }, keycap('F5'), t('hint.recheck'))));
  const view = bareView([brandBlock(PRODUCT_NAME, h('span', { class: 'tagline' }, t('brand.tagline'))), column, footer], 'login');
  view.addEventListener('keydown', (e) => { if (e.key === 'F5') { e.preventDefault(); void recheck(); } });
  root.replaceChildren(stage('login', view));
  document.title = PRODUCT_NAME;
  void recheck();
}
