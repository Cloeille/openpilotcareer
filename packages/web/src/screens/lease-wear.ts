import { fetchWear, refurbish, type Choice, type ComponentWear, type WearView } from '../api-parts.ts';
import { button, icon, panel, signLocation, stat, titleBlock } from '../components.ts';
import { locale, perform } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { chartBars, choicesOf, effectLines, itemsOf, leaveAll, pickOf, scenariosOf, stepChoice, wearTone, worksUntil, type Choices } from '../parts-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** The choices on show survive a redraw (a language change, a poll), not a visit to another aircraft. */
const memo: { id: number | null; choices: Choices | null; row: number } = { id: null, choices: null, row: 0 };
const NBSP = '\u00a0';
const CHOICES: readonly Choice[] = ['leave', 'overhaul', 'replace'];
const monthYear = (ms: number, withYear: boolean): string => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', month: withYear ? 'long' : 'short', year: 'numeric' }).format(ms);

/** `#wear/<aircraftId>`: the components of an aircraft with their wear, what to do with each (leave, overhaul, replace) and what that earns or costs. The server prices every selection (`?pick=`); this screen only lays the answer out. */
export async function leaseWear(ctx: Ctx): Promise<Screen> {
  const { snap } = ctx;
  const id = Number(ctx.arg);
  const back = '#fleet';
  const hints = [{ key: t('key.esc'), label: t('hint.back') }];
  const bare = (view: HTMLElement): Screen => ({ title: t('pt.r.title'), scene: 'fleet', tab: 'fleet', back, hints, view });
  const text = (key: Parameters<typeof t>[0]): HTMLElement => h('p', { class: 'error-text', role: 'alert' }, t(key));
  if (!Number.isInteger(id) || id <= 0 || !snap.me.fleet.some((a) => a.id === id)) return bare(text('pt.r.badId'));
  // Without a remembered choice the server's recommendation is the starting point; with one, it prices that selection.
  const asked = memo.id === id ? memo.choices : null;
  const first = await fetchWear(id, asked ? pickOf(asked) : undefined);
  if (!first) return bare(h('div', { class: 'ln-off pt-off panel' }, h('div', { class: 'panel-body' }, icon('wrench', 20), h('h1', { class: 'ln-off-title' }, t('pt.r.noSheetTitle')), h('p', { class: 'muted' }, t('pt.r.noSheet')))));

  const fm = fmt();
  const now = Date.now();
  let view: WearView = first;
  const choices: Choices = asked ?? choicesOf(first);
  Object.assign(memo, { id, choices });
  const parts = first.components;
  memo.row = Math.min(memo.row, parts.length - 1);
  const underway = worksUntil(parts, now);
  const blocked = underway !== null || !view.refurbishable || !view.active;
  const lease = view.lease;
  const months = view.months;
  let working = false;

  const gaugeHost = h('div', { class: 'pt-gauges' });
  const sideHost = h('aside', { class: 'panel pt-invest', 'aria-label': t('pt.r.invest'), 'aria-live': 'polite' });
  const rowHosts = new Map<string, HTMLElement>();

  // ------------------------------------------------------------ header: the aircraft as it is, and after the choices
  const paintGauges = (): void => {
    const { now: a, after: b } = view.kpi;
    const perf = (x: number): string => `${x < -0.0005 ? '−' : ''}${fm.num(Math.abs(Math.round(x * 100)))}${NBSP}%`;
    const gauge = (label: string, was: string, will: string): HTMLElement => stat(label, was, h('span', { class: 'dim' }, will === was ? '' : t('pt.r.after', { value: will })));
    gaugeHost.replaceChildren(
      gauge(t('pt.r.perf'), perf(a.performance), perf(b.performance)),
      gauge(t('pt.r.rel'), fm.percent(a.reliability / 100), fm.percent(b.reliability / 100)),
      gauge(t('pt.r.sat'), `${fm.num(a.satisfaction, 1)} / 5`, `${fm.num(b.satisfaction, 1)} / 5`));
  };

  // ------------------------------------------------------------ the investment panel
  let launch: () => void = () => undefined;
  const scenario = (label: string, value: string, note: string): HTMLElement =>
    h('div', { class: 'col tight pt-scn' }, h('div', { class: 'line' }, h('span', null, label), h('span', { class: 'strong' }, value)), h('span', { class: 'dim small' }, note));
  const paintSide = (): void => {
    const tot = view.totals;
    const sc = scenariosOf(tot);
    const works = itemsOf(choices).length;
    const bars = chartBars(tot.cashCurve);
    const after = view.balanceAfter;
    const affordable = after >= 0;
    const verdict = works === 0 ? t('pt.r.nothing') : t(tot.give > 0 ? 'pt.r.yes' : 'pt.r.no', { cost: fm.money(tot.cost), gross: fm.money(sc.gross) });
    const end = lease?.endsAt ?? now + months * 30.4375 * 86_400_000;
    const chart = bars.length === 0 || works === 0 ? null : h('div', { class: 'pt-cash' },
      h('div', { class: 'pt-cash-head' }, h('span', { class: 'muted' }, t('pt.r.cash')), h('span', { class: 'strong' }, tot.breakEvenMonth ? t('pt.r.breakEven', { n: fm.ordinal(tot.breakEvenMonth) }) : t('pt.r.noBreak'))),
      h('div', { class: 'pt-bars', role: 'img', 'aria-label': t('pt.r.chartAlt', { from: monthYear(now, true), to: monthYear(end, true) }) },
        bars.map((b) => h('div', { class: 'pt-bar-col' }, h('div', { class: 'pt-up' }, b.up > 0 ? h('i', { style: `height:${Math.max(2, Math.round(b.up * 60))}px` }) : null), h('i', { class: 'pt-zero' }), h('div', { class: 'pt-down' }, b.down > 0 ? h('i', { style: `height:${Math.max(2, Math.round(b.down * 40))}px` }) : null)))),
      h('div', { class: 'pt-cash-axis dim' }, h('span', null, monthYear(now, false)), h('span', null, lease ? t('pt.r.chartEnd', { month: monthYear(end, false) }) : monthYear(end, false))));
    const run = (): void => {
      if (working || works === 0 || !affordable || blocked) return;
      if (!confirm(t('pt.r.ask', { n: works, cost: fm.money(tot.cost + view.works.ferryCost), days: view.works.days, balance: fm.money(after) }))) return;
      working = true;
      void perform(() => refurbish(id, itemsOf(choices)), (r) => t('pt.r.done', { reg: view.aircraft.registration, date: fm.date(r.downUntil) }), async () => { memo.id = null; await ctx.refresh(); }).finally(() => { working = false; });
    };
    launch = run;
    sideHost.replaceChildren(
      h('header', { class: 'panel-head' }, h('h2', null, t('pt.r.invest'))),
      h('div', { class: 'panel-body' },
        h('div', { class: 'col tight' }, h('span', { class: 'muted' }, t('pt.r.over', { n: months })), h('span', { class: 'pt-verdict-value' }, works === 0 ? fm.money(0) : fm.signedMoney(tot.give)), h('p', { class: 'dim small' }, verdict)),
        chart,
        h('hr', { class: 'pt-rule' }),
        lease
          ? h('div', { class: 'col' },
            scenario(t('pt.r.give'), fm.signedMoney(tot.give), works > 0 ? t('pt.r.giveNote', { amount: fm.money(sc.kept) }) : t('pt.r.netNone')),
            scenario(t('pt.r.buy'), fm.signedMoney(tot.buy), t('pt.r.buyNote', { price: fm.money(lease.purchaseOptionPrice) })))
          : h('div', { class: 'col' }, scenario(t('pt.r.own'), fm.signedMoney(tot.give), t('pt.r.ownNote'))),
        view.works.ferry ? h('p', { class: 'dim small' }, t('pt.r.ferry', { cost: fm.money(view.works.ferryCost) })) : null,
        h('div', { class: 'pt-spacer' }),
        h('div', { class: 'line' }, h('span', { class: 'dim small' }, works > 0 ? tp('pt.r.balance', view.works.days) : t('pt.r.balanceNow')), h('span', { class: `strong${affordable ? '' : ' pt-bad'}` }, fm.money(works > 0 ? after : snap.me.company.balance))),
        !affordable ? h('p', { class: 'pt-bad small', role: 'alert' }, t('pt.r.short')) : null,
        !view.active ? h('p', { class: 'dim small', role: 'status' }, t('pt.r.wearOff')) : !view.refurbishable ? h('p', { class: 'dim small', role: 'status' }, t('pt.r.notYours')) : null,
        underway ? h('p', { class: 'dim small', role: 'status' }, t('pt.r.underway', { date: fm.date(underway) })) : null,
        h('div', { class: 'pt-actions' },
          button(t('pt.r.leaveAll'), { variant: 'secondary', disabled: works === 0 || blocked, onclick: () => { Object.assign(choices, leaveAll(view)); void reprice(); } }),
          button(t('pt.r.launch'), { variant: 'primary', key: t('key.enter'), disabled: works === 0 || !affordable || blocked, onclick: run }))));
  };

  // ------------------------------------------------------------ the table
  const choose = (c: ComponentWear, to: Choice): void => {
    if (blocked || choices[c.component] === to) return;
    choices[c.component] = to;
    void reprice();
  };
  /** Ask the server what the selection is worth; the rows keep their focus while the figures change. */
  async function reprice(): Promise<void> {
    paintRows();
    const next = await fetchWear(id, pickOf(choices)).catch(() => null);
    if (next && memo.id === id) { view = next; paintGauges(); paintSide(); paintRows(); }
  }
  const optionCell = (c: ComponentWear, o: Choice): HTMLElement => {
    const opt = c.choices[o];
    const on = choices[c.component] === o;
    const note = o === 'leave' ? (opt.monthlyLoss > 0 ? t('pt.r.loss', { amount: fm.money(opt.monthlyLoss) }) : t('pt.r.noLoss'))
      : opt.paybackMonths === null ? t('pt.r.never') : t('pt.r.pay', { n: fm.num(opt.paybackMonths) });
    return h('label', { class: `pt-op${on ? ' on' : ''}` },
      h('span', { class: 'pt-op-head' }, h('input', { type: 'radio', class: 'pt-radio', name: `pt-${c.component}`, value: o, checked: on, disabled: blocked, onchange: () => choose(c, o) }), h('span', { class: 'pt-cost' }, fm.money(opt.cost))),
      h('span', { class: `pt-op-note${on ? ' sel' : ''}` }, note));
  };
  const rowOf = (c: ComponentWear, i: number): HTMLElement => {
    const worn = wearTone(c.wearPct) === 'warn';
    const eff = effectLines(c.effects);
    const sub = [eff.fuelPct ? t('pt.r.eff.fuel', { n: fm.num(eff.fuelPct) }) : null, eff.loadPct ? t('pt.r.eff.load', { n: fm.num(eff.loadPct) }) : null].filter(Boolean).join(' · ');
    const net = choices[c.component] === 'leave' ? null : c.choices[choices[c.component] as 'overhaul' | 'replace'];
    const row: HTMLElement = h('div', {
      class: `pt-row${memo.row === i ? ' sel' : ''}`, 'data-row': '', tabindex: 0, role: 'group', 'aria-label': t('pt.r.group', { component: t(`pt.c.${c.component}`) }),
      onfocus: () => { memo.row = i; rowHosts.forEach((r, k) => r.classList.toggle('sel', k === c.component)); },
      /** Enter on the row or on one of its radios starts the works, as the hint says: the global handler would only click the row, or leave a radio alone. */
      onkeydown: (e: KeyboardEvent) => { const el = e.target as HTMLElement; if (e.key === 'Enter' && (el === row || el.matches('input[type=radio]'))) { e.preventDefault(); launch(); } },
    },
      h('div', { class: 'pt-comp' },
        h('div', { class: 'pt-comp-head' }, h('span', { class: 'pt-comp-name' }, t(`pt.c.${c.component}`)), h('span', { class: `pt-wear${worn ? ' warn' : ''}` }, t('pt.r.worn', { n: fm.num(Math.round(c.wearPct)) }))),
        h('div', { class: `wear-track${worn ? ' hot' : ''}`, role: 'progressbar', 'aria-label': t(`pt.c.${c.component}`), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(c.wearPct) }, h('span', { style: `width:${Math.round(c.wearPct)}%` }))),
      h('div', { class: 'pt-eff' }, h('span', { class: 'pt-eff-main' }, eff.main ? t(`pt.r.eff.${eff.main.kind}`, { n: fm.num(eff.main.value, eff.main.kind === 'satisfaction' ? 1 : 0) }) : '–'), sub ? h('span', { class: 'dim small' }, sub) : null),
      CHOICES.map((o) => optionCell(c, o)),
      h('div', { class: 'pt-net' }, h('span', { class: 'pt-net-main' }, net ? fm.signedMoney(net.net) : fm.money(0)), h('span', { class: 'dim small' }, net ? (lease ? t('pt.r.netBuy', { amount: fm.signedMoney(net.netIfBought) }) : t('pt.r.noteOwn', { n: net.days })) : t('pt.r.netNone'))));
    rowHosts.set(c.component, row);
    return row;
  };
  const rowsHost = h('div', { class: 'pt-rows' });
  function paintRows(): void {
    const focused = document.activeElement?.closest<HTMLElement>('.pt-row');
    const idx = focused ? [...document.querySelectorAll('.pt-row')].indexOf(focused) : -1;
    rowHosts.clear();
    rowsHost.replaceChildren(...view.components.map(rowOf));
    if (idx >= 0) document.querySelectorAll<HTMLElement>('.pt-row')[idx]?.focus();
  }
  const table = h('div', { class: 'pt-table', role: 'group', 'aria-label': t('pt.r.table') },
    h('div', { class: 'pt-cols-head dim' }, h('span', { class: 'pt-comp' }, t('pt.r.col.part')), h('span', { class: 'pt-eff' }, t('pt.r.col.effect')), h('span', { class: 'pt-op' }, t('pt.r.col.leave')), h('span', { class: 'pt-op' }, t('pt.r.col.overhaul')), h('span', { class: 'pt-op' }, t('pt.r.col.replace')), h('span', { class: 'pt-net' }, t('pt.r.col.net', { n: months }))),
    rowsHost);
  paintGauges(); paintSide(); paintRows();

  const a = view.aircraft;
  const end = lease?.endsAt ?? null;
  const sub = lease
    ? t('pt.r.subLease', { type: a.typeName, reg: a.registration, lessor: lease.lessor ?? '–', left: tp('pt.r.left', lease.monthsLeft) })
    : t('pt.r.subOwn', { type: a.typeName, reg: a.registration, own: t(`fin.own.${a.ownership}` as 'fin.own.owned'), wear: fm.num(Math.round(a.wearPct)) });
  const left = panel({ title: t('pt.r.table'), action: h('span', { class: 'dim' }, end ? t('pt.r.calc', { month: monthYear(end, true) }) : t('pt.r.calcOwn', { n: months })), id: 'pt-table', class: 'pt-main' }, table, h('p', { class: 'dim small pt-foot' }, t('pt.r.foot', { h: fm.num(view.hoursPerMonth) })));
  const identity = titleBlock(h('span', { class: 'row tight' }, signLocation(snap.me.fleet.find((x) => x.id === id)?.location ?? snap.me.hubs[0] ?? ''), h('span', { class: 'pt-crumb' }, t(lease ? 'pt.r.crumb' : 'pt.r.crumbOwn', { reg: a.registration }))), t('pt.r.title'), h('p', { class: 'muted pt-sub' }, sub));
  const screen = h('div', { class: 'pt-screen' }, h('div', { class: 'pt-head' }, identity, gaugeHost), h('div', { class: 'pt-body lease' }, left, sideHost));

  const next = (dir: 1 | -1) => (): void => { const c = view.components[memo.row]; if (c) choose(c, stepChoice(choices[c.component] ?? 'leave', dir)); };
  return {
    title: t('pt.r.title'), scene: 'fleet', tab: 'fleet', view: screen, back,
    hints: [...hints, { key: '↑ ↓', label: t('pt.hint.component') }, { key: '← →', label: t('pt.hint.choice') }, { key: t('key.enter'), label: t('pt.hint.launch') }],
    keys: { left: next(-1), right: next(1) },
  };
}
