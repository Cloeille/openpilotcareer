import { fetchCash } from '../api-reports.ts';
import { icon, panel, titleBlock } from '../components.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { reportHints, reportKeys, reportNav, reportsOff, figure, shareBar, signedMoney, upcomingPanel } from '../reports-ui.ts';
import { CASH_FETCH, CATEGORY_KEY, barScale, chartMonths, defaultMonth, monthName, monthShort, positiveStreak, sideOf, stepMonth } from '../reports-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** The month on show survives a redraw (a language change, a poll), not a new visit. */
let picked: string | null = null;

/** `#finance`: the balance, the month's cash flow, how long the company holds without income, a year of revenue against spend, where the money came from and went, the next big debits. */
export async function financeCash(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#hubs';
  const cash = await fetchCash(CASH_FETCH);
  if (!cash) return { title: t('rp.c.title'), scene: 'finance', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: reportsOff() };

  const fm = fmt(), loc = locale();
  const months = chartMonths(cash.months);
  if (!cash.months.some((m) => m.month === picked)) picked = defaultMonth(cash.months);
  const month = cash.months.find((m) => m.month === picked) ?? null;
  const step = (dir: 1 | -1) => (): void => { const next = stepMonth(months, picked, dir); if (next && next !== picked) { picked = next; window.dispatchEvent(new Event('opc:redraw')); } };

  // ------------------------------------------------------------ header: balance, the month, runway, debt
  const streak = positiveStreak(cash.months);
  const last = cash.months.filter((m) => m.closed).at(-1);
  const status = streak > 0 ? tp('rp.c.streak', streak) : t('rp.c.streak.none');
  const header = h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: `dot${streak > 0 ? '' : ' warn'}` }), h('span', null, `${t('rp.crumb')} · ${status}`)), t('rp.c.title')),
    h('div', { class: 'rp-figures' },
      figure(t('rp.c.balance'), fm.money(cash.balance), cash.balance < 0 ? t('rp.c.overdrawn') : null, cash.balance < 0 ? 'warn' : null),
      figure(last ? t('rp.c.netOf', { month: monthName(last.month, loc, false) }) : t('rp.c.net'), last ? signedMoney(last.net) : '–', last?.netVsPrevious != null ? t('rp.c.vsPrev', { amount: fm.signedMoney(last.netVsPrevious) }) : null),
      figure(t('rp.c.runway'), cash.runwayDays === null ? '–' : tp('rp.c.days', Math.round(cash.runwayDays)), t('rp.c.runway.sub'), cash.runwayDays !== null && cash.runwayDays < 30 ? 'warn' : null),
      figure(t('rp.c.debt'), fm.money(cash.debt.total), cash.debt.credits === 0 ? t('rp.c.debt.none') : t('rp.c.debt.sub', { n: cash.debt.credits, amount: fm.money(cash.debt.monthly) }))));

  // ------------------------------------------------------------ the year: revenue and spend per month
  const scale = barScale(months);
  const bars = h('div', { class: 'rp-bars', role: 'group', 'aria-label': t('rp.c.chart.label') }, months.map((m) => {
    const on = m.month === picked;
    return h('button', {
      type: 'button', class: `rp-bar${on ? ' on' : ''}${m.closed ? '' : ' open'}`, 'aria-pressed': String(on), 'data-row': '',
      'aria-label': t('rp.c.bar.label', { month: monthName(m.month, loc), revenue: fm.money(m.revenue), spend: fm.money(m.spend), balance: fm.money(m.endBalance) }),
      onclick: () => { picked = m.month; window.dispatchEvent(new Event('opc:redraw')); },
    },
    h('span', { class: 'rp-bar-pair' }, h('i', { class: 'in', style: `height:${Math.round(scale(m.revenue) * 100)}%` }), h('i', { class: 'out', style: `height:${Math.round(scale(m.spend) * 100)}%` })),
    h('span', { class: 'rp-bar-month' }, monthShort(m.month, loc)),
    h('span', { class: `rp-bar-end${m.endBalance < 0 ? ' rp-neg' : ''}` }, fm.moneyShort(m.endBalance)));
  }));
  const chart = panel({ title: t('rp.c.flow'), action: months.length > 1 ? h('span', { class: 'rp-legend' }, h('i', { class: 'in' }), t('rp.c.in'), h('i', { class: 'out' }), t('rp.c.out')) : null, id: 'rp-flow', class: 'rp-main' },
    months.length === 0 ? h('p', { class: 'dim' }, t('rp.c.flow.none')) : [
      month ? h('div', { class: 'rp-month' },
        h('strong', null, monthName(month.month, loc)), month.closed ? null : h('span', { class: 'dim' }, t('rp.c.inProgress')),
        h('span', { class: 'rp-month-sums' }, `${t('rp.c.in')} `, h('b', null, fm.money(month.revenue)), ` · ${t('rp.c.out')} `, h('b', null, fm.money(month.spend)), ` · ${t('rp.c.net')} `, signedMoney(month.net), ` · ${t('rp.c.endBalance')} `, h('b', null, fm.money(month.endBalance)))) : null,
      bars,
      months.length < 12 ? h('p', { class: 'dim small' }, tp('rp.c.young', months.length)) : null]);

  // ------------------------------------------------------------ where it came from, where it went
  const side = (which: 'in' | 'out'): HTMLElement => {
    const rows = sideOf(month, which);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return panel({ title: t(which === 'in' ? 'rp.c.cameFrom' : 'rp.c.wentTo'), action: month ? fm.money(total) : null, id: `rp-${which}` },
      rows.length === 0 ? h('p', { class: 'dim' }, t('rp.c.side.none')) : h('ul', { class: 'plain rp-shares' }, rows.map((r) => shareBar(t(CATEGORY_KEY[r.category]), fm.money(r.amount), r.share, which))));
  };

  const view = h('div', { class: 'rp-screen' }, header, reportNav('cash', go),
    h('div', { class: 'rp-body' }, chart, h('div', { class: 'rp-side' }, upcomingPanel(cash, (u) => t(CATEGORY_KEY[u.category])))),
    h('div', { class: 'rp-pair' }, side('in'), side('out')));
  return {
    title: t('rp.c.title'), scene: 'finance', tab: 'hubs', view, back, wide: false,
    hints: reportHints('cash', { key: '← →', label: t('rp.hint.month') }),
    keys: { left: step(-1), right: step(1), ...reportKeys('cash', go) },
  };
}
