import type { AircraftCategory, Flight } from '@opc/shared';
import { api } from '../api.ts';
import type { FinanceOverview, FleetAircraft, HubSpots } from '@opc/shared';
import { buyoutLease, financeOverview, hubUsage, terminateLease } from '../api-finance.ts';
import { airportInfo } from '../airports.ts';
import { fleetSummary } from '../catalogue.ts';
import { ferryPanel } from '../ferry-ui.ts';
import { badge, button, dataTable, line, panel, unknownValue } from '../components.ts';
import { aircraftName, byRegistration, monthLabel, nextCharges, parkingSummary, statusOf, wearOf, type ActiveFlightInfo } from '../finance-view.ts';
import { locale, perform, tidyCity } from '../finance-ui.ts';
import { fmt } from '../format.ts';
import { codeLabel, t, tp } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';
import { starter } from './starter.ts';

let selected: number | null = null;

export const categoryName = (c: AircraftCategory): string => t(`cat.${c}`);
const companyCode = (c: object): string | null => (c as { code?: string | null }).code || null;

const statusCell = (a: FleetAircraft, flights: Map<number, ActiveFlightInfo>, code: string | null, now: number): HTMLElement => {
  const v = statusOf(a, now, flights.get(a.id) ?? null);
  const dot = v.kind === 'flying' ? 'dot route' : v.kind === 'maintenance' ? 'dot maint' : 'dot';
  const label = v.kind === 'flying' ? t('fleet.inFlight') : v.kind === 'maintenance' ? t('fin.status.maintenance') : t('fleet.available');
  const sub = v.flight ? t('fin.fleet.flight', { flight: `${code ? `${code} ` : ''}${v.flight.flightId}`, dest: v.flight.destination })
    : v.hoursLeft !== null ? t('fin.status.hoursLeft', { n: v.hoursLeft })
      : a.ferryUntil !== null ? t('ferry.until', { time: fmt().zulu(a.ferryUntil) }) : null;
  return h('div', { class: 'status-cell' }, h('span', { class: 'status-line' }, h('span', { class: dot }), label), sub ? h('span', { class: 'status-sub' }, sub) : null);
};

const wearBar = (pct: number): HTMLElement =>
  h('div', { class: `wear-track${pct >= 60 ? ' hot' : ''}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': t('fin.fleet.wear') }, h('span', { style: `width:${pct}%` }));

export async function fleet(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  if (me.fleet.length === 0) return starter(ctx);
  const fm = fmt();
  const now = Date.now();
  const code = companyCode(me.company);
  const [usage, finance, active] = await Promise.all([
    hubUsage().catch((): HubSpots[] | null => null),
    financeOverview().catch((): FinanceOverview | null => null),
    api<Flight[]>('/me/flights?status=active&limit=50').catch((): Flight[] => []),
  ]);
  const flights = new Map<number, ActiveFlightInfo>(active.map((f) => [f.aircraftId, { destination: f.job.destination, flightId: f.id }]));
  const planes = me.fleet;
  const { total, available } = fleetSummary(planes.map((a) => ({ busy: statusOf(a, now).kind !== 'available' })));
  const sorted = byRegistration(planes);
  if (selected === null || !sorted.some((a) => a.id === selected)) selected = sorted[0]?.id ?? null;
  const parking = parkingSummary(usage);

  const detail = h('div', { class: 'detail-host' });
  let confirming: 'terminate' | 'buyout' | null = null;
  let ferrying: number | null = null;

  const canFerry = (a: FleetAircraft): boolean => statusOf(a, now).kind === 'available';
  const openFerry = (a: FleetAircraft): void => {
    ferrying = a.id;
    showDetail(a);
    detail.querySelector<HTMLElement>('.ferry-panel button, .ferry-panel input')?.focus();
  };
  const showDetail = (a: FleetAircraft | undefined): void => {
    if (!a) { detail.replaceChildren(h('p', { class: 'dim' }, t('fleet.pick'))); return; }
    selected = a.id;
    const v = statusOf(a, now, flights.get(a.id) ?? null);
    const wear = wearOf(a);
    const c = a.contract ?? null;
    const own = a.ownership ? t(`fin.own.${a.ownership}`) : null;
    const contractText = c === null ? (a.ownership === 'owned' ? t('fin.fleet.noContract') : null)
      : [c.monthly > 0 ? t('fin.contract.monthly', { amount: fm.money(c.monthly) }) : null, c.hourly ? t('fin.contract.hourly', { amount: fm.money(c.hourly) }) : null,
        c.endsAt ? t('fin.contract.until', { date: monthLabel(locale(), c.endsAt, true) }) : null].filter(Boolean).join(' · ');
    const baseLine = h('span', { class: 'mono' }, a.location);
    void airportInfo(a.location).then((ap) => { if (ap) baseLine.textContent = `${a.location} · ${tidyCity(ap)}`; });
    const actions = h('div', { class: 'fin-actions-row' });
    if (ferrying === a.id) {
      actions.style.flexDirection = 'column';
      actions.replaceChildren(ferryPanel(a, me, ctx.refresh, () => { ferrying = null; showDetail(a); }));
    } else if (c?.kind === 'lease') {
      if (confirming) {
        const isBuy = confirming === 'buyout';
        actions.style.flexDirection = 'column';
        actions.replaceChildren(h('p', { class: 'dim small', role: 'status' }, t(isBuy ? 'fin.lease.buyoutAsk' : 'fin.lease.terminateAsk')),
          h('div', { class: 'row' },
            button(t('fin.cancel'), { variant: 'secondary', onclick: () => { confirming = null; showDetail(a); } }),
            button(t('fin.confirm'), { variant: isBuy ? 'primary' : 'danger', onclick: () => void perform(() => (isBuy ? buyoutLease(c.id) : terminateLease(c.id)), () => t(isBuy ? 'fin.lease.bought' : 'fin.lease.terminated'), ctx.refresh) })));
      } else {
        actions.replaceChildren(
          button(t('pt.r.open'), { variant: 'secondary', icon: 'wrench', onclick: () => go(`#wear/${a.id}`) }),
          button(t('fin.lease.terminate'), { variant: 'secondary', onclick: () => { confirming = 'terminate'; showDetail(a); } }),
          button(t('fin.lease.buyout'), { variant: 'secondary', onclick: () => { confirming = 'buyout'; showDetail(a); } }));
      }
    }
    if (ferrying !== a.id && canFerry(a)) actions.append(button(t('ferry.action'), { variant: 'secondary', icon: 'route', label: t('ferry.pick', { plane: aircraftName(a) }), onclick: () => openFerry(a) }));
    detail.replaceChildren(h('div', { class: 'detail-v2' },
      h('div', { class: 'identity' },
        h('h2', { class: 'reg' }, aircraftName(a)),
        h('span', { class: 'muted' }, `${a.type.name} · ${categoryName(a.type.category)}`),
        h('div', { class: 'row tight' }, statusCell(a, flights, code, now), a.type.derived ? badge('estimated', t('badge.estimated'), null) : null)),
      wear === null ? null : h('div', { class: 'cond' },
        h('div', { class: 'top' }, h('span', { class: 'muted' }, t('fin.fleet.wear')), h('span', { class: 'pct' }, fm.percent(wear / 100))),
        wearBar(wear)),
      h('div', { class: 'col' },
        line(t('fin.fleet.base'), baseLine),
        own ? line(t('fin.fleet.ownership'), own) : null,
        contractText ? line(t('fin.fleet.contract'), contractText) : null,
        line(t('fin.fleet.value'), fm.moneyShort(a.value)),
        line(t('fleet.capacity'), t('fleet.capacityV', { seats: a.type.seats, cargo: fm.kg(a.type.cargoKg) }))),
      actions));
  };
  showDetail(planes.find((a) => a.id === selected));

  const rows = sorted.map((a) => {
    const wear = wearOf(a);
    return {
      label: `${aircraftName(a)} · ${a.type.name}`,
      selected: a.id === selected,
      onFocus: () => { confirming = null; ferrying = null; showDetail(a); },
      onOpen: () => { showDetail(a); },
      cells: [
        h('div', { class: 'col tight' }, h('span', { class: 'reg-sm' }, aircraftName(a)), h('span', { class: 'dim small' }, `${a.type.name} · ${categoryName(a.type.category)}`)),
        h('span', { class: 'mono dim' }, a.location),
        wear === null ? unknownValue() : h('span', { class: 'wear-pct' }, fm.percent(wear / 100)),
        statusCell(a, flights, code, now),
      ],
    };
  });

  const upcoming = nextCharges(finance?.upcoming ?? [], 3);
  const financePanel = finance === null ? null : panel({ title: t('fin.money.title'), action: t('fin.money.sub'), id: 'fin-money' },
    upcoming.length === 0 ? h('p', { class: 'dim small' }, t('fin.money.none'))
      : h('div', { class: 'fin-panel-list' }, upcoming.map((u) => h('div', { class: 'fin-charge' },
        h('span', { class: 'what' }, h('span', null, codeLabel(u.kind, 'fin.kind')), h('span', { class: 'when' }, `${fm.date(u.at)}${u.memo ? ` · ${u.memo}` : ''}`)),
        h('span', { class: 'strong' }, fm.money(-Math.abs(u.amount)))))));

  const parkNote = parking
    ? h('div', { class: 'fleet-note' }, h('span', { class: 'l' }, t('fin.fleet.parking')),
      h('span', { class: 'v' }, [t('fin.fleet.parkingV', { free: parking.free, total: parking.total }), parking.full.length ? t('fin.fleet.parkingFull', { list: parking.full.join(', ') }) : null].filter(Boolean).join(' · ')))
    : h('span', { class: 'dim small' }, t('fleet.hubs', { list: me.hubs.join(', ') }));

  const view = h('div', { class: 'fleet-v2' },
    h('div', { class: 'fleet-left' },
      h('div', { class: 'title-row' },
        h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, code ? t('fin.fleet.status', { company: me.company.name, code }) : t('fleet.status', { company: me.company.name })), h('h1', { class: 'title' }, t('fleet.title'))),
        h('span', { class: 'muted' }, tp('fleet.summary', total, { free: available }))),
      panel({ title: t('fleet.panel'), action: t('fin.fleet.sort'), class: 'grow' },
        dataTable(t('fleet.panel'), [{ label: t('fleet.col.aircraft') }, { label: t('fin.fleet.col.base') }, { label: t('fin.fleet.col.wear') }, { label: t('fleet.col.status') }], rows, h('p', { class: 'dim' }, t('fleet.empty')))),
      h('div', { class: 'row' },
        button(t('fleet.buy'), { variant: 'primary', icon: 'plus', key: 'A', onclick: () => go('#catalogue') }),
        button(t('fin.fleet.buyHub'), { variant: 'secondary', onclick: () => go('#hubs') }),
        button(t('fleet.custom'), { variant: 'ghost', onclick: () => go('#custom') }),
        h('span', { class: 'spacer' }), parkNote)),
    h('div', { class: 'right-col' },
      h('aside', { class: 'panel detail-panel', 'aria-label': t('fleet.detail') },
        h('div', { class: 'panel-head' }, h('h2', null, t('fleet.detail')), h('div', { class: 'panel-action' }, t('fleet.sheet'))), h('div', { class: 'panel-body' }, detail)),
      financePanel));
  return {
    title: t('tab.fleet'), scene: 'fleet', tab: 'fleet', view, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, { key: '↑ ↓', label: t('hint.browse') }, { key: t('key.enter'), label: t('fin.hint.sheet') }, { key: 'A', label: t('fleet.buy') }, { key: 'F', label: t('hint.ferry') }],
    keys: { a: () => go('#catalogue'), f: () => { const a = planes.find((x) => x.id === selected); if (a && canFerry(a)) openFerry(a); } },
  };
}
