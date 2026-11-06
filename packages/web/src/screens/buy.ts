import { aircraftPrice, type AircraftType } from '@opc/shared';
import { api } from '../api.ts';
import { airportInfo } from '../airports.ts';
import { fleetQuote, hubUsage, leaseOffers, buyAircraftWith, LOAN_DOWN_PCT, LOAN_MONTHS, LOAN_RATE, type FleetQuote, type HubUsage, type LeaseOffer } from '../api-finance.ts';
import { badge, button, line, panel, segments, titleBlock } from '../components.ts';
import { defaultLoan, findLoan, freeSpots, fundingOptions, loanBreakdown, loanDownPcts, loanMonths, newestOf, parkingSummary, purchaseFees, type FundingOption } from '../finance-view.ts';
import { enterConfirms, hubCity, hubPicker, perform, type HubChoice } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';
import { categoryName } from './fleet.ts';

/** The loan the player chose on the shortfall screen, carried to the confirmation step; cleared when the purchase is cancelled or done. */
let loanPick: { icao: string; downPct: number; months: number } | null = null;
const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

/** Purchase of one aircraft type. Enough cash: choose the base, confirm. Not enough: choose how to finance it (loan or lease), then the same confirmation with the loan in the summary. */
export async function buy(ctx: Ctx): Promise<Screen> {
  const { snap, go, arg } = ctx;
  const { me } = snap;
  const back = '#catalogue';
  const type = arg ? await api<AircraftType>(`/aircraft-types/${encodeURIComponent(arg)}`).catch(() => null) : null;
  const chosen = me.customAircraft.find((c) => c.icao === arg) ?? type;
  if (!chosen) return { title: t('buy.unknown'), scene: 'catalogue', tab: 'fleet', back, hints: [{ key: t('key.esc'), label: t('hint.catalogue') }], view: h('p', { class: 'error-text', role: 'alert' }, t('buy.unknown')) };
  const fm = fmt();
  const balance = me.company.balance;
  const price = aircraftPrice(chosen);
  const usage = await hubUsage().catch((): HubUsage[] | null => null);
  const hubs: HubChoice[] = await Promise.all(me.hubs.map(async (icao) => ({ icao, airport: await airportInfo(icao), free: freeSpots(usage, icao) })));
  let hub = (hubs.find((x) => x.free !== 0) ?? hubs[0])!.icao;
  let quote: FleetQuote | null = await fleetQuote(chosen.icao, hub).catch(() => null);
  const sub = t('buy.sub', { cat: categoryName(chosen.category), seats: chosen.seats, cargo: fm.kg(chosen.cargoKg), kt: fm.kt(chosen.cruiseKts), nm: fm.nm(chosen.rangeNm) });
  const titleExtra = h('div', { class: 'row tight' }, h('p', { class: 'route-line-text' }, sub), chosen.derived ? badge('estimated', t('badge.estimated'), null) : null);
  const fees = purchaseFees(price, quote);
  const total = price + fees;
  const short = total > balance;
  const hints = [{ key: t('key.esc'), label: t('hint.catalogue') }];

  if (short && !(loanPick && loanPick.icao === chosen.icao)) {
    const lease = await leaseOffers({ icao: chosen.icao }).then((o) => o?.[0] ?? null).catch((): LeaseOffer | null => null);
    return shortfall({ ctx, chosen, price, fees, total, quote, lease, back, titleExtra, hints });
  }
  if (loanPick && loanPick.icao !== chosen.icao) loanPick = null;

  // ---- confirmation (step 2 of 2)
  const loans = quote?.loans ?? [];
  let loan = loanPick ? findLoan(loans, loanPick.downPct, loanPick.months) ?? defaultLoan(loans) : null;
  if (loanPick && !loan) loanPick = null;
  const summaryHost = h('div', { class: 'sum-host' });
  const loanHost = h('div');
  const hubNote = h('p', { class: 'dim small fin-hub-note' });
  const parking = parkingSummary(usage);

  const confirm = (): void => {
    const picked = hubs.find((x) => x.icao === hub);
    if (!picked || picked.free === 0) return;
    const b = loan ? loanBreakdown(price, loan, balance, purchaseFees(price, quote)) : null;
    if (b && !b.affordable) return;
    if (!b && price + purchaseFees(price, quote) > balance) return;
    const financing = loan ? { downPct: loan.downPct, months: loan.months } : undefined;
    void perform(() => buyAircraftWith(chosen.icao, hub, financing), (m) => t(loan ? 'fin.buy.doneLoan' : 'fin.buy.doneReg', { aircraft: chosen.name, reg: newestOf(m.fleet, chosen.icao) }), ctx.refresh)
      .then((ok) => { if (ok) { loanPick = null; go('#fleet'); } });
  };
  const drawSummary = (): void => {
    const f = purchaseFees(price, quote);
    const b = loan ? loanBreakdown(price, loan, balance, f) : null;
    const due = b ? b.down : price + f;
    const after = b ? b.balanceAfter : balance - due;
    const ok = b ? b.affordable : after >= 0;
    const picked = hubs.find((x) => x.icao === hub);
    summaryHost.replaceChildren(
      h('div', { class: 'col', style: 'gap:12px' },
        line(t('buy.price'), fm.money(price)),
        f > 0 ? line(t('buy.fees'), fm.money(f)) : null,
        b ? line(t('fin.buy.loanLine', { months: b.months, pct: fm.percent(1 - b.downPct / 100) }), fm.money(-b.financed)) : null),
      h('hr', { class: 'divider' }),
      h('div', { class: 'pay-today' }, h('span', { class: 'label' }, t('fin.buy.payToday')), h('span', { class: 'pay-big' }, fm.money(due))),
      h('div', { class: 'balance-block' },
        line(t('buy.after'), fm.money(after), ok ? '' : 'short'),
        b ? h('p', { class: 'pay-note' }, t('fin.buy.thenPm', { amount: fm.money(b.monthly), months: b.months })) : null),
      h('div', { class: 'fin-actions-row' },
        button(t('buy.cancel'), { variant: 'secondary', onclick: () => { loanPick = null; go(back); } }),
        button(t('buy.confirm'), { variant: 'primary', key: t('key.enter'), disabled: !ok || picked?.free === 0, onclick: confirm })));
  };
  const drawLoan = (): void => {
    if (!loan) { loanHost.replaceChildren(); return; }
    const downs = loanDownPcts(loans);
    const lengths = loanMonths(loans, loan.downPct);
    const set = (downPct: number, months: number): void => {
      const next = findLoan(loans, downPct, months) ?? findLoan(loans, downPct, loanMonths(loans, downPct).sort((a, b) => Math.abs(a - months) - Math.abs(b - months))[0] ?? months);
      if (!next) return;
      loan = next;
      loanPick = { icao: chosen.icao, downPct: next.downPct, months: next.months };
      drawLoan(); drawSummary();
    };
    const b = loanBreakdown(price, loan, balance, purchaseFees(price, quote));
    loanHost.replaceChildren(panel({ title: t('fin.loan.title'), action: t('fin.loan.sub', { rate: fm.num(LOAN_RATE * 100, 1) + ' %' }), class: 'flush' },
      h('div', { class: 'loan-tune' },
        h('div', { class: 'group' }, h('span', null, t('fin.loan.down')), segments(t('fin.loan.down'), downs.map((d) => ({ value: String(d), label: `${d} %` })), String(loan.downPct), (v) => set(Number(v), loan!.months))),
        h('div', { class: 'group' }, h('span', null, t('fin.loan.months')), segments(t('fin.loan.months'), lengths.map((m) => ({ value: String(m), label: String(m) })), String(loan.months), (v) => set(loan!.downPct, Number(v))))),
      h('p', { class: 'dim small fin-in-note' }, t('fin.loan.interest', { amount: fm.money(b.interest) }))));
  };
  const onHub = (icao: string): void => {
    hub = icao;
    void fleetQuote(chosen.icao, hub).catch(() => null).then((q) => { if (q) { quote = q; if (loan) loan = findLoan(q.loans, loan.downPct, loan.months) ?? defaultLoan(q.loans); } drawLoan(); drawSummary(); drawHubNote(); });
    drawHubNote(); drawSummary();
  };
  function drawHubNote(): void {
    const picked = hubs.find((x) => x.icao === hub);
    hubNote.textContent = t('fin.buy.delivery', { city: hubCity(picked?.airport ?? null, hub) });
  }
  drawHubNote(); drawLoan(); drawSummary();

  const view = h('div', { class: 'contract-layout' },
    h('div', { class: 'contract-column' },
      titleBlock(t('buy.status'), chosen.name, titleExtra),
      panel({ title: t('fin.buy.base'), action: parking ? tp('fin.buy.spots', parking.free, { total: parking.total }) : t('buy.hubSub'), id: 'buy-hub', class: 'flush' },
        hubPicker('hub', t('fin.buy.base'), hubs, hub, onHub), hubNote),
      loanHost),
    panel({ title: t('buy.summary'), action: loan ? t('buy.step') : t('fin.buy.cash'), class: 'summary fin-summary', id: 'buy-summary' }, summaryHost));
  enterConfirms(view, confirm);
  return {
    title: chosen.name, scene: 'catalogue', tab: 'fleet', view,
    back: loanPick ? () => { loanPick = null; redraw(); } : back,
    hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: '↑ ↓', label: t('fin.hint.chooseBase') }, { key: t('key.enter'), label: t('fin.hint.confirmBuy') }],
  };
}

type ShortfallIn = {
  ctx: Ctx; chosen: AircraftType; price: number; fees: number; total: number; quote: FleetQuote | null; lease: LeaseOffer | null; back: string; titleExtra: HTMLElement; hints: { key: string; label: string }[];
};
/** "Achat · fonds insuffisants": the ways to pay for it without the cash. */
function shortfall(i: ShortfallIn): Screen {
  const { ctx, chosen, price, fees, total, quote, lease, back, titleExtra, hints } = i;
  const { go } = ctx;
  const fm = fmt();
  const balance = ctx.snap.me.company.balance;
  const missing = total - balance;
  const coverage = Math.min(1, Math.max(0, balance / total));
  const options = fundingOptions(price, quote, balance, lease);
  const head = titleBlock(h('span', { class: 'status-line danger' }, h('span', { class: 'dot off' }), t('fin.buy.short')), chosen.name, titleExtra);
  const summary = (action: Node | null): HTMLElement => panel({ title: t('buy.summary'), action: t('fin.buy.cash'), class: 'summary fin-summary' },
    h('div', { class: 'col', style: 'gap:12px' },
      line(t('buy.price'), fm.money(price)),
      fees > 0 ? line(t('buy.fees'), fm.money(fees)) : null,
      h('hr', { class: 'divider' }),
      line(t('fin.buy.total'), h('span', { class: 'strong' }, fm.money(total)))),
    h('div', { class: 'missing' }, h('span', { class: 'line-label' }, t('buy.broke.missing')), h('span', { class: 'big-money danger' }, fm.money(missing))),
    line(t('fin.buy.avail'), fm.money(balance)),
    h('div', { class: 'coverage', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(coverage * 100), 'aria-label': t('fin.buy.cover', { pct: fm.percent(coverage) }) }, h('span', { style: `width:${Math.round(coverage * 100)}%` })),
    h('p', { class: 'dim small' }, t('fin.buy.cover', { pct: fm.percent(coverage) })),
    action);

  if (options.length === 0) {
    const view = h('div', { class: 'contract-layout' },
      h('div', { class: 'contract-column' }, head,
        panel({ title: t('buy.broke.panel') },
          h('p', { class: 'muted' }, t('fin.buy.noOptions')),
          h('div', { class: 'next-action' }, h('div', { class: 'col tight' }, h('span', { class: 'strong' }, t('buy.broke.fly')), h('span', { class: 'dim small' }, t('buy.broke.flySub', { missing: fm.money(missing) }))),
            button(t('buy.broke.jobs'), { variant: 'secondary', onclick: () => go('#jobs') })),
          h('div', { class: 'next-action' }, h('div', { class: 'col tight' }, h('span', { class: 'strong' }, t('buy.broke.cheaper')), h('span', { class: 'dim small' }, t('buy.broke.cheaperSub'))),
            button(t('buy.broke.catalogue'), { variant: 'secondary', onclick: () => go(back) })))),
      summary(button(t('buy.broke.back'), { variant: 'secondary', onclick: () => go(back) })));
    return { title: chosen.name, scene: 'catalogue', tab: 'fleet', view, back, hints };
  }

  const usable = (o: FundingOption): boolean => (o.kind === 'loan' ? o.loan.affordable : o.balanceAfter >= 0);
  let pick = Math.max(0, options.findIndex(usable));
  const actionHost = h('div', { class: 'fin-actions-row' });
  const drawAction = (): void => {
    const o = options[pick]!;
    const isLoan = o.kind === 'loan';
    actionHost.replaceChildren(
      button(t('buy.broke.back'), { variant: 'secondary', onclick: () => go(back) }),
      button(t(isLoan ? 'fin.buy.takeLoan' : 'fin.buy.seeLease'), { variant: 'primary', key: t('key.enter'), disabled: !usable(o), onclick: proceed }));
  };
  const proceed = (): void => {
    const o = options[pick]!;
    if (!usable(o)) return;
    if (o.kind === 'loan') { loanPick = { icao: chosen.icao, downPct: o.loan.downPct, months: o.loan.months }; redraw(); } else go(hashFor('lease', chosen.icao));
  };
  const items = options.map((o, idx) => {
    const id = `fund-${idx}`;
    const isLoan = o.kind === 'loan';
    const title = t(isLoan ? 'fin.buy.loan' : 'fin.buy.leaseOpt');
    const desc = isLoan
      ? t('fin.buy.loanDesc', { pct: fm.percent(1 - o.loan.downPct / 100), months: o.loan.months, down: fm.money(o.loan.down) })
      : t('fin.buy.leaseDesc', { lessor: lease!.lessor, months: o.kind === 'lease' ? (lease!.durations.find((d) => d.monthlyRent === o.rent)?.months ?? 24) : 24, deposit: fm.money(o.deposit) });
    const money = isLoan ? t('fin.buy.perMonth', { amount: fm.money(o.loan.monthly) }) : t('fin.cat.perMonth', { amount: fm.money(o.rent) });
    const after = isLoan ? o.loan.balanceAfter : o.balanceAfter;
    return h('label', { class: 'fund', for: id },
      h('input', { type: 'radio', name: 'fund', id, value: String(idx), checked: idx === pick, disabled: !usable(o), onchange: () => { pick = idx; drawAction(); } }),
      h('span', { class: 'fund-text' }, h('span', { class: 'fund-title' }, title), h('span', { class: 'fund-desc' }, desc)),
      h('span', { class: 'fund-side' }, h('span', { class: 'fund-money' }, money), h('span', { class: 'fund-after' }, t('fin.buy.balanceAfter', { amount: fm.money(after) }))));
  });
  drawAction();
  const view = h('div', { class: 'contract-layout' },
    h('div', { class: 'contract-column' }, head,
      panel({ title: t('fin.buy.how'), action: tp('fin.buy.solutions', options.length), class: 'flush' }, h('div', { class: 'fund-list', role: 'radiogroup', 'aria-label': t('fin.buy.how') }, items)),
      h('p', { class: 'fin-note' }, t('fin.buy.note', { minM: LOAN_MONTHS.min, maxM: LOAN_MONTHS.max, minP: LOAN_DOWN_PCT.min, maxP: LOAN_DOWN_PCT.max }))),
    summary(actionHost));
  enterConfirms(view, proceed);
  return {
    title: chosen.name, scene: 'catalogue', tab: 'fleet', view, back,
    hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: '↑ ↓', label: t('fin.hint.chooseOption') }, { key: t('key.enter'), label: t('fin.hint.continue') }],
  };
}
