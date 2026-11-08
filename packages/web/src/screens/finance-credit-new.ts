import { CREDIT_MIN, CREDIT_STEP, type CreditSheet } from '@opc/shared';
import { fetchCredits, quoteCredit, signCredit } from '../api-credit.ts';
import { act } from '../actions.ts';
import { button, icon, panel, titleBlock } from '../components.ts';
import { BANK_KEY, CREDIT_BANK_IDS, CREDIT_MONTHS, REFUSAL_KEY, cycle, firstDraft, percent1, stepAmount, clampAmount, type Draft } from '../credit-view.ts';
import { errorText } from '../error-text.ts';
import { locale } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { figure, reportsOff } from '../reports-ui.ts';
import { monthName } from '../reports-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h, notify } from '../ui.ts';

/** The arrows a focused slider answers to: the same steps as the screen's ← →. */
const ARROW_DIR: Record<string, 1 | -1 | undefined> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
/** The choice survives a redraw (a language change), not a new visit. */
let draft: Draft | null = null;

/** `#finance/credit-new`: how much, for how long, at which bank. Every figure (instalment, cost, ratio, rating, balance after, why it would be refused) is the server's quote of the draft; signing books it. */
export async function financeCreditNew(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#finance/credits';
  const data = await fetchCredits();
  if (!data) return { title: t('cr.n.title'), scene: 'finance', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('cr.c.title') }], view: reportsOff() };

  const fm = fmt(), loc = locale();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const d: Draft = (draft ??= firstDraft(data.room));
  d.amount = clampAmount(d.amount, data.room);
  let sheet: CreditSheet | null = null;
  try { sheet = await quoteCredit(d); } catch (e) { notify(errorText(e), 'error'); }
  const q = sheet?.quote ?? null;

  const change = (patch: Partial<Draft>): void => { if ((Object.keys(patch) as (keyof Draft)[]).every((k) => d[k] === patch[k])) return; Object.assign(d, patch); redraw(); };
  const sign = (): void => {
    if (!q || q.refusal) return;
    void act(t('cr.n.done', { amount: fm.money(q.net) }), () => signCredit(d), ctx.refresh).then((ok) => { if (ok) { draft = null; go('#finance/credits'); } });
  };

  const header = h('div', { class: 'ln-header rp-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, `${t('rp.crumb')} · ${t('cr.n.crumb')}`)), t('cr.n.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('cr.n.sub'))),
    h('div', { class: 'rp-figures' },
      figure(t('cr.c.room'), fm.money(data.room), t('cr.c.room.sub', { ceiling: fm.money(data.ceiling), n: data.active, max: data.maxActive })),
      figure(t('cr.c.rating'), q?.rating.before ?? data.rating, data.ratio === null ? t('cr.c.ratio.none') : t('cr.c.ratio.sub', { amount: fm.money(data.revenue), month: monthName(data.revenueMonth, loc, false) }))));

  // ------------------------------------------------------------ amount, duration, bank
  const slider = h('input', { type: 'range', id: 'cr-amount', min: CREDIT_MIN, max: clampAmount(data.room, data.room), step: CREDIT_STEP, value: String(d.amount), disabled: data.room < CREDIT_MIN,
    'aria-label': t('cr.n.amount'), 'aria-valuetext': fm.money(d.amount), onchange: (e: Event) => change({ amount: Number((e.target as HTMLInputElement).value) }),
    onkeydown: (e: KeyboardEvent) => { const dir = ARROW_DIR[e.key]; if (dir) { e.preventDefault(); change({ amount: stepAmount(d.amount, dir, data.room) }); } } });
  const amountBlock = h('div', { class: 'cr-amount-block' },
    h('label', { class: 'cr-amount-label', for: 'cr-amount' }, h('span', { class: 'dim small' }, t('cr.n.amount')), h('strong', { class: 'cr-amount-value' }, fm.money(d.amount))),
    slider, h('div', { class: 'cr-range dim small' }, h('span', null, fm.money(CREDIT_MIN)), h('span', null, data.room < CREDIT_MIN ? t('cr.n.noroom') : t('cr.n.ceiling', { ceiling: fm.money(data.room) })), h('span', null, fm.money(clampAmount(data.room, data.room)))));
  const duration = h('div', { class: 'cr-durations', role: 'radiogroup', 'aria-label': t('cr.n.duration') }, (sheet?.durations ?? CREDIT_MONTHS.map((months) => ({ months, monthly: 0, cost: 0 }))).map((o) =>
    h('button', { type: 'button', id: `cr-dur-${o.months}`, class: `cr-duration${o.months === d.months ? ' on' : ''}`, role: 'radio', 'aria-checked': String(o.months === d.months), 'data-row': '', onfocus: () => change({ months: o.months }), onclick: () => change({ months: o.months }) },
      h('strong', null, t('cr.n.months', { n: o.months })), h('span', { class: 'mono' }, t('cr.n.perMonth', { amount: fm.money(o.monthly) })), h('span', { class: 'dim small' }, t('cr.n.cost', { amount: fm.money(o.cost) })))));
  const form = panel({ title: t('cr.n.form'), action: t(BANK_KEY[d.bank]), id: 'cr-form', class: 'rp-main' }, amountBlock, h('h3', { class: 'cr-h' }, t('cr.n.duration')), duration, h('p', { class: 'dim small' }, t('cr.n.durationNote')));

  // ------------------------------------------------------------ the three banks
  const banks = panel({ title: t('cr.n.banks'), action: t('cr.n.banks.sub', { rating: q?.rating.before ?? data.rating }), id: 'cr-banks' },
    h('div', { class: 'cr-banks', role: 'radiogroup', 'aria-label': t('cr.n.banks') }, (sheet?.banks ?? []).map((o) =>
      h('button', { type: 'button', id: `cr-bank-${o.bank}`, class: `cr-bank${o.bank === d.bank ? ' on' : ''}`, role: 'radio', 'aria-checked': String(o.bank === d.bank), onclick: () => change({ bank: o.bank }) },
        h('span', { class: 'col tight' }, h('strong', null, t(BANK_KEY[o.bank])), h('span', { class: 'dim small' }, t('cr.n.bank.terms', { rate: percent1(o.rate, loc), fee: fm.money(o.fee), penalty: o.earlyPenaltyPct }))),
        h('span', { class: 'col tight end' }, h('span', { class: 'mono strong' }, t('cr.n.perMonth', { amount: fm.money(o.monthly) })), h('span', { class: 'dim small' }, t('cr.n.cost', { amount: fm.money(o.cost) })))))));

  // ------------------------------------------------------------ what signing does
  const summary = !q ? panel({ title: t('cr.n.after'), id: 'cr-after' }, h('p', { class: 'dim' }, t('cr.n.noquote'))) : panel({ title: t('cr.n.after'), action: t('cr.n.firstDebit', { date: fm.date(q.firstDebit) }), id: 'cr-after' },
    h('div', { class: 'col' },
      h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.n.monthly')), h('span', { class: 'line-value strong' }, t('cr.n.perMonthTimes', { amount: fm.money(q.monthly), n: q.months }))),
      h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.n.total')), h('span', { class: 'line-value strong' }, fm.money(q.cost))),
      h('p', { class: 'dim small' }, t('cr.n.split', { interest: fm.money(q.interest), fee: fm.money(q.fee), insurance: fm.money(q.insurance) })),
      h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.n.ratio')), h('span', { class: 'line-value' }, `${q.ratio.before === null ? '–' : percent1(q.ratio.before, loc)} → ${q.ratio.after === null ? '–' : percent1(q.ratio.after, loc)}`)),
      h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.n.rating')), h('span', { class: 'line-value' }, q.rating.before === q.rating.after ? t('cr.n.rating.same', { rating: q.rating.after }) : `${q.rating.before} → ${q.rating.after}`)),
      h('div', { class: 'line' }, h('span', { class: 'line-label' }, t('cr.n.balance')), h('span', { class: 'line-value strong' }, fm.money(q.balanceAfter)), h('span', { class: 'dim small' }, t('cr.n.net', { amount: fm.money(q.net) }))),
      q.refusal ? h('p', { class: 'cr-refusal', role: 'alert' }, icon('triangle-alert', 14), ' ', t(REFUSAL_KEY[q.refusal])) : null),
    h('div', { class: 'row' },
      button(t('cr.n.sign'), { variant: 'primary', key: t('key.enter'), disabled: !q || q.refusal !== null, onclick: sign }),
      button(t('cr.n.cancel'), { variant: 'ghost', icon: 'chevron-right', onclick: () => { draft = null; go(back); } })));

  const view = h('div', { class: 'rp-screen cr-screen' }, header, h('div', { class: 'rp-body' }, form, h('div', { class: 'rp-side cr-side' }, banks, summary)));
  return {
    title: t('cr.n.title'), scene: 'finance', tab: 'hubs', view, back, wide: false,
    hints: [{ key: t('key.esc'), label: t('cr.c.title') }, { key: '← →', label: t('cr.n.hint.amount') }, { key: '↑ ↓', label: t('cr.n.hint.duration') }, { key: 'T', label: t('cr.n.hint.bank') }, { key: t('key.enter'), label: t('cr.n.hint.sign') }],
    keys: {
      left: () => change({ amount: stepAmount(d.amount, -1, data.room) }), right: () => change({ amount: stepAmount(d.amount, 1, data.room) }),
      t: () => change({ bank: cycle(CREDIT_BANK_IDS, d.bank, 1) }),
    },
  };
}
