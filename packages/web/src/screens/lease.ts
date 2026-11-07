import type { HubSpots, LeaseMonths, LeaseOffer } from '@opc/shared';
import { hubUsage, leaseOffers, signLease } from '../api-finance.ts';
import { airportInfo } from '../airports.ts';
import { button, icon, line, panel, segments } from '../components.ts';
import { defaultDuration, deliveryAt, freeSpots, lastRentMonth, leaseQuote, monthLabel } from '../finance-view.ts';
import { dateLong, enterConfirms, locale, perform } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

const BACK = '#catalogue';

/** "Location · contrat": pick the length, read what the contract provides, see what is paid today, sign. Route `#lease/<ICAO type>`. */
export async function lease(ctx: Ctx): Promise<Screen> {
  const { snap, go, arg } = ctx;
  const { me } = snap;
  const fm = fmt();
  const hints = [{ key: t('key.esc'), label: t('hint.catalogue') }];
  const none = (message: string): Screen => ({ title: t('fin.lease.status'), scene: 'catalogue', tab: 'fleet', back: BACK, hints, view: h('div', { class: 'col' }, h('p', { class: 'muted' }, message), button(t('buy.broke.catalogue'), { variant: 'secondary', onclick: () => go(BACK) })) });
  if (!arg) return none(t('buy.unknown'));

  const [offers, usage] = await Promise.all([leaseOffers({ icao: arg }).catch((): LeaseOffer[] | null => null), hubUsage().catch((): HubSpots[] | null => null)]);
  if (offers === null) return none(t('fin.lease.unavailable'));
  if (offers.length === 0) return none(t('fin.lease.noOffer'));

  const hubs = await Promise.all(me.hubs.map(async (icao) => ({ icao, airport: await airportInfo(icao) })));
  const now = Date.now();
  let offer = offers[0]!;
  let months: number = defaultDuration(offer)?.months ?? 24;
  const open = me.hubs.filter((icao) => freeSpots(usage, icao) !== 0);
  let hub = open[0] ?? me.hubs[0]!;

  const durationHost = h('div');
  const termsHost = h('div');
  const summaryHost = h('div', { class: 'sum-host' });
  const titleHost = h('div', { class: 'title-block' });
  const lessorHost = h('div', { class: 'lessor-host' });

  const money = fm.money;
  const drawTitle = (): void => titleHost.replaceChildren(
    h('div', { class: 'status-line' }, t('fin.lease.status')),
    h('h1', { class: 'title' }, offer.typeName),
    h('p', { class: 'muted' }, t('fin.lease.sub', { lessor: offer.lessor, year: offer.year, hours: fm.num(offer.airframeHours) })));

  const drawDurations = (): void => durationHost.replaceChildren(h('div', { class: 'duration-row', role: 'radiogroup', 'aria-label': t('fin.lease.duration') }, offer.durations.map((d) => {
    const id = `lease-m${d.months}`;
    return h('label', { class: 'duration', for: id },
      h('span', { class: 'duration-head' },
        h('input', { type: 'radio', name: 'lease-months', id, value: d.months, checked: d.months === months, onchange: () => { months = d.months; drawAll(); document.getElementById(id)?.focus(); } }),
        t('fin.lease.months', { n: d.months })),
      h('span', { class: 'col', style: 'gap:3px' },
        h('span', { class: 'duration-rent' }, t('fin.cat.perMonth', { amount: money(d.monthlyRent) })),
        h('span', { class: 'duration-total' }, t('fin.lease.total', { amount: money(d.monthlyRent * d.months) }))));
  })));

  const cycleBase = (): void => {
    const list = open.length > 0 ? open : me.hubs;
    if (list.length < 2) return;
    hub = list[(list.indexOf(hub) + 1) % list.length]!;
    drawAll();
    document.getElementById('lease-base')?.focus();
  };
  const term = (label: string, note: string, value: Node | string, cls = ''): HTMLElement =>
    h('div', { class: 'term' }, h('div', { class: 'term-stack' }, h('span', { class: 'term-label' }, label), h('span', { class: 'term-note' }, note)), h('div', { class: `term-value ${cls}`.trim() }, value));

  const drawTerms = (): void => {
    const q = leaseQuote(offer, months, me.company.balance);
    const airport = hubs.find((x) => x.icao === hub)?.airport ?? null;
    const arrives = dateLong(deliveryAt(now, offer));
    const insured = offer.insuranceMonthly === null;
    const baseNote = t('fin.term.baseNote', { name: airport ? airport.name : hub, date: arrives });
    const baseValue = h('button', { type: 'button', class: 'term-base', id: 'lease-base', 'aria-label': `${t('fin.term.base')}: ${hub}. ${t('fin.hint.base')}`, disabled: me.hubs.length < 2, onclick: cycleBase },
      h('span', { class: 'mono', style: 'font-size:14px' }, hub), me.hubs.length > 1 ? icon('chevron-right') : null);
    termsHost.replaceChildren(h('div', { class: 'terms' },
      term(t('fin.term.maint'), t(offer.maintenanceIncluded ? 'fin.term.maintNote' : 'fin.term.maintNoteNo'), t(offer.maintenanceIncluded ? 'fin.term.included' : 'fin.term.notIncluded')),
      term(t('fin.term.insurance'), insured ? t('fin.term.insuranceIncl') : t('fin.term.insuranceNote', { amount: money(offer.insuranceMonthly!) }), t(insured ? 'fin.term.included' : 'fin.term.notIncluded')),
      term(t('fin.term.exit'), t('fin.term.exitNote', { n: offer.earlyExit.penaltyRents, amount: money(q?.penalty ?? 0) }), t('fin.term.exitFrom', { n: offer.earlyExit.afterMonths })),
      term(t('fin.term.option'), t('fin.term.optionNote', { n: months }), money(offer.purchaseOptionPrice)),
      term(t('fin.term.base'), baseNote, baseValue)));
  };

  const confirm = (): void => {
    const q = leaseQuote(offer, months, me.company.balance);
    if (!q || !q.affordable) return;
    void perform(() => signLease(offer.id, months as LeaseMonths, hub), (r) => t('fin.lease.signed', { reg: r.aircraft.registration }), ctx.refresh).then((ok) => { if (ok) go('#fleet'); });
  };
  const drawSummary = (): void => {
    const q = leaseQuote(offer, months, me.company.balance);
    if (!q) { summaryHost.replaceChildren(); return; }
    const lastRent = monthLabel(locale(), lastRentMonth(now, months).getTime(), true);
    summaryHost.replaceChildren(
      h('div', { class: 'col', style: 'gap:12px' },
        line(t('fin.sum.firstRent', { month: monthLabel(locale(), now, false) }), money(q.rent)),
        line(t('fin.sum.deposit'), money(q.deposit)),
        line(t('fin.sum.ferry'), money(q.ferry))),
      h('hr', { class: 'divider' }),
      h('div', { class: 'pay-today' }, h('span', { class: 'label' }, t('fin.sum.today')), h('span', { class: 'pay-big' }, money(q.firstPayment))),
      h('div', { class: 'balance-block' },
        line(t('fin.sum.after'), money(q.balanceAfter), q.affordable ? '' : 'short'),
        q.affordable ? h('p', { class: 'pay-note' }, t('fin.sum.then', { amount: money(q.rent), date: lastRent }))
          : h('p', { class: 'pay-note', role: 'alert', style: 'color:var(--danger)' }, `${t('fin.sum.short')}: ${money(q.shortfall)}`)),
      h('div', { class: 'fin-actions-row' },
        button(t('buy.cancel'), { variant: 'secondary', onclick: () => go(BACK) }),
        button(t('fin.lease.confirm'), { variant: 'primary', key: t('key.enter'), disabled: !q.affordable, onclick: confirm })));
  };

  const drawLessors = (): void => {
    if (offers.length < 2) { lessorHost.replaceChildren(); return; }
    lessorHost.replaceChildren(segments(t('fin.lease.lessors'), offers.map((o) => ({ value: String(o.id), label: o.lessor })), String(offer.id), (v) => {
      offer = offers.find((o) => String(o.id) === v) ?? offer;
      months = defaultDuration(offer)?.months ?? months;
      drawAll();
    }));
  };
  function drawAll(): void { drawTitle(); drawLessors(); drawDurations(); drawTerms(); drawSummary(); }
  drawAll();

  const view = h('div', { class: 'contract-layout' },
    h('div', { class: 'contract-column' }, titleHost,
      panel({ title: t('fin.lease.duration'), action: t('fin.lease.durationHint'), id: 'lease-duration', class: 'flush' }, durationHost),
      panel({ title: t('fin.lease.terms'), action: offer.lessor, id: 'lease-terms', class: 'flush' }, lessorHost, termsHost)),
    panel({ title: t('buy.summary'), action: t('buy.step'), class: 'summary fin-summary', id: 'lease-summary' }, summaryHost));
  enterConfirms(view, confirm);
  return {
    title: offer.typeName, scene: 'catalogue', tab: 'fleet', view, back: BACK,
    hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: '← →', label: t('fin.hint.duration') }, { key: 'B', label: t('fin.hint.base') }, { key: t('key.enter'), label: t('fin.hint.confirmLease') }],
    keys: { b: cycleBase },
  };
}
