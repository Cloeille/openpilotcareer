import type { AircraftType } from '@opc/shared';
import { button, icon, panel } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import {
  CLUB, CREDIT_ICAO, LADDER, LOAN_RATE, MONTHLY_RENTAL, cheapestBelow, runningCostPerHour, hardcoreOptions, ladderRank, leaseRecap, listedTerm, monthlyCost, typicalGain,
  type HardcoreId, type HardcoreOption,
} from '../onboarding-model.ts';
import { aircraftType, buyFinanced, clubRental, fleetQuote, leaseAircraft, leaseOffers, monthlyRental } from '../api-onboarding.ts';
import type { FleetQuote, LeaseOffer, LoanQuote } from '../onboarding-types.ts';
import { arrows, guarded, hintsOf, titleArea, type StepResult, type Wizard } from '../onboarding-shell.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { h } from '../ui.ts';
import type { Key } from '../messages.ts';

const shortName = (n: string): string => n.replace(/^Airbus |^Boeing |^Embraer |^Cessna /, '');

/** An aircraft the company already has: going back to this step after leasing or renting must not offer a second one. */
async function alreadyHas(w: Wizard): Promise<{ icao: string; reg: string; hub: string } | null> {
  if (w.ob.companyId === null) return null;
  const me = await w.loadMe(true);
  const a = me.fleet[0];
  return a ? { icao: a.icao, reg: a.registration ?? '', hub: a.location } : null;
}

function haveView(w: Wizard, own: { icao: string; reg: string; hub: string }, over: string, title: string, sub: string): StepResult {
  const error = h('p', { class: 'ob-error', role: 'alert' });
  const cont = button(t('ob.hint.continue'), { variant: 'primary', key: t('key.enter'), onclick: () => w.go(4) });
  const view = h('div', { class: 'ob-page' }, titleArea(over, title, sub),
    h('div', { class: 'ob-main' }, panel({ title: t('ob.s3a.have'), class: 'ob-recap' },
      h('p', null, t('ob.s3a.haveSub', { type: own.icao, reg: own.reg, hub: own.hub })), h('p', { class: 'dim' }, t('ob.s3a.haveNote')))),
    h('div', { class: 'ob-foot' }, h('div', { class: 'ob-foot-left' }, error), cont));
  return { scene: 'fleet', view, back: () => w.prev(), hints: hintsOf([t('key.esc'), t('ob.hint.prevStep')], [t('key.enter'), t('ob.hint.continue')]) };
}

// ------------------------------------------------------------------ 3a: airliner lease

type OfferRow = { offer: LeaseOffer; type: AircraftType | null; rent: number; months: number };

export async function step3a(w: Wizard): Promise<StepResult> {
  const own = await alreadyHas(w);
  const overText = t('ob.s3a.over');
  if (own) return haveView(w, own, overText, t('ob.s3a.title'), '');
  const me = await w.loadMe(true);
  const hub = me.hubs[0] ?? w.form.hub ?? '';
  const capital = me.company.balance;
  const fm = fmt();
  let offers: LeaseOffer[] = [];
  let loadError: string | null = null;
  try { offers = await leaseOffers(hub); } catch (e) { loadError = e instanceof Error ? e.message : String(e); }
  const rows: OfferRow[] = await Promise.all(offers.map(async (offer) => {
    const term = listedTerm(offer);
    return { offer, type: await aircraftType(offer.icao), rent: term.monthlyRent, months: term.months };
  }));
  let sel = 0;
  const error = h('p', { class: 'ob-error', role: 'alert' });
  const recapHost = h('div', { style: 'display:contents' });
  const leaseBtnHost = h('div');
  const year = new Date().getUTCFullYear();

  const paintRecap = (): void => {
    const r = rows[sel];
    if (!r) return;
    const gain = r.type ? typicalGain(r.type) : null;
    const rc = leaseRecap(capital, r.offer, r.rent, gain);
    const legend = (cls: string, label: string, sub: string, value: number, short = false): HTMLElement =>
      h('div', { class: `ob-legend-row${short ? ' short' : ''}` }, h('i', { class: `sw-${cls}` }),
        h('span', { class: 't' }, label, h('small', null, sub)), h('b', null, fm.money(value)));
    const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;
    recapHost.replaceChildren(panel({ title: `${r.offer.typeName} · ${r.offer.lessor}`, headless: true, class: 'ob-recap' },
      h('div', null,
        h('div', { class: 'ob-rent-name' }, `${r.offer.typeName} · ${r.offer.lessor}`),
        h('div', { class: 'ob-rent' }, h('b', null, fm.money(r.rent)), h('span', null, t('ob.s3a.perMonth'))),
        h('div', { class: 'ob-rent-terms' }, t(r.offer.maintenanceIncluded ? 'ob.s3a.minMaint' : 'ob.s3a.minNoMaint', { n: r.months }))),
      h('div', { class: 'ob-capital' },
        h('div', { class: 'ob-capital-head' }, h('span', null, t('ob.s3a.capital')), h('b', null, fm.money(capital))),
        h('div', { class: 'ob-bar', role: 'img', 'aria-label': `${t('ob.s3a.deposit')} ${fm.money(rc.deposit)}, ${t('ob.s3a.first')} ${fm.money(rc.firstRent + rc.ferryFee)}, ${t('ob.s3a.rest')} ${fm.money(Math.max(0, rc.remaining))}` },
          h('i', { class: 'dep', style: `width:${pct(rc.shares.deposit)}` }), h('i', { class: 'first', style: `width:${pct(rc.shares.first)}` }), h('i', { class: 'rest', style: 'flex:1' })),
        h('div', { class: 'ob-legend' },
          legend('dep', t('ob.s3a.deposit'), t('ob.s3a.depositSub'), rc.deposit),
          legend('first', t('ob.s3a.first'), t('ob.s3a.firstSub'), rc.firstRent),
          rc.ferryFee > 0 ? legend('first', t('ob.s3a.ferry'), t('ob.s3a.ferrySub'), rc.ferryFee) : null,
          legend('rest', t('ob.s3a.rest'), t('ob.s3a.restSub'), rc.remaining, !rc.affordable))),
      h('hr', { class: 'divider' }),
      h('div', { class: 'ob-meaning' },
        h('div', null, h('span', { class: 'l' }, t('ob.s3a.autonomy')), h('span', { class: 'v' }, rc.autonomyMonths === null ? '–' : t('ob.s3a.autonomyV', { n: fm.num(Math.max(0, rc.autonomyMonths), 1) }))),
        h('div', null, h('span', { class: 'l' }, t('ob.s3a.cover')), h('span', { class: 'v' }, rc.flightsPerMonth === null ? '–' : t('ob.s3a.coverV', { n: rc.flightsPerMonth })))),
      rc.affordable
        ? (gain !== null ? h('p', { class: 'ob-meaning-note' }, t('ob.s3a.estimate', { gain: fm.money(gain), type: r.type ? shortName(r.type.name) : r.offer.icao })) : null)
        : h('p', { class: 'ob-error', role: 'alert' }, t('ob.s3a.short', { missing: fm.money(-rc.remaining) }))));
    const leaseBtn = button(t('ob.s3a.lease', { name: shortName(r.offer.typeName) }), { variant: 'primary', key: t('key.enter'), disabled: !rc.affordable, onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, async () => {
      await leaseAircraft(r.offer.id, r.months, hub);
      await w.loadMe(true);
      w.go(4);
    }) });
    leaseBtnHost.replaceChildren(leaseBtn);
  };

  const radios = rows.map((r, i) => {
    const input = h('input', { type: 'radio', name: 'offer', value: String(i), checked: i === sel, 'aria-label': `${r.offer.typeName}, ${r.offer.lessor}, ${fm.money(r.rent)} ${t('ob.s3a.perMonth')}` });
    input.addEventListener('change', () => { sel = i; paintRecap(); });
    return input;
  });
  const lessorLine = (o: LeaseOffer): string => (o.airframeHours === 0 ? t('ob.s3a.lessorNew', { lessor: o.lessor, year: o.year }) : t('ob.s3a.lessorUsed', { lessor: o.lessor, year: o.year, hours: fm.num(o.airframeHours) }));
  const offerRow = (r: OfferRow, i: number): HTMLElement =>
    h('label', { class: 'ob-offer' }, radios[i]!, h('div', { class: 'ob-offer-row' },
      h('span', { class: 'ob-radio-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'c-name' }, h('span', { class: 'n' }, h('b', null, r.offer.typeName), h('span', { class: 'mono' }, r.offer.icao)), h('small', null, lessorLine(r.offer))),
      h('span', { class: 'c-rent' }, fm.money(r.rent)),
      h('span', { class: 'c-dep' }, fm.money(r.offer.deposit)),
      h('span', { class: 'c-min' }, t('ob.s3a.months', { n: r.offer.minMonths })),
      h('span', { class: 'c-seats' }, r.type ? String(r.type.seats) : '–'),
      h('span', { class: 'c-range' }, r.type ? fm.nm(r.type.rangeNm) : '–'),
      h('span', { class: `c-maint${r.offer.maintenanceIncluded ? ' inc' : ''}` }, r.offer.maintenanceIncluded ? t('ob.s3a.included') : t('ob.s3a.yours'))));

  const table = rows.length === 0
    ? h('div', { class: 'ob-empty' }, h('p', null, loadError ? loadError : t('ob.s3a.none')), button(t('ob.retry'), { variant: 'secondary', onclick: () => w.go(3) }))
    : h('div', { class: 'col', style: 'gap:0;flex:1;min-height:0' },
      h('div', { class: 'ob-thead', 'aria-hidden': 'true' }, h('span', { class: 'dotspace' }), h('span', { class: 'c-name' }, t('ob.s3a.cAircraft')), h('span', { class: 'c-rent hd' }, t('ob.s3a.cRent')),
        h('span', { class: 'c-dep' }, t('ob.s3a.cDeposit')), h('span', { class: 'c-min' }, t('ob.s3a.cMin')), h('span', { class: 'c-seats' }, t('ob.s3a.cSeats')), h('span', { class: 'c-range' }, t('ob.s3a.cRange')), h('span', { class: 'c-maint' }, t('ob.s3a.cMaint'))),
      h('div', { class: 'ob-offer-list', role: 'radiogroup', 'aria-label': t('ob.s3a.panel') }, rows.map(offerRow)),
      h('p', { class: 'ob-terms' }, t('ob.s3a.terms')));
  const delivery = rows[0]?.offer.deliveryHours ?? 0;
  const view = h('div', { class: 'ob-page' },
    titleArea(overText, t('ob.s3a.title'), delivery > 0 ? t('ob.s3a.sub', { n: rows.length || 3, h: delivery }) : t('ob.s3a.subNoDelay', { n: rows.length || 3 })),
    h('div', { class: 'ob-main' },
      panel({ title: t('ob.s3a.panel'), action: tp('ob.s3a.panelSub', rows.length, { year }), id: 'ob-offers', class: 'ob-offers' }, table),
      recapHost),
    h('div', { class: 'ob-foot' },
      h('div', { class: 'ob-foot-left' },
        button(t('ob.s3a.credit'), { variant: 'ghost', onclick: () => void showCredit() }), h('span', { class: 'ob-note' }, t('ob.s3a.foot')), error),
      leaseBtnHost));
  paintRecap();

  // ---- "Acheter à crédit plutôt": the loan quote of the selected type
  const showCredit = async (): Promise<void> => {
    const r = rows[sel];
    if (!r) return;
    error.textContent = '';
    let quote: FleetQuote;
    try { quote = await fleetQuote(r.offer.icao, hub); } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); return; }
    const creditView = creditPanel(w, r, quote, capital, hub, () => w.go(3));
    root.replaceChildren(...creditView.view.childNodes);
  };
  const root = view;
  return {
    scene: 'fleet', view, back: () => w.prev(), keys: { c: () => void showCredit() },
    hints: hintsOf([t('key.esc'), t('ob.hint.prevStep')], [arrows('ud'), t('ob.hint.changeOffer')], [t('key.enter'), t('ob.hint.leaseThis')]),
  };
}

function creditPanel(w: Wizard, r: OfferRow, quote: FleetQuote, capital: number, hub: string, back: () => void): { view: HTMLElement; hints: StepResult['hints'] } {
  const fm = fmt();
  const error = h('p', { class: 'ob-error', role: 'alert' });
  let sel = Math.max(0, quote.loans.findIndex((l) => l.months === 60));
  const loans: LoanQuote[] = quote.loans;
  const list = h('div', { class: 'ob-credit-list', role: 'radiogroup', 'aria-label': t('ob.s3a.creditPanel', { name: shortName(r.offer.typeName) }) },
    loans.map((l, i) => {
      const input = h('input', { type: 'radio', name: 'loan', value: String(i), checked: i === sel });
      input.addEventListener('change', () => { sel = i; paintBtn(); });
      return h('label', { class: 'ob-credit' }, input, h('span', { class: 'ob-radio-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'grow' }, h('b', null, t('ob.s3a.creditOpt', { down: l.downPct, years: fm.num(l.months / 12, l.months % 12 ? 1 : 0) })), h('small', null, t('ob.s3a.creditOptSub', { months: l.months, total: fm.money(l.total) }))),
        h('b', null, t('ob.s3a.creditMonthly', { price: fm.money(l.monthly) })));
    }));
  const btnHost = h('div');
  const paintBtn = (): void => {
    const l = loans[sel];
    const down = l ? Math.round((quote.cash * l.downPct) / 100) : 0;
    btnHost.replaceChildren(button(t('ob.s3a.creditBuy'), { variant: 'primary', key: t('key.enter'), disabled: !l || down > capital, onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, async () => {
      await buyFinanced(r.offer.icao, hub, { downPct: l!.downPct, months: l!.months });
      await w.loadMe(true);
      w.go(4);
    }) }));
  };
  paintBtn();
  const view = h('div', { class: 'ob-page' },
    titleArea(t('ob.s3a.over'), t('ob.s3a.creditPanel', { name: shortName(r.offer.typeName) }), `${t('ob.s3a.creditSub', { price: fm.money(quote.cash) })} · ${t('ob.s3a.rate', { rate: fm.percent(LOAN_RATE).replace(/\s?%/, '') + '\u00a0%' })}`),
    h('div', { class: 'ob-main' }, panel({ title: t('ob.s3a.credit'), class: 'ob-offers' }, loans.length ? list : h('p', { class: 'dim' }, t('ob.s3a.creditNone')))),
    h('div', { class: 'ob-foot' }, h('div', { class: 'ob-foot-left' }, button(t('ob.s3a.creditBack'), { variant: 'ghost', onclick: back }), error), btnHost));
  return { view, hints: hintsOf([t('key.esc'), t('ob.hint.prevStep')], [t('key.enter'), t('ob.s3a.creditBuy')]) };
}

// ------------------------------------------------------------------ 3b: hardcore comparison

const PROS: Record<HardcoreId, [Key, Key, Key]> = {
  club: ['ob.s3b.clubPro1', 'ob.s3b.clubPro2', 'ob.s3b.clubPro3'],
  monthly: ['ob.s3b.monthlyPro1', 'ob.s3b.monthlyPro2', 'ob.s3b.monthlyPro3'],
  credit: ['ob.s3b.creditPro1', 'ob.s3b.creditPro2', 'ob.s3b.creditPro3'],
};
const CONS: Record<HardcoreId, [Key, Key, Key]> = {
  club: ['ob.s3b.clubCon1', 'ob.s3b.clubCon2', 'ob.s3b.clubCon3'],
  monthly: ['ob.s3b.monthlyCon1', 'ob.s3b.monthlyCon2', 'ob.s3b.monthlyCon3'],
  credit: ['ob.s3b.creditCon1', 'ob.s3b.creditCon2', 'ob.s3b.creditCon3'],
};

export async function step3b(w: Wizard): Promise<StepResult> {
  const own = await alreadyHas(w);
  const me = await w.loadMe(true);
  const hub = me.hubs[0] ?? w.form.hub ?? '';
  const info = await airportInfo(hub);
  const over = t('ob.s3b.over', { city: info ? cityOf(info) : hub });
  const fm = fmt();
  if (own) return haveView(w, own, over, t('ob.s3b.title'), '');
  const capital = me.company.balance;

  let quote: FleetQuote | null = null;
  try { quote = await fleetQuote(CREDIT_ICAO, hub); } catch { quote = null; }
  const c152 = await aircraftType(CREDIT_ICAO);
  const creditHourly = c152 ? runningCostPerHour(c152) : null;
  const options = hardcoreOptions(quote, creditHourly);
  let sel = 0;
  const error = h('p', { class: 'ob-error', role: 'alert' });
  const capitalHost = h('div');
  const noteHost = h('span', { class: 'ob-note' });
  const btnHost = h('div');
  const cardsHost = h('div', { class: 'ob-left' });

  const title = (o: HardcoreOption): Key => (o.id === 'club' ? 'ob.s3b.club' : o.id === 'monthly' ? 'ob.s3b.monthly' : 'ob.s3b.credit');
  const years = (o: HardcoreOption): number => (o.loan ? o.loan.months / 12 : 5);
  const desc = (o: HardcoreOption): string => (o.id === 'club' ? t('ob.s3b.clubDesc') : o.id === 'monthly' ? t('ob.s3b.monthlyDesc', { n: MONTHLY_RENTAL.minMonths })
    : t('ob.s3b.creditDesc', { price: fm.money(o.price ?? 0), years: fm.num(years(o), 0), rate: fm.percent(LOAN_RATE).replace(/\s?%/, '') + '\u00a0%' }));
  const fig = (value: string, caption?: string): HTMLElement => h('div', { class: 'ob-fig' }, h('b', null, value), caption ? h('small', null, caption) : null);
  const captions = (o: HardcoreOption): [string | undefined, string | undefined, string | undefined, string | undefined] =>
    o.id === 'club' ? [undefined, undefined, t('ob.s3b.capFuelIncl'), undefined]
      : o.id === 'monthly' ? [t('ob.s3b.capDeposit'), undefined, t('ob.s3b.capFuelReal'), undefined]
        : [t('ob.s3b.capDown'), t('ob.s3b.capLoan'), t('ob.s3b.capUpkeep'), t('ob.s3b.capNoBreak')];

  const paint = (): void => {
    const o = options[sel]!;
    const after = capital - o.upfront;
    capitalHost.replaceChildren(h('div', { class: 'stat' },
      h('span', { class: 'stat-label' }, t('ob.s3b.after')), h('span', { class: 'stat-value' }, fm.money(after)),
      h('span', { class: 'stat-delta', style: 'color:var(--text-tertiary);font-size:13px' }, o.upfront === 0 ? t('ob.s3b.intact') : t('ob.s3b.afterUp'))));
    const limit = cheapestBelow(o, options.filter((x) => x !== o));
    noteHost.replaceChildren(...(limit !== null ? [icon('scale', 16), t('ob.s3b.rule', { n: limit })] : []));
    noteHost.className = 'ob-note with-icon';
    btnHost.replaceChildren(button(t(o.id === 'club' ? 'ob.s3b.continueClub' : o.id === 'monthly' ? 'ob.s3b.continueMonthly' : 'ob.s3b.continueCredit'), {
      variant: 'primary', key: t('key.enter'), disabled: o.upfront > capital,
      onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, async () => {
        if (o.id === 'club') await clubRental(hub, o.icao);
        else if (o.id === 'monthly') await monthlyRental(hub, o.icao);
        else await buyFinanced(o.icao, hub, { downPct: o.loan!.downPct, months: o.loan!.months });
        await w.loadMe(true);
        w.go(4);
      }),
    }));
  };

  const optionCard = (o: HardcoreOption, i: number): HTMLElement => {
    const input = h('input', { type: 'radio', name: 'plan', class: 'ob-radio', value: o.id, checked: i === sel, 'aria-label': t(title(o)) });
    input.addEventListener('change', () => { sel = i; paint(); });
    const [c1, c2, c3, c4] = captions(o);
    return h('label', { class: 'ob-card ob-opt' }, input,
      h('div', { class: 'ob-opt-head' },
        h('div', { class: 'ob-opt-info' }, h('div', { class: 'ob-opt-title' }, h('b', null, t(title(o))), h('span', { class: 'ob-sel' }, icon('check', 13), t('ob.selected'))), h('p', { class: 'ob-opt-desc' }, desc(o))),
        h('div', { class: 'ob-figs' }, fig(fm.money(o.upfront), c1), fig(fm.money(o.monthly), c2), fig(fm.money(o.hourly), c3), fig(fm.money(monthlyCost(o)), c4))),
      h('div', { class: 'ob-tradeoffs' },
        h('div', null, h('h3', null, t('ob.s3b.pros')), h('ul', null, PROS[o.id].map((k) => h('li', null, icon('plus', 14), t(k))))),
        h('div', null, h('h3', null, t('ob.s3b.cons')), h('ul', null, CONS[o.id].map((k) => h('li', null, icon('minus', 14), k === 'ob.s3b.monthlyCon2' ? t(k, { n: MONTHLY_RENTAL.minMonths }) : t(k)))))));
  };
  cardsHost.append(
    h('div', { class: 'ob-cols', 'aria-hidden': 'true' }, h('span', { class: 'grow' }, t('ob.s3b.cPlan')),
      h('div', { class: 'ob-figs' }, h('span', null, t('ob.s3b.cUpfront')), h('span', null, t('ob.s3b.cFixed')), h('span', null, t('ob.s3b.cHour')), h('span', null, t('ob.s3b.cFor', { h: 20 })))),
    h('div', { class: 'ob-left', style: 'padding:0;margin:0;overflow:visible', role: 'radiogroup', 'aria-label': t('ob.s3b.group') }, options.map(optionCard)),
    ...(quote && creditHourly !== null ? [] : [h('p', { class: 'dim small' }, t('ob.s3b.noCredit'))]));

  const ladder = panel({ title: t('ob.s3b.ladder'), action: t('ob.s3b.preview'), class: 'ob-ladder' },
    h('p', { class: 'ob-ladder-intro' }, t('ob.s3b.ladderIntro')),
    LADDER.map((rung, i) => {
      const r = ladderRank(rung.rank);
      return h('div', { class: `ob-rung${i === 0 ? ' now' : ''}` },
        h('div', { class: 'ob-rail', 'aria-hidden': 'true' }, h('i'), i < LADDER.length - 1 ? h('u') : null),
        h('div', { class: 'ob-rung-text' }, h('b', null, t(`ob.s3b.rung.${rung.id}` as Key)),
          h('small', null, i === 0 ? t('ob.s3b.rungSingle') : rung.models),
          h('em', null, i === 0 ? t('ob.s3b.start') : t('ob.s3b.unlock', { n: rung.rank + 1, hours: fm.num(r.hours), flights: fm.num(r.flights) }))));
    }));
  const view = h('div', { class: 'ob-page' },
    h('div', { class: 'ob-top-row' }, titleArea(h('span', { class: 'sign location' }, hub, ' '), t('ob.s3b.title'), t('ob.s3b.sub', { capital: fm.money(capital) })), capitalHost),
    h('div', { class: 'ob-main' }, cardsHost, h('div', { class: 'ob-side' }, ladder)),
    h('div', { class: 'ob-foot' }, h('div', { class: 'ob-foot-left' }, noteHost, error), btnHost));
  // the sign + overline text share one line
  view.querySelector('.ob-over')!.append(over);
  paint();
  return {
    scene: 'fleet', view, back: () => w.prev(),
    hints: hintsOf([t('key.esc'), t('ob.hint.prevStep')], [arrows('ud'), t('ob.hint.prevOption')], [t('key.enter'), t('ob.hint.continue')]),
  };
}
