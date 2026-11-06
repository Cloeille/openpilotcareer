import type { Flight, ServerInfo, Transaction } from '@opc/shared';
import { API_VERSION } from '@opc/shared';
import { act } from '../actions.ts';
import { api, downloadExport, fetchInfo, session, GLOBAL_URL } from '../api.ts';
import { button, icon, inputField, panel } from '../components.ts';
import { getLang, setLang, t, tp } from '../i18n.ts';
import type { Ctx } from '../screen.ts';
import { formatBytes, listOf, numericDate, pageAll, readLastExport, recordExport, spanOf, type ExportFormat, type Span } from '../settings-model.ts';
import { h } from '../ui.ts';
import { focusSoon } from './settings-keys.ts';

const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
const PAGE = 200;
const MAX_PAGES = 25;

type Counts = { flights: Span | null; transactions: Span | null };

let cache: { key: string; at: number; value: Promise<Counts | null> } | null = null;
const CACHE_MS = 60_000;

/** What the two CSV files will hold, counted from the same API the file is built from. Null when the server cannot be asked. Kept for a minute so a redraw (an export, a language change) does not page through the whole ledger again. */
function loadCounts(companyId: number): Promise<Counts | null> {
  const key = `${session.server}#${companyId}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = fetchCounts();
  cache = { key, at: Date.now(), value };
  return value;
}

async function fetchCounts(): Promise<Counts | null> {
  try {
    const [flights, tx] = await Promise.all([
      pageAll<Flight>((before) => api<Flight[]>(`/me/flights?limit=${PAGE}${before ? `&before=${before}` : ''}`), PAGE, MAX_PAGES),
      pageAll<Transaction>((before) => api<Transaction[]>(`/me/transactions?limit=${PAGE}${before ? `&before=${before}` : ''}`), PAGE, MAX_PAGES),
    ]);
    return {
      flights: spanOf(flights.items.map((f) => f.acceptedAt), flights.capped),
      transactions: spanOf(tx.items.map((x) => x.at), tx.capped),
    };
  } catch { return null; }
}

function exportRow(o: { format: string; title: string; size: string | null; desc: string; id: string; action: HTMLElement; last?: boolean }): HTMLElement {
  return h('li', { class: `export-row${o.last ? ' last' : ''}` },
    h('span', { class: 'mono export-format' }, o.format),
    h('div', { class: 'export-stack' }, h('div', { class: 'row tight' }, h('span', { class: 'export-title' }, o.title), o.size ? h('span', { class: 'dim small' }, o.size) : null), h('p', { class: 'dim small', id: o.id }, o.desc)),
    o.action);
}

/** Download one export, remember its size and when it happened, redraw. */
export function runExport(format: ExportFormat): Promise<boolean> {
  return act(t('set.export.done'), async () => {
    const bytes = await downloadExport(format);
    recordExport(localStorage, session.server, format, bytes, Date.now());
  }, async () => redraw());
}

function exportSection(ctx: Ctx): HTMLElement {
  const lang = getLang();
  const company = ctx.snap.me.company.name;
  const last = readLastExport(localStorage, session.server);
  const size = (f: ExportFormat): string | null => (last?.bytes[f] === undefined ? null : formatBytes(last.bytes[f]!, lang));
  const describe = (span: Span | null | undefined, one: 'set.export.flightsDesc' | 'set.export.txDesc', none: 'set.export.noFlights' | 'set.export.noTx'): string => {
    if (span === undefined) return t('set.export.counting');
    if (span === null) return t(none);
    const text = tp(one, span.count, { from: numericDate(span.from, lang), to: numericDate(span.to, lang) });
    return span.capped ? `${text} ${t('set.export.atLeast')}` : text;
  };

  const all = button(t('set.export.action'), { variant: 'primary', key: 'E', label: t('set.export.label', { what: t('set.export.full') }), onclick: () => void runExport('json') });
  all.setAttribute('aria-describedby', 'export-json-desc');
  const csv = (f: ExportFormat, what: string, id: string): HTMLButtonElement => {
    const b = button(t('set.export.action'), { variant: 'secondary', icon: 'download', label: t('set.export.label', { what }), onclick: () => void runExport(f) });
    b.setAttribute('aria-describedby', id);
    return b;
  };
  const section = panel({ title: t('set.export.title'), id: 'export-panel' },
    h('p', { class: 'muted intro-text' }, t('set.export.intro', { company })),
    h('ul', { class: 'plain export-list' },
      exportRow({ format: 'JSON', title: t('set.export.full'), size: size('json'), desc: t('set.export.fullDesc'), id: 'export-json-desc', action: all }),
      exportRow({ format: 'CSV', title: t('set.export.flights'), size: size('flights.csv'), desc: describe(undefined, 'set.export.flightsDesc', 'set.export.noFlights'), id: 'export-flights-desc', action: csv('flights.csv', t('set.export.flights'), 'export-flights-desc') }),
      exportRow({ format: 'CSV', title: t('set.export.transactions'), size: size('transactions.csv'), desc: describe(undefined, 'set.export.txDesc', 'set.export.noTx'), id: 'export-tx-desc', action: csv('transactions.csv', t('set.export.transactions'), 'export-tx-desc'), last: true })),
    h('p', { class: 'dim small export-last' }, last ? t('set.export.lastAt', { date: numericDate(last.at, lang) }) : t('set.export.lastNone')));
  // The counts arrive after the screen is up: the descriptions are first the plain scope, then the real numbers.
  void loadCounts(ctx.snap.me.company.id).then((counts) => {
    if (counts === null) return;
    const fill = (id: string, text: string): void => { const el = section.querySelector(`#${id}`); if (el?.isConnected) el.textContent = text; };
    fill('export-flights-desc', describe(counts.flights, 'set.export.flightsDesc', 'set.export.noFlights'));
    fill('export-tx-desc', describe(counts.transactions, 'set.export.txDesc', 'set.export.noTx'));
  });
  return section;
}

function deleteSection(ctx: Ctx): HTMLElement {
  const { me } = ctx.snap;
  const names = me.companies.map((c) => c.name);
  const pw = inputField({ label: t('set.delete.label'), icon: 'lock', id: 'delete-password' }, { type: 'password', name: 'confirm-password', autocomplete: 'current-password', required: true, maxlength: 128 });
  const submit = button(t('set.delete.action'), { variant: 'danger', icon: 'trash-2', type: 'submit' });
  const form = h('form', { class: 'delete-confirm', onsubmit: (e: Event) => {
    e.preventDefault();
    if (pw.control.value === '') { pw.control.focus(); return; }
    if (!confirm(t('set.delete.confirm', { user: me.username }))) return;
    void act(t('set.delete.done'), async () => {
      await api('/me', { method: 'DELETE', body: { password: pw.control.value } });
      session.company = null;
      session.set(session.server, null);
      location.hash = '#dashboard';
      location.reload();
    });
    pw.control.value = '';
  } }, pw.root, submit);
  return panel({ title: t('set.delete.title'), id: 'delete-panel', danger: true, action: h('span', { class: 'badge rejected' }, icon('triangle-alert', 12), t('set.delete.irreversible')) },
    h('p', { class: 'muted intro-text' }, tp('set.delete.body', names.length, { companies: listOf(names, getLang()) })),
    form);
}

const detail = (label: string, value: string | HTMLElement): HTMLElement => h('div', { class: 'detail-row' }, h('span', { class: 'dim' }, label), h('span', { class: 'detail-value' }, value));

function serverSection(ctx: Ctx, info: ServerInfo | null): HTMLElement {
  const own = session.server === GLOBAL_URL;
  const name = own ? t('hud.globalServer') : (info?.name ?? new URL(session.server).host);
  const change = h('button', { type: 'button', class: 'link-btn panel-link', title: t('hud.changeHint'), onclick: () => { window.dispatchEvent(new Event('opc:change-server')); } }, t('hud.change'));
  const version = info === null ? '' : `${info.version}, ${info.apiVersion === API_VERSION ? t('login.compatible') : t('login.apiMismatch', { n: info.apiVersion, expected: API_VERSION })}`;
  return panel({ title: t('set.server.title'), id: 'server-panel', action: change },
    h('div', { class: 'col tight' },
      h('div', { class: 'row tight' }, h('span', { class: info ? 'dot' : 'dot off', 'aria-hidden': 'true' }), h('span', { class: 'server-name' }, name)),
      h('span', { class: 'mono dim small server-url' }, session.server)),
    info === null
      ? h('p', { class: 'dim small', role: 'status' }, t('set.server.silent'))
      : h('div', { class: 'detail-list' },
        detail(t('set.server.version'), version),
        detail(t('set.server.antiCheat'), h('span', { class: info.antiCheat ? 'ok-text' : 'warn-text' }, info.antiCheat ? t('set.server.antiOn') : t('set.server.antiOff'))),
        detail(t('set.server.registration'), info.registrationOpen ? t('set.server.regOpen') : t('set.server.regClosed')),
        detail(t('set.server.account'), ctx.snap.me.username)),
    h('div', { class: 'privacy-note' }, h('p', { class: 'strong' }, t('set.privacy.title')), h('p', { class: 'muted small' }, t('set.privacy.body'))),
    languagePicker());
}

function languagePicker(): HTMLElement {
  const lang = getLang();
  return h('div', { class: 'lang-pick' },
    h('div', { class: 'row tight' }, icon('globe', 14), h('label', { for: 'settings-lang', class: 'lang-label' }, t('lang.label'))),
    h('select', { id: 'settings-lang', name: 'lang', class: 'lang-select', onchange: (e: Event) => { setLang((e.target as HTMLSelectElement).value as 'en' | 'fr'); focusSoon('settings-lang'); } },
      (['en', 'fr'] as const).map((l) => h('option', { value: l, selected: l === lang }, t(`lang.${l}`)))));
}

/** Section 2: export, account deletion, server and privacy. */
export async function accountSection(ctx: Ctx): Promise<HTMLElement> {
  const info = await fetchInfo(session.server).catch(() => null);
  return h('div', { class: 'settings-account' },
    h('div', { class: 'settings-center' }, exportSection(ctx), deleteSection(ctx)),
    h('div', { class: 'settings-side' }, serverSection(ctx, info)));
}
