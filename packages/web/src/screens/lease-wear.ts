import { refurbish, fetchWear, WEAR_ACTIONS, type ComponentId, type ComponentWear, type WearAction, type WearView } from '../api-parts.ts';
import { icon, button, panel, signLocation, stat, titleBlock } from '../components.ts';
import { locale, perform } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { breakEven, cashCurve, chartBars, defaultChoices, gaugesOf, itemsOf, leaveAll, stepAction, totalsOf, wearTone, worksUntil, type Choices } from '../parts-view.ts';
import { partsOff } from '../parts-ui.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** The choices on show survive a redraw (a language change, a poll), not a visit to another aircraft. */
const memo: { id: number | null; choices: Choices | null; row: number } = { id: null, choices: null, row: 0 };

const NBSP = '\u00a0';
const monthYear = (ms: number, withYear: boolean): string => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', month: withYear ? 'long' : 'short', year: 'numeric' }).format(ms);

/** `#wear/<aircraftId>`: the components of a leased aircraft with their wear, what to do with each (leave, overhaul, replace) and what that earns or costs before the aircraft goes back. */
export async function leaseWear(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const id = Number(ctx.arg);
  const back = '#fleet';
  const hints = [{ key: t('key.esc'), label: t('hint.back') }];
  const bare = (view: HTMLElement): Screen => ({ title: t('pt.r.title'), scene: 'fleet', tab: 'fleet', back, hints, view });
  if (!Number.isInteger(id) || id <= 0) return bare(h('p', { class: 'error-text', role: 'alert' }, t('pt.r.badId')));
  const plane = snap.me.fleet.find((a) => a.id === id);
  if (!plane) return bare(h('p', { class: 'error-text', role: 'alert' }, t('pt.r.badId')));
  const view = await fetchWear(id);
  if (!view) return bare(h('div', { class: 'ln-off pt-off panel' }, h('div', { class: 'panel-body' }, icon('wrench', 20), h('h1', { class: 'ln-off-title' }, t('pt.r.noSheetTitle')), h('p', { class: 'muted' }, t('pt.r.noSheet')))));

  const fm = fmt();
  const now = Date.now();
  const a = view.aircraft;
  if (memo.id !== id || !memo.choices) Object.assign(memo, { id, choices: defaultChoices(view), row: 0 });
  const choices = memo.choices!;
  const parts = view.components;
  memo.row = Math.min(memo.row, parts.length - 1);
  const underway = worksUntil(view, now);
  const balance = snap.me.company.balance;
  let working = false;

  // ------------------------------------------------------------ pieces that repaint when a choice changes
  const gaugeHost = h('div', { class: 'pt-gauges' });
  const sideHost = h('aside', { class: 'panel pt-invest', 'aria-label': t('pt.r.invest'), 'aria-live': 'polite' });
  const rowHosts = new Map<ComponentId, HTMLElement>();

  const gauge = (label: string, now_: string, after: string, changed: boolean): HTMLElement =>
    stat(label, now_, h('span', { class: 'dim' }, changed ? t('pt.r.after', { value: after }) : after === now_ ? '' : t('pt.r.after', { value: after })));
  const paintGauges = (): void => {
    const g = gaugesOf(view, choices);
    const sign = (n: number): string => (n === 0 ? `0${NBSP}%` : `−${fm.num(Math.abs(n))}${NBSP}%`);
    gaugeHost.replaceChildren(
      gauge(t('pt.r.perf'), sign(g.performance.now), sign(g.performance.after), g.performance.after !== g.performance.now),
      gauge(t('pt.r.rel'), fm.percent(g.reliability.now / 100), fm.percent(Math.min(100, g.reliability.after) / 100), g.reliability.after !== g.reliability.now),
      gauge(t('pt.r.sat'), `${fm.num(g.satisfaction.now, 1)} / 5`, `${fm.num(Math.min(5, g.satisfaction.after), 1)} / 5`, g.satisfaction.after !== g.satisfaction.now));
  };

  const paintSide = (): void => {
    const totals = totalsOf(view, choices);
    const curve = cashCurve(totals, a.monthsLeft);
    const bars = chartBars(curve);
    const even = breakEven(curve);
    const after = balance - totals.cost;
    const affordable = after >= 0;
    const verdict = totals.works === 0 ? t('pt.r.nothing')
      : t(totals.netReturn > 0 ? 'pt.r.yes' : 'pt.r.no', { cost: fm.money(totals.cost), gross: fm.money(totals.gross) });
    const first = Date.now();
    const chart = bars.length === 0 || totals.works === 0 ? null : h('div', { class: 'pt-cash' },
      h('div', { class: 'pt-cash-head' }, h('span', { class: 'muted' }, t('pt.r.cash')), h('span', { class: 'strong' }, even ? t('pt.r.breakEven', { n: fm.ordinal(even) }) : t('pt.r.noBreak'))),
      h('div', { class: 'pt-bars', role: 'img', 'aria-label': t('pt.r.chartAlt', { from: monthYear(first, true), to: monthYear(a.endsAt, true) }) },
        bars.map((b) => h('div', { class: 'pt-bar-col' }, h('div', { class: 'pt-up' }, b.up > 0 ? h('i', { style: `height:${Math.max(2, Math.round(b.up * 72))}px` }) : null), h('i', { class: 'pt-zero' }), h('div', { class: 'pt-down' }, b.down > 0 ? h('i', { style: `height:${Math.max(2, Math.round(b.down * 48))}px` }) : null)))),
      h('div', { class: 'pt-cash-axis dim' }, h('span', null, monthYear(first, false)), h('span', null, t('pt.r.chartEnd', { month: monthYear(a.endsAt, false) }))));
    const run = (): void => {
      if (working || totals.works === 0 || !affordable || underway) return;
      if (!confirm(t('pt.r.ask', { n: totals.works, cost: fm.money(totals.cost), days: totals.downDays, balance: fm.money(after) }))) return;
      working = true;
      void perform(() => refurbish(id, itemsOf(choices)), (r) => t('pt.r.done', { reg: a.registration, date: fm.date(r.downUntil) }), async () => { memo.id = null; await ctx.refresh(); }).finally(() => { working = false; });
    };
    sideHost.replaceChildren(
      h('header', { class: 'panel-head' }, h('h2', null, t('pt.r.invest'))),
      h('div', { class: 'panel-body' },
        h('div', { class: 'col tight' }, h('span', { class: 'muted' }, t('pt.r.over', { n: a.monthsLeft })), h('span', { class: 'pt-verdict-value' }, totals.works === 0 ? fm.money(0) : fm.signedMoney(totals.netReturn)), h('p', { class: 'dim small' }, verdict)),
        chart,
        h('hr', { class: 'pt-rule' }),
        h('div', { class: 'col' },
          scenario(t('pt.r.give'), fm.signedMoney(totals.netReturn), totals.works > 0 ? t('pt.r.giveNote', { amount: fm.money(totals.residual) }) : t('pt.r.netNone')),
          scenario(t('pt.r.buy'), fm.signedMoney(totals.netBuy), t('pt.r.buyNote', { price: fm.money(a.purchaseOptionPrice) }))),
        h('div', { class: 'pt-spacer' }),
        h('div', { class: 'line' }, h('span', { class: 'dim small' }, totals.works > 0 ? tp('pt.r.balance', totals.downDays) : t('pt.r.balanceNow')), h('span', { class: `strong${affordable ? '' : ' pt-bad'}` }, fm.money(totals.works > 0 ? after : balance))),
        !affordable ? h('p', { class: 'pt-bad small', role: 'alert' }, t('pt.r.short')) : null,
        underway ? h('p', { class: 'dim small', role: 'status' }, t('pt.r.underway', { date: fm.date(underway) })) : null,
        h('div', { class: 'pt-actions' },
          button(t('pt.r.leaveAll'), { variant: 'secondary', disabled: totals.works === 0 || !!underway, onclick: () => { Object.assign(choices, leaveAll(view)); paintAll(); } }),
          button(t('pt.r.launch'), { variant: 'primary', key: t('key.enter'), disabled: totals.works === 0 || !affordable || !!underway, onclick: run }))));
    launch = run;
  };
  let launch: () => void = () => undefined;
  const scenario = (label: string, value: string, note: string): HTMLElement =>
    h('div', { class: 'col tight pt-scn' }, h('div', { class: 'line' }, h('span', null, label), h('span', { class: 'strong' }, value)), h('span', { class: 'dim small' }, note));

  // ------------------------------------------------------------ the table
  const choose = (c: ComponentWear, to: WearAction): void => {
    if (underway) return;
    choices[c.component] = to;
    paintAll();
  };
  const optionCell = (c: ComponentWear, o: WearAction): HTMLElement => {
    const opt = view.choices[c.component][o];
    const on = choices[c.component] === o;
    const note = o === 'leave' ? (opt.monthlyGain < 0 ? t('pt.r.loss', { amount: fm.money(-opt.monthlyGain) }) : c.suggested === 'leave' && c.refurbUntil === null ? t('pt.r.noLoss') : t('pt.r.noLoss'))
      : opt.paybackMonths === null ? t('pt.r.never') : t('pt.r.pay', { n: fm.num(opt.paybackMonths) });
    const lose = o === 'leave' ? view.choices[c.component].overhaul.monthlyGain : 0;
    const leaveNote = o === 'leave' && lose > 0 ? t('pt.r.loss', { amount: fm.money(lose) }) : note;
    return h('label', { class: `pt-op${on ? ' on' : ''}` },
      h('span', { class: 'pt-op-head' },
        h('input', { type: 'radio', class: 'pt-radio', name: `pt-${c.component}`, value: o, checked: on, disabled: !!underway, onchange: () => choose(c, o) }),
        h('span', { class: 'pt-cost' }, fm.money(opt.cost))),
      h('span', { class: `pt-op-note${on ? ' sel' : ''}` }, leaveNote));
  };
  const rowOf = (c: ComponentWear, i: number): HTMLElement => {
    const worn = wearTone(c.wearPct) === 'warn';
    const opt = view.choices[c.component][choices[c.component]];
    const eff = c.effect;
    const main = t(`pt.r.eff.${eff.kind}` as const, { n: fm.num(eff.value, eff.kind === 'satisfaction' ? 1 : 0) });
    const sub = [eff.fuelPct ? t('pt.r.eff.fuel', { n: fm.num(eff.fuelPct) }) : null, eff.loadPct ? t('pt.r.eff.load', { n: fm.num(eff.loadPct) }) : null].filter(Boolean).join(' · ');
    const net = choices[c.component] === 'leave' ? null : opt;
    const row = h('div', {
      class: `pt-row${memo.row === i ? ' sel' : ''}`, 'data-row': '', tabindex: 0, role: 'group',
      'aria-label': t('pt.r.group', { component: t(`pt.c.${c.component}`) }),
      onfocus: () => { memo.row = i; rowHosts.forEach((r, k) => r.classList.toggle('sel', k === c.component)); },
    },
      h('div', { class: 'pt-comp' },
        h('div', { class: 'pt-comp-head' }, h('span', { class: 'pt-comp-name' }, t(`pt.c.${c.component}`)), h('span', { class: `pt-wear${worn ? ' warn' : ''}` }, t('pt.r.worn', { n: fm.num(Math.round(c.wearPct)) }))),
        h('div', { class: `wear-track${worn ? ' hot' : ''}`, role: 'progressbar', 'aria-label': t(`pt.c.${c.component}`), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(c.wearPct) }, h('span', { style: `width:${Math.round(c.wearPct)}%` })),
        c.detail ? h('span', { class: 'dim small' }, c.detail) : null),
      h('div', { class: 'pt-eff' }, h('span', { class: 'pt-eff-main' }, main), sub ? h('span', { class: 'dim small' }, sub) : null),
      WEAR_ACTIONS.map((o) => optionCell(c, o)),
      h('div', { class: 'pt-net' }, h('span', { class: 'pt-net-main' }, net ? fm.signedMoney(net.netReturn) : fm.money(0)), h('span', { class: 'dim small' }, net ? t('pt.r.netBuy', { amount: fm.signedMoney(net.netBuy) }) : t('pt.r.netNone'))));
    rowHosts.set(c.component, row);
    return row;
  };
  const table = h('div', { class: 'pt-table', role: 'group', 'aria-label': t('pt.r.table') },
    h('div', { class: 'pt-cols-head dim' }, h('span', { class: 'pt-comp' }, t('pt.r.col.part')), h('span', { class: 'pt-eff' }, t('pt.r.col.effect')), h('span', { class: 'pt-op' }, t('pt.r.col.leave')), h('span', { class: 'pt-op' }, t('pt.r.col.overhaul')), h('span', { class: 'pt-op' }, t('pt.r.col.replace')), h('span', { class: 'pt-net' }, t('pt.r.col.net', { n: a.monthsLeft }))),
    h('div', { class: 'pt-rows' }, parts.map(rowOf)));
  const repaintRows = (): void => { parts.forEach((c, i) => { const old = rowHosts.get(c.component); const next = rowOf(c, i); old?.replaceWith(next); }); };

  function paintAll(): void { paintGauges(); paintSide(); repaintRowsKeepFocus(); }
  function repaintRowsKeepFocus(): void {
    const focused = document.activeElement?.closest<HTMLElement>('.pt-row');
    const idx = focused ? [...document.querySelectorAll('.pt-row')].indexOf(focused) : -1;
    repaintRows();
    if (idx >= 0) document.querySelectorAll<HTMLElement>('.pt-row')[idx]?.focus();
  }

  paintGauges(); paintSide();
  const left = panel({ title: t('pt.r.table'), action: h('span', { class: 'dim' }, t('pt.r.calc', { month: monthYear(a.endsAt, true) })), id: 'pt-table', class: 'pt-main' }, table, h('p', { class: 'dim small pt-foot' }, t('pt.r.foot', { h: fm.num(a.hoursPerMonth) })));
  const identity = titleBlock(h('span', { class: 'row tight' }, signLocation(a.hub), h('span', { class: 'pt-crumb' }, t('pt.r.crumb', { reg: a.registration }))), t('pt.r.title'),
    h('p', { class: 'muted pt-sub' }, t('pt.r.sub', { type: a.typeName, reg: a.registration, year: a.year, hours: fm.num(a.airframeHours), lessor: a.lessor, left: tp('pt.r.left', a.monthsLeft) })));
  const screen = h('div', { class: 'pt-screen' }, h('div', { class: 'pt-head' }, identity, gaugeHost), h('div', { class: 'pt-body wear' }, left, sideHost));

  const nextAction = (dir: 1 | -1) => (): void => {
    const c = parts[memo.row];
    if (c) choose(c, stepAction(choices[c.component], dir));
  };
  return {
    title: t('pt.r.title'), scene: 'fleet', tab: 'fleet', view: screen, back,
    hints: [...hints, { key: '↑ ↓', label: t('pt.hint.component') }, { key: '← →', label: t('pt.hint.choice') }, { key: t('key.enter'), label: t('pt.hint.launch') }],
    keys: { left: nextAction(-1), right: nextAction(1) },
  };
}
