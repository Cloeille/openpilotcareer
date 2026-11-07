import { CATEGORIES, type Category, type StatementRow, type StatementView } from '@opc/shared';
import { downloadExport } from '../api.ts';
import { act } from '../actions.ts';
import { fetchCash, fetchStatement } from '../api-reports.ts';
import { button, icon, panel, segments, titleBlock } from '../components.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { reportHints, reportKeys, reportNav, reportsOff, figure, shareBar, signedMoney } from '../reports-ui.ts';
import { CATEGORY_KEY, PERIODS, PERIOD_KEY, dayName, periodRange, type Period } from '../reports-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** The filters survive a redraw, not a new visit. `limit` grows by a page each time "earlier" is pressed. */
const PAGE = 50;
const state: { period: Period; category: Category | ''; line: number | null; limit: number } = { period: 'month', category: '', line: null, limit: PAGE };

/** `#finance/ledger`: the account statement. Every posting of the period, newest first, grouped by day, with its category, the line or aircraft it is about, and the balance after it. */
export async function financeLedger(ctx: Ctx): Promise<Screen> {
  const { go, snap } = ctx;
  const back = '#finance';
  const range = periodRange(state.period, snap.at);
  const [data, cash] = await Promise.all([
    fetchStatement({ ...range, category: state.category, ...(state.line === null ? {} : { line: state.line }), limit: state.limit }),
    fetchCash(1),
  ]);
  if (!data) return { title: t('rp.s.title'), scene: 'finance', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: reportsOff() };

  const fm = fmt(), loc = locale();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const reset = (): void => { state.limit = PAGE; redraw(); };
  const nextPeriod = (): void => { state.period = PERIODS[(PERIODS.indexOf(state.period) + 1) % PERIODS.length]!; reset(); };
  const nextCategory = (): void => {
    const present = CATEGORIES.filter((c) => data.summary.byCategory.some((x) => x.category === c) || c === state.category);
    const order: (Category | '')[] = ['', ...present];
    state.category = order[(order.indexOf(state.category) + 1) % order.length]!;
    reset();
  };
  const exportCsv = (): void => { void act(t('rp.s.exported'), () => downloadExport('transactions.csv')); };

  // ------------------------------------------------------------ header: the account, the period's move
  const s = data.summary;
  const header = h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, `${t('rp.crumb')} · ${snap.me.company.name}`)), t('rp.s.title')),
    h('div', { class: 'rp-figures' },
      figure(t('rp.s.balance'), fm.money(cash?.balance ?? snap.me.company.balance), null, (cash?.balance ?? snap.me.company.balance) < 0 ? 'warn' : null),
      figure(t('rp.s.moved'), signedMoney(s.net), tp('rp.s.count', s.count)),
      figure(t('rp.s.in'), signedMoney(s.in), null), figure(t('rp.s.out'), signedMoney(-s.out), null)));

  // ------------------------------------------------------------ filters
  const toolbar = h('div', { class: 'rp-toolbar' },
    segments(t('rp.s.period'), PERIODS.map((value) => ({ value, label: t(PERIOD_KEY[value]) })), state.period, (p) => { state.period = p; reset(); }),
    h('div', { class: 'row tight' },
      h('button', { type: 'button', class: 'btn secondary small', onclick: nextCategory, 'aria-label': t('rp.s.category.label', { name: state.category === '' ? t('rp.s.all') : t(CATEGORY_KEY[state.category]) }) },
        h('span', null, state.category === '' ? t('rp.s.category') : t(CATEGORY_KEY[state.category])), icon('chevron-down')),
      state.line === null ? null : h('button', { type: 'button', class: 'btn ghost small', onclick: () => { state.line = null; reset(); } }, t('rp.s.clearLine'), icon('x')),
      button(t('rp.s.export'), { variant: 'secondary', icon: 'download', key: 'X', onclick: exportCsv })));

  // ------------------------------------------------------------ the rows, a group per day
  const tags = (r: StatementRow): HTMLElement => h('span', { class: 'rp-links' },
    r.line ? h('button', { type: 'button', class: 'link-btn mono', 'aria-label': t('rp.s.filterLine', { line: `${r.line.a} – ${r.line.b}` }), onclick: () => { state.line = r.line!.id; reset(); } }, `${r.line.a}–${r.line.b}`) : null,
    r.aircraft ? h('span', { class: 'mono dim' }, r.aircraft.registration) : null);
  const row = (r: StatementRow): HTMLElement => h('li', { class: 'rp-row', 'data-row': '', tabindex: 0, 'aria-label': `${fm.zulu(r.at)}, ${r.memo}, ${t(CATEGORY_KEY[r.category])}, ${fm.signedMoney(r.amount)}, ${fm.money(r.balanceAfter)}` },
    h('span', { class: 'rp-row-time mono dim' }, fm.zulu(r.at)),
    h('span', { class: 'col tight rp-row-what' }, h('span', null, r.memo), tags(r)),
    h('span', { class: 'rp-row-cat dim' }, t(CATEGORY_KEY[r.category])),
    h('span', { class: 'rp-row-amount strong' }, signedMoney(r.amount)),
    h('span', { class: 'rp-row-balance mono dim' }, fm.money(r.balanceAfter)));
  const days = data.days.map((d) => h('section', { class: 'rp-day', 'aria-label': dayName(d.day, loc) },
    h('h3', { class: 'rp-day-head' }, h('span', null, dayName(d.day, loc)), h('span', { class: 'dim' }, t('rp.s.dayNet', { amount: fm.signedMoney(d.net) }))),
    h('ul', { class: 'plain rp-rows' }, d.rows.map(row))));
  const list = panel({ title: t('rp.s.ops'), action: data.days.length > 0 ? tp('rp.s.shown', s.count) : null, id: 'rp-ops', class: 'rp-main' },
    data.days.length === 0 ? h('p', { class: 'dim' }, t('rp.s.none')) : days,
    data.next === null ? null : button(t('rp.s.earlier'), { variant: 'ghost', onclick: () => { state.limit += PAGE; redraw(); } }));

  // ------------------------------------------------------------ the period in short, the next posting
  const total = Math.max(s.in, s.out, 1);
  const sums = panel({ title: t('rp.s.summary'), action: h('span', { class: 'dim' }, `${fm.date(Date.parse(`${range.from}T12:00:00Z`))} – ${fm.date(Date.parse(`${range.to}T12:00:00Z`))}`), id: 'rp-summary' },
    s.count === 0 ? h('p', { class: 'dim' }, t('rp.s.none')) : [
      h('ul', { class: 'plain rp-shares' }, s.byCategory.filter((c) => c.in > 0).map((c) => shareBar(t(CATEGORY_KEY[c.category]), fm.signedMoney(c.in), c.in / total, 'in'))),
      h('ul', { class: 'plain rp-shares' }, s.byCategory.filter((c) => c.out > 0).map((c) => shareBar(t(CATEGORY_KEY[c.category]), fm.signedMoney(-c.out), c.out / total, 'out')))],
    data.scheduled ? h('p', { class: 'rp-next' }, h('span', { class: 'dim' }, t('rp.s.next')), ' ', t(CATEGORY_KEY[data.scheduled.category]), ' · ', fm.date(data.scheduled.at), ' · ', signedMoney(data.scheduled.amount)) : null);

  const view = h('div', { class: 'rp-screen' }, header, reportNav('ledger', go), toolbar, h('div', { class: 'rp-body' }, list, h('div', { class: 'rp-side' }, sums)));
  return {
    title: t('rp.s.title'), scene: 'finance', tab: 'hubs', view, back, wide: false,
    hints: reportHints({ key: 'T', label: t('rp.s.hint.period') }, { key: 'C', label: t('rp.s.hint.category') }, { key: '↑ ↓', label: t('hint.browse') }, { key: 'X', label: t('rp.s.hint.export') }),
    keys: { t: nextPeriod, c: nextCategory, x: exportCsv, ...reportKeys('ledger', go) },
  };
}
