import type { ProfitBy, ProfitRow, ProfitView } from '@opc/shared';
import { fetchProfit } from '../api-reports.ts';
import { dataTable, icon, panel, segments, titleBlock } from '../components.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { reportHints, reportKeys, reportNav, reportsOff, figure, shareBar, signedMoney } from '../reports-ui.ts';
import { COST_PART_KEY, PROFIT_BY_KEY, breakdownRows, monthName, profitGroups, profitMonth, profitName } from '../reports-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** The view, the month and the row on show survive a redraw, not a new visit. */
const state: { by: ProfitBy; month: string | undefined; selected: string | null } = { by: 'line', month: undefined, selected: null };
const idOf = (r: ProfitRow): string => `${r.by}:${r.id}`;

/** `#finance/lines`: what each line (or aircraft) earned in a month once its fuel, fees, crew, service and maintenance were paid, the losing ones, and what makes up the selected one's costs. */
export async function financeLines(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#finance';
  const data = await fetchProfit(state.by, state.month);
  if (!data) return { title: t('rp.l.title'), scene: 'finance', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: reportsOff() };

  const fm = fmt(), loc = locale();
  state.month = data.month;
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const setBy = (by: ProfitBy): void => { if (by !== state.by) { state.by = by; state.selected = null; redraw(); } };
  const current = new Date(ctx.snap.at).toISOString().slice(0, 7);
  const stepMonthBy = (dir: 1 | -1) => (): void => { const next = profitMonth(data.month, dir, current); if (next !== data.month) { state.month = next; state.selected = null; redraw(); } };

  const { profitable, losing } = profitGroups(data.rows);
  const selected = data.rows.find((r) => idOf(r) === state.selected) ?? losing[0] ?? data.rows[0] ?? null;
  const pct = (r: ProfitRow): string => (r.marginPct === null ? '–' : `${fm.num(r.marginPct * 100, 1)}\u00a0%`);

  const header = h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, `${t('rp.crumb')} · ${monthName(data.month, loc)}${data.closed ? '' : ` · ${t('rp.c.inProgress')}`}`)), t('rp.l.title')),
    h('div', { class: 'rp-figures' },
      figure(t('rp.l.total'), signedMoney(data.totals.margin), tp('rp.l.count', data.rows.length)),
      figure(t('rp.l.profitable'), signedMoney(data.totals.profitable.margin), tp('rp.l.count', data.totals.profitable.count)),
      figure(t('rp.l.losing'), signedMoney(data.totals.losing.margin), tp('rp.l.count', data.totals.losing.count), data.totals.losing.count > 0 ? 'warn' : null)));

  const toolbar = h('div', { class: 'rp-toolbar' },
    segments(t('rp.l.by.label'), (['line', 'aircraft'] as const).map((value) => ({ value, label: t(PROFIT_BY_KEY[value]) })), state.by, setBy),
    h('div', { class: 'row tight' },
      h('button', { type: 'button', class: 'btn ghost small', 'aria-label': t('rp.l.prev'), onclick: stepMonthBy(-1) }, icon('chevron-left')),
      h('span', { class: 'rp-month-name' }, monthName(data.month, loc)),
      h('button', { type: 'button', class: 'btn ghost small', 'aria-label': t('rp.l.next'), onclick: stepMonthBy(1) }, icon('chevron-right'))));

  const rowOf = (r: ProfitRow): { cells: (string | HTMLElement)[]; onOpen: () => void; onFocus: () => void; label: string; selected: boolean } => ({
    cells: [
      h('span', { class: 'col tight' }, h('span', { class: 'strong' }, profitName(r)), h('span', { class: 'dim small' }, r.by === 'line' ? r.aircraft.join(', ') : [r.icao, ...r.lines].join(' · '))),
      fm.num(r.flights), fm.money(r.revenue), fm.money(r.costs), signedMoney(r.margin), pct(r)],
    onOpen: () => { state.selected = idOf(r); redraw(); }, onFocus: () => { state.selected = idOf(r); showDetail(); },
    label: `${profitName(r)}, ${t('rp.l.margin')} ${fm.signedMoney(r.margin)}`, selected: idOf(r) === state.selected || (state.selected === null && r === selected),
  });
  const cols = [{ label: t(state.by === 'line' ? 'rp.l.col.line' : 'rp.l.col.aircraft') }, { label: t('rp.l.col.flights'), align: 'end' as const }, { label: t('rp.l.col.revenue'), align: 'end' as const }, { label: t('rp.l.col.costs'), align: 'end' as const }, { label: t('rp.l.col.margin'), align: 'end' as const }, { label: t('rp.l.col.pct'), align: 'end' as const }];
  const group = (title: string, rows: ProfitRow[]): HTMLElement | null => (rows.length === 0 ? null
    : h('section', { class: 'rp-group', 'aria-label': title }, h('h3', { class: 'rp-group-title' }, title), dataTable(title, cols, rows.map(rowOf))));
  const table = panel({ title: t('rp.l.ranking'), action: t('rp.l.excl'), id: 'rp-ranking', class: 'rp-main' },
    data.rows.length === 0 ? h('p', { class: 'dim' }, t(state.by === 'line' ? 'rp.l.none.line' : 'rp.l.none.aircraft')) : [group(t('rp.l.profitable'), profitable), group(t('rp.l.losing'), losing)]);

  const detail = h('div', { class: 'rp-detail' });
  const showDetail = (): void => {
    const r = data.rows.find((x) => idOf(x) === state.selected) ?? selected;
    detail.replaceChildren(...(r === null ? [h('p', { class: 'dim' }, t('rp.l.pick'))] : [
      h('div', { class: 'row' }, h('h3', { class: 'rp-detail-name' }, profitName(r)), h('span', { class: 'dim' }, `${fm.num(r.flights)} ${t('rp.l.col.flights').toLowerCase()}`)),
      h('div', { class: 'rp-figures' }, figure(t('rp.l.margin'), signedMoney(r.margin), t('rp.l.of', { revenue: fm.money(r.revenue), costs: fm.money(r.costs) }), r.margin < 0 ? 'warn' : null)),
      h('p', { class: 'rp-label' }, t('rp.l.where')),
      h('ul', { class: 'plain rp-shares' }, breakdownRows(r.breakdown).map((b) => shareBar(t(COST_PART_KEY[b.part]), fm.money(b.amount), b.share, 'warn')))]));
  };
  showDetail();
  const side = panel({ title: t('rp.l.detail'), id: 'rp-detail' }, detail);

  const view = h('div', { class: 'rp-screen' }, header, reportNav('lines', go), toolbar, h('div', { class: 'rp-body' }, table, h('div', { class: 'rp-side' }, side)));
  const flip = (): void => { setBy(state.by === 'line' ? 'aircraft' : 'line'); };
  return {
    title: t('rp.l.title'), scene: 'finance', tab: 'hubs', view, back, wide: false,
    hints: reportHints({ key: 'T', label: t('rp.l.hint.by') }, { key: '← →', label: t('rp.hint.month') }, { key: '↑ ↓', label: t('rp.l.hint.row') }),
    keys: { t: flip, left: stepMonthBy(-1), right: stepMonthBy(1), ...reportKeys('lines', go) },
  };
}
