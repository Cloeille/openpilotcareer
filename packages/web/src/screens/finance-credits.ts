import { CREDIT_LATE_REPUTATION, UNPAID_FEE_PCT, type CreditView, type LoanLine, type PrepayQuote } from '@opc/shared';
import { fetchCredits, prepayCredit, quotePrepay } from '../api-credit.ts';
import { act } from '../actions.ts';
import { badge, button, icon, panel, titleBlock } from '../components.ts';
import { BANK_KEY, barShares, clampPrepay, percent1, repaidShare, stepScheduleMonth } from '../credit-view.ts';
import { errorText } from '../error-text.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { figure, reportsOff, signedMoney } from '../reports-ui.ts';
import { monthName, monthShort } from '../reports-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h, notify } from '../ui.ts';

/** The credit being looked at, the month on show and the repayment being simulated survive a redraw (a language change, a poll), not a new visit. */
let picked: number | null = null;
let month: string | null = null;
let sim: { id: number; full: boolean; amount: number } | null = null;
const CHART_MONTHS = 36;

const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

/** `#finance/credits`: what is owed and what it costs a month, the borrowing room and the rating, the schedule, each credit with the early-repayment simulator, and the overdraft. The server computes every figure. */
export async function financeCredits(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#finance';
  const data = await fetchCredits();
  if (!data) return { title: t('cr.c.title'), scene: 'finance', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('rp.nav.cash') }], view: reportsOff() };

  const fm = fmt(), loc = locale();
  const selected: CreditView | null = data.credits.find((c) => c.id === picked) ?? data.credits[0] ?? null;
  picked = selected?.id ?? null;
  if (sim && sim.id !== picked) sim = null;
  let quote: PrepayQuote | null = null;
  if (sim && selected) {
    try { quote = await quotePrepay(sim.id, sim.full ? { full: true } : { amount: clampPrepay(sim.amount, selected.principal) }); } catch (e) { notify(errorText(e), 'error'); sim = null; }
  }
  const schedule = data.schedule.slice(0, CHART_MONTHS);
  if (!schedule.some((m) => m.month === month)) month = schedule[0]?.month ?? null;
  const step = (dir: 1 | -1) => (): void => { const next = stepScheduleMonth(schedule, month, dir); if (next && next !== month) { month = next; redraw(); } };
  const cycleCredit = (): void => {
    if (data.credits.length < 2 || !selected) return;
    picked = data.credits[(data.credits.findIndex((c) => c.id === selected.id) + 1) % data.credits.length]!.id; sim = null; redraw();
  };

  // ------------------------------------------------------------ header
  const next = schedule[0];
  const status = next ? t('cr.c.status.next', { amount: fm.money(next.capital + next.interest + next.insurance), date: monthName(next.month, loc) }) : t('cr.c.status.none');
  const header = h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, `${t('rp.crumb')} · ${status}`)), t('cr.c.title')),
    h('div', { class: 'rp-figures' },
      figure(t('cr.c.instalments'), fm.money(data.instalments), tp('cr.c.instalments.sub', data.credits.length + data.loans.length)),
      figure(t('cr.c.ratio'), data.ratio === null ? '–' : percent1(data.ratio, loc), data.revenue > 0 ? t('cr.c.ratio.sub', { amount: fm.money(data.revenue), month: monthName(data.revenueMonth, loc, false) }) : t('cr.c.ratio.none')),
      figure(t('cr.c.room'), fm.money(data.room), t('cr.c.room.sub', { ceiling: fm.money(data.ceiling), n: data.active, max: data.maxActive })),
      figure(t('cr.c.rating'), data.rating, t('cr.c.rating.sub'))));

  // ------------------------------------------------------------ the schedule: capital, interest and insurance of each coming month
  const shares = new Map(barShares(schedule).map((b) => [b.month, b]));
  const bars = h('div', { class: 'cr-bars', role: 'group', 'aria-label': t('cr.c.schedule.label') }, schedule.map((m) => {
    const on = m.month === month, s = shares.get(m.month)!;
    return h('button', {
      type: 'button', class: `cr-bar${on ? ' on' : ''}`, 'aria-pressed': String(on), 'data-row': '',
      'aria-label': t('cr.c.bar.label', { month: monthName(m.month, loc), amount: fm.money(m.capital + m.interest + m.insurance) }), onclick: () => { month = m.month; redraw(); },
    }, h('span', { class: 'cr-stack', style: `height:${Math.round((s.capital + s.interest + s.insurance) * 100)}%` },
      h('i', { class: 'insurance', style: `flex:${s.insurance}` }), h('i', { class: 'interest', style: `flex:${s.interest}` }), h('i', { class: 'capital', style: `flex:${s.capital}` })),
    h('span', { class: 'cr-bar-month' }, monthShort(m.month, loc)));
  }));
  const at = data.schedule.find((m) => m.month === month);
  const chart = panel({ title: t('cr.c.schedule'), action: h('span', { class: 'rp-legend' }, h('i', { class: 'capital' }), t('cr.c.capital'), h('i', { class: 'interest' }), t('cr.c.interest'), h('i', { class: 'insurance' }), t('cr.c.insurance')), id: 'cr-schedule', class: 'rp-main' },
    schedule.length === 0 ? h('p', { class: 'dim' }, t('cr.c.schedule.none')) : [
      at ? h('div', { class: 'rp-month' }, h('strong', null, monthName(at.month, loc)),
        h('span', { class: 'rp-month-sums' }, `${t('cr.c.capital')} `, h('b', null, fm.money(at.capital)), ` · ${t('cr.c.interest')} `, h('b', null, fm.money(at.interest)), ` · ${t('cr.c.insurance')} `, h('b', null, fm.money(at.insurance)))) : null,
      bars,
      data.schedule.length > schedule.length ? h('p', { class: 'dim small' }, t('cr.c.schedule.more', { n: data.schedule.length - schedule.length })) : null]);

  // ------------------------------------------------------------ the credits and the aircraft loans, each with its figures
  const field = (label: string, value: string): HTMLElement => h('div', { class: 'cr-field' }, h('span', { class: 'dim small' }, label), h('strong', null, value));
  const creditCard = (c: CreditView): HTMLElement => {
    const on = c.id === selected?.id;
    return h('li', { class: `cr-card${on ? ' on' : ''}` },
      h('button', { type: 'button', class: 'cr-card-head', 'aria-pressed': String(on), onclick: () => { picked = c.id; sim = null; redraw(); } },
        h('span', { class: 'col tight' }, h('strong', null, t('cr.c.credit', { id: c.id })), h('span', { class: 'dim small' }, `${t(BANK_KEY[c.bank])} · ${t('cr.c.unsecured')}`)), h('span', { class: 'mono strong' }, fm.money(c.principal))),
      h('div', { class: 'cr-fields' }, field(t('cr.c.rate'), t('cr.c.rate.fixed', { rate: percent1(c.rate, loc) })), field(t('cr.c.monthly'), fm.money(c.monthly)), field(t('cr.c.end'), monthName(new Date(c.endsAt).toISOString().slice(0, 7), loc))),
      h('p', { class: 'dim small' }, t('cr.c.repaid', { percent: fm.percent(repaidShare(c.borrowed, c.principal)), of: fm.money(c.borrowed) })));
  };
  const loanCard = (l: LoanLine): HTMLElement => h('li', { class: 'cr-card loan' },
    h('div', { class: 'cr-card-head static' }, h('span', { class: 'col tight' }, h('strong', null, t('cr.c.loan', { registration: l.registration })), h('span', { class: 'dim small' }, t('cr.c.loan.secured'))), h('span', { class: 'mono strong' }, fm.money(l.principal))),
    h('div', { class: 'cr-fields' }, field(t('cr.c.rate'), t('cr.c.rate.fixed', { rate: percent1(l.rate, loc) })), field(t('cr.c.monthly'), fm.money(l.monthly)), field(t('cr.c.left'), tp('cr.c.months', l.months - l.monthsPaid))));
  const list = panel({ title: t('cr.c.detail'), action: button(t('cr.c.new'), { variant: 'secondary', key: 'N', onclick: () => go('#finance/credit-new') }), id: 'cr-detail' },
    data.credits.length + data.loans.length === 0 ? h('p', { class: 'dim' }, t('cr.c.none')) : h('ul', { class: 'plain cr-cards' }, data.credits.map(creditCard), data.loans.map(loanCard)),
    data.loans.length > 0 ? h('p', { class: 'dim small' }, t('cr.c.loan.note')) : null);

  // ------------------------------------------------------------ early repayment: simulate, then repay
  const sheet = (q: PrepayQuote): HTMLElement => h('div', { class: 'col' },
    h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.c.sim.amount')), h('span', { class: 'line-value strong' }, fm.money(q.amount))),
    q.penalty > 0 ? h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.c.sim.penalty')), h('span', { class: 'line-value' }, signedMoney(-q.penalty))) : null,
    h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.c.sim.total')), h('span', { class: 'line-value strong' }, fm.money(q.total))),
    h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.c.sim.after')), h('span', { class: 'line-value' }, q.closes ? t('cr.c.sim.closed') : t('cr.c.sim.monthly', { amount: fm.money(q.monthlyAfter), n: q.monthsLeft }))),
    h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.c.sim.saved')), h('span', { class: 'line-value rp-pos' }, fm.money(q.saved))),
    h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.c.sim.balance')), h('span', { class: `line-value${q.balanceAfter < 0 ? ' rp-neg' : ''}` }, fm.money(q.balanceAfter))),
    q.refusal ? h('p', { class: 'cr-refusal', role: 'alert' }, icon('triangle-alert', 14), ' ', t('cr.c.sim.refusal')) : null);
  const repay = (): void => {
    if (!sim || !selected) return;
    const body = sim.full ? { full: true as const } : { amount: clampPrepay(sim.amount, selected.principal) };
    void act(t('cr.c.sim.done'), () => prepayCredit(selected.id, body), ctx.refresh).then((ok) => { if (ok) { sim = null; redraw(); } });
  };
  const simulator = ((): HTMLElement => {
    if (!selected) return panel({ title: t('cr.c.sim.title'), id: 'cr-sim' }, h('p', { class: 'dim' }, t('cr.c.sim.none')), h('div', { class: 'row' }, button(t('cr.c.new'), { variant: 'primary', key: t('key.enter'), onclick: () => go('#finance/credit-new') })));
    if (!sim || !quote) {
      return panel({ title: t('cr.c.sim.title'), action: t('cr.c.credit', { id: selected.id }), id: 'cr-sim' }, h('p', { class: 'dim' }, t('cr.c.sim.intro', { penalty: selected.earlyPenaltyPct })),
        h('div', { class: 'row' }, button(t('cr.c.sim.run'), { variant: 'primary', key: t('key.enter'), onclick: () => { sim = { id: selected.id, full: true, amount: selected.principal }; redraw(); } })));
    }
    const current = sim;
    const amount = h('input', { type: 'number', id: 'cr-sim-amount', min: 1, max: selected.principal, step: 1000, value: String(clampPrepay(current.amount, selected.principal)), disabled: current.full, 'aria-label': t('cr.c.sim.amount'),
      onchange: (e: Event) => { current.amount = Number((e.target as HTMLInputElement).value); redraw(); } });
    return panel({ title: t('cr.c.sim.title'), action: t('cr.c.credit', { id: selected.id }), id: 'cr-sim' },
      h('div', { class: 'segments', role: 'group', 'aria-label': t('cr.c.sim.mode') },
        h('button', { type: 'button', class: 'seg', 'aria-pressed': String(current.full), onclick: () => { current.full = true; redraw(); } }, h('span', null, t('cr.c.sim.full'))),
        h('button', { type: 'button', class: 'seg', 'aria-pressed': String(!current.full), onclick: () => { current.full = false; if (current.amount >= selected.principal) current.amount = Math.round(selected.principal / 2); redraw(); } }, h('span', null, t('cr.c.sim.part')))),
      h('label', { class: 'cr-amount', for: 'cr-sim-amount' }, h('span', { class: 'dim small' }, t('cr.c.sim.amount')), amount), sheet(quote),
      h('div', { class: 'row' },
        button(t('cr.c.sim.confirm', { amount: fm.money(quote.total) }), { variant: 'primary', key: t('key.enter'), disabled: quote.refusal !== null, onclick: repay }),
        button(t('cr.c.sim.close'), { variant: 'ghost', icon: 'chevron-right', onclick: () => { sim = null; redraw(); } })));
  })();

  // ------------------------------------------------------------ the overdraft
  const od = data.overdraft;
  const overdraft = panel({ title: t('cr.c.od.title'), action: od.over ? badge('rejected', t('cr.c.od.over.tag')) : badge('neutral', t('cr.c.od.limit', { limit: fm.money(od.limit), rate: percent1(od.rate, loc) })), id: 'cr-overdraft' },
    h('p', { class: 'muted' }, t('cr.c.od.body', { limit: fm.money(od.limit), rate: percent1(od.rate, loc) })),
    od.low < 0 ? h('p', { class: od.over ? 'cr-refusal' : 'rp-neg' }, t('cr.c.od.month', { low: fm.money(od.low), interest: fm.money(od.interest) })) : h('p', { class: 'dim small' }, t('cr.c.od.unused')),
    od.over ? h('p', { class: 'cr-refusal', role: 'alert' }, icon('triangle-alert', 14), ' ', t('cr.c.od.over')) : null,
    h('p', { class: 'dim small' }, t('cr.c.unpaid', { pct: UNPAID_FEE_PCT, rep: CREDIT_LATE_REPUTATION })));

  const view = h('div', { class: 'rp-screen cr-screen' }, header, h('div', { class: 'rp-body' }, chart, h('div', { class: 'rp-side cr-side' }, list, simulator, overdraft)));
  return {
    title: t('cr.c.title'), scene: 'finance', tab: 'hubs', view, back, wide: false,
    hints: [{ key: t('key.esc'), label: t('rp.nav.cash') }, { key: '← →', label: t('rp.hint.month') }, { key: 'T', label: t('cr.c.hint.credit') }, { key: 'N', label: t('cr.c.hint.new') }, { key: t('key.enter'), label: t('cr.c.hint.sim') }],
    keys: { left: step(-1), right: step(1), t: cycleCredit, n: () => go('#finance/credit-new') },
  };
}
