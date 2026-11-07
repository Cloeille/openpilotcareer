// Lot PARTS (v3), server side, part 3: the read models. The wear screen of an aircraft (`GET /me/fleet/:id/wear`) and the warehouse of a hub (`GET /warehouse/:hub`). Reading may write what is
// owed to the clock (orders that arrived go on the shelf; an aircraft's missing component rows are NOT written: `loadComponents` is a pure read), so the warehouse route runs in a transaction.
import {
  DAY_MS, HORIZON_MONTHS, HOURS_PER_MONTH, MONTH_MS, PARTS, PAX_KG, REFERENCE_LOAD, REFERENCE_STAGE_NM, addEffects, bestChoice, blockHours, choiceView, failuresPerYear, fixHours, groundDayValue, groundDaysPerYear,
  isHeavyCheck, jobPayout, kitCapital, kitCovers, kitOf, kpiOf, partById, partClassOf, refurbTotals, settle, wearAfterAction, wearEffects, worksDays,
  type AircraftType, type AogCase, type Choice, type ChoiceView, type ComponentWear, type Economics, type OrderLine, type Selection, type StockLine, type TypePolicy, type WarehouseView, type WearView,
} from '@opc/shared';
import { get, type Db } from './db.ts';
import { assertHub, hangarEffectFor } from './facilities.ts';
import { ferryFee } from './fleet-extras.ts';
import { balanceOf, typeFor, type AircraftRow } from './game.ts';
import { HttpError } from './http.ts';
import { basedAt, breakdownsOf, contractOf, heavyHangarAt, loadComponents, openOrders, ownAircraft, policiesAt, receiveOrders, stockOf, targetsOf, type OrderRow } from './parts.ts';
import { wearEnabled } from './realism.ts';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const CHOICES: readonly Choice[] = ['leave', 'overhaul', 'replace'];

export const orderLine = (o: OrderRow): OrderLine => ({ id: o.id, part: o.part, name: partById(o.part)?.name ?? o.part, qty: o.qty, orderedAt: o.ordered_at, eta: o.eta, cost: o.cost, express: o.express === 1 });

/** What an hour of the type's work earns and what its fuel and maintenance cost, at a reference stage (REFERENCE_STAGE_NM, REFERENCE_LOAD): the figures the wear screen's gains and the ground day are made of. */
export function economicsOf(t: AircraftType): Economics {
  const dist = Math.min(REFERENCE_STAGE_NM, Math.round(t.rangeNm * 0.8)), pax = t.seats > 0, load = pax ? Math.round(t.seats * REFERENCE_LOAD) * PAX_KG : Math.round(t.cargoKg * REFERENCE_LOAD);
  const hours = blockHours(t, dist);
  const s = settle({ payout: jobPayout(pax ? 'pax' : 'cargo', dist, load), distanceNm: dist, aircraft: t, status: 'verified', destSize: 'medium', destIsHub: false });
  return { revenuePerHour: Math.round(s.revenue / hours), costPerHour: Math.round((s.fuelCost + s.maintenance) / hours) };
}

/** The workshop visit as it would be at the aircraft's base now: its days (the longest item halved by a hangar there, B.4), and the ferry of a heavy check when no staffed level-2 hangar stands there. */
export function worksPlan(db: Db, a: AircraftRow, type: AircraftType, itemDays: number, now: number): NonNullable<WearView['works']> {
  const heavyHangar = heavyHangarAt(db, a.company_id, a.base ?? a.location, now, type.category), downtimeFactor = hangarEffectFor(db, a.id, type.category, now)?.downtimeFactor ?? 1;
  const ferry = isHeavyCheck(itemDays) && !heavyHangar;
  return { days: worksDays(itemDays, downtimeFactor, heavyHangar), downtimeFactor, heavyHangar, ferry, ferryCost: ferry ? ferryFee(a.value) : 0 };
}

// ---------------------------------------------------------------- the wear screen

/** `pick`: a selection to preview (the screen's own choices); without it the recommended one. */
export function wearView(db: Db, companyId: number, aircraftId: number, pick: Selection | undefined, now: number): WearView {
  const a = ownAircraft(db, companyId, aircraftId), type = typeFor(db, companyId, a.icao), active = wearEnabled(db, companyId);
  const contract = contractOf(db, a.id), lease = contract?.active && contract.kind === 'lease' ? contract : null;
  const months = lease?.endsAt ? Math.max(0, Math.round((lease.endsAt - now) / MONTH_MS)) : HORIZON_MONTHS;
  const keeps = a.ownership === 'owned' || a.ownership === 'financed', econ = economicsOf(type);
  const rows = loadComponents(db, a.id, type.category);
  const components: ComponentWear[] = rows.map((r) => ({
    component: r.component, wearPct: round1(r.wear_pct), effects: wearEffects(r.component, r.wear_pct), worksUntil: r.refurb_until !== null && r.refurb_until > now ? r.refurb_until : null,
    choices: Object.fromEntries(CHOICES.map((c) => [c, choiceView(c, r.component, r.wear_pct, a.value, econ, months, keeps)])) as Record<Choice, ChoiceView>,
  }));
  const recommended: Selection = components.map((c) => ({ component: c.component, action: bestChoice(c.choices) }));
  const selection = pick ?? recommended;
  for (const s of selection) if (!components.some((c) => c.component === s.component)) throw new HttpError(422, 'no_such_component', `a ${type.name} has no ${s.component}`);
  const afterWear = new Map(rows.map((r) => [r.component, wearAfterAction(selection.find((s) => s.component === r.component)?.action ?? 'leave', r.wear_pct)]));
  const totals = refurbTotals(components, selection, months);
  const works = worksPlan(db, a, type, totals.itemDays, now);
  return {
    aircraft: { id: a.id, registration: a.registration ?? `#${a.id}`, icao: a.icao, typeName: type.name, ownership: a.ownership, value: a.value, wearPct: round1(a.wear_pct) },
    active, refurbishable: active && a.ownership !== 'club' && a.ownership !== 'rented',
    lease: lease && { endsAt: lease.endsAt, monthsLeft: months, purchaseOptionPrice: lease.terms.purchaseOptionPrice ?? 0, maintenanceIncluded: lease.terms.maintenanceIncluded === true, lessor: lease.terms.lessor ?? null },
    months, hoursPerMonth: HOURS_PER_MONTH, components,
    kpi: { now: kpiOf(addEffects(rows.map((r) => wearEffects(r.component, r.wear_pct)))), after: kpiOf(addEffects(rows.map((r) => wearEffects(r.component, afterWear.get(r.component)!)))) },
    recommended, selection, totals, works, balanceAfter: balanceOf(db, companyId) - totals.cost - works.ferryCost,
  };
}

// ---------------------------------------------------------------- the warehouse

/** The warehouse of a hub: what the shelf holds and what it is worth, the policy of each type based there with what each choice would tie up and the ground days it leaves, and the breakdown that has an aircraft grounded now. */
export function warehouseView(db: Db, companyId: number, hub: string, now: number): WarehouseView {
  assertHub(db, companyId, hub);
  receiveOrders(db, companyId, now);
  const fleet = basedAt(db, companyId, hub), stock = stockOf(db, companyId, hub), policies = policiesAt(db, companyId, hub), targets = targetsOf(policies), orders = openOrders(db, companyId, hub);
  const shelf = (id: string): number => stock.get(id) ?? 0;
  const types = [...new Set(fleet.map((a) => a.icao))].map((icao): TypePolicy => {
    const t = typeFor(db, companyId, icao), cls = partClassOf(t.category), own = fleet.filter((a) => a.icao === icao), econ = economicsOf(t);
    const policy = policies.find((p) => p.icao === icao)?.policy ?? 'none';
    const options = (['none', 'critical', 'full'] as const).map((p) => ({ policy: p, capital: kitCapital(cls, p), groundDays: round1(groundDaysPerYear(t.category, kitCovers(cls, p)) * own.length) }));
    const onShelf = (kind: string): boolean => PARTS.some((x) => x.cls === cls && x.kind === kind && shelf(x.id) > 0);
    return {
      icao, name: t.name, cls, aircraft: own.map((a) => ({ id: a.id, registration: a.registration ?? `#${a.id}` })), policy, dayValue: groundDayValue(econ),
      failuresPerYear: Math.round(failuresPerYear(t.category) * 100) / 100, options, expectedGroundDays: round1(groundDaysPerYear(t.category, (k) => onShelf(k)) * own.length),
      covered: kitOf(cls, 'critical').every((l) => shelf(l.part.id) >= l.qty),
    };
  });
  const inventory: StockLine[] = PARTS.flatMap((p): StockLine[] => {
    const inTransit = orders.filter((o) => o.part === p.id).reduce((t, o) => t + o.qty, 0), qty = shelf(p.id), target = targets.get(p.id) ?? 0;
    return qty + inTransit + target === 0 ? [] : [{ part: p.id, name: p.name, cls: p.cls, kind: p.kind, unitPrice: p.price, qty, inTransit, value: qty * p.price, target }];
  });
  const capital = inventory.reduce((t, l) => t + l.value, 0), balance = balanceOf(db, companyId);
  const coveredCount = types.filter((t) => t.covered).reduce((n, t) => n + t.aircraft.length, 0);
  return {
    hub, facility: null, active: wearEnabled(db, companyId), capital, capitalShare: balance > 0 ? Math.round((capital / balance) * 1000) / 1000 : 0, onOrder: orders.reduce((t, o) => t + o.cost, 0), balance,
    expectedGroundDays: round1(types.reduce((t, x) => t + x.expectedGroundDays, 0)), covered: { count: coveredCount, of: fleet.length }, aog: aogCase(db, companyId, hub, now, types), policies: types,
    inventory, orders: orders.map(orderLine),
  };
}

/** The breakdown that has an aircraft of the hub on the ground now (the latest one): the part, when it arrives, what the days cost, and when the part would have had it flying (the six hours of B.6). */
function aogCase(db: Db, companyId: number, hub: string, now: number, types: readonly TypePolicy[]): AogCase | null {
  const b = breakdownsOf(db, companyId, hub).find((x) => x.failed_at <= now && x.ready_at > now);
  if (!b) return null;
  const a = get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ?', b.aircraft_id);
  if (!a) return null;
  const t = typeFor(db, companyId, a.icao), part = partById(b.part)!, tp = types.find((x) => x.icao === a.icao), dayValue = tp?.dayValue ?? groundDayValue(economicsOf(t));
  const withPart = b.failed_at + fixHours(heavyHangarAt(db, companyId, hub, b.failed_at, t.category)) * 3_600_000;
  return {
    aircraftId: a.id, registration: a.registration ?? `#${a.id}`, icao: a.icao, typeName: t.name, component: b.component, part: part.id, partName: part.name, failedAt: b.failed_at, eta: b.eta, readyAt: b.ready_at, fromStock: b.from_stock === 1,
    lost: Math.round(((b.ready_at - b.failed_at) / DAY_MS) * dayValue), dayValue, paid: b.paid, withPartBackAt: b.from_stock === 1 ? b.ready_at : withPart, criticalKit: kitCapital(partClassOf(t.category), 'critical'),
  };
}
