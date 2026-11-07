// Aircraft-level finance rules that game.ts (fleet view, flight settlement, purchases) needs. A leaf module: it never imports
// game.ts values, so game.ts can depend on it without a cycle. The contract/lease/loan/billing logic lives in finance.ts.
import {
  MAINTENANCE_HOURS, WEAR_AFTER_MAINTENANCE_PCT, WEAR_THRESHOLD_PCT, wearAfter,
  type AircraftCategory, type AircraftContract, type ContractKind, type FleetAircraftFinance, type Ownership, type Settlement,
} from '@opc/shared';
import { all, get, run, type Db } from './db.ts';
import { hangarEffectFor, hubCapacity } from './facilities.ts';
import { wearComponents, wornSettlement } from './parts.ts';
import { wearEnabled } from './realism.ts';
import { HttpError } from './http.ts';
import { nextRegistration } from './registrations.ts';

const HOUR = 3_600_000;

/** Convoy + registration fee on every purchase or lease: 0.3 % of the price, between 250 and 12 500 euros. */
export const ferryFee = (price: number): number => Math.min(12_500, Math.max(250, Math.round((price * 0.003) / 50) * 50));

/** Monthly hull insurance of an aircraft that is owned or financed (and of a lease that does not include it). */
export function insuranceMonthly(value: number, category: AircraftCategory): number {
  const rate = category.startsWith('jet') ? 0.0008 : category.startsWith('turboprop') ? 0.0012 : 0.0021;
  return Math.round(value * rate);
}

export type ContractRow = {
  id: number; company_id: number; aircraft_id: number; kind: ContractKind; status: 'active' | 'ended'; started_at: number; ends_at: number | null;
  months: number | null; months_paid: number; monthly: number; hourly: number | null; deposit: number; insurance: number; principal: number;
  terms: string | null; ended_at: number | null;
};
export type LeaseTerms = { maintenanceIncluded: boolean; purchaseOptionPrice: number; value: number; earlyExit: { afterMonths: number; penaltyRents: number }; minMonths: number };

export const isHuman = (db: Db, companyId: number): boolean => !!get(db, 'SELECT 1 AS x FROM companies WHERE id = ? AND user_id IS NOT NULL', companyId);

/** Parking spots of `hub` taken by aircraft based there. Club and monthly-rental aircraft are parked by their lessor and take none. */
export const hubUsed = (db: Db, companyId: number, hub: string): number =>
  get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM aircraft WHERE company_id = ? AND base = ? AND returned_at IS NULL AND ownership IN ('owned','leased','financed')", companyId, hub)!.n;

/** A hub has the airport's PARKING_SPOTS_PER_HUB spots, plus the aircraft each of the company's hangars there houses (v3 facilities). */
export const hubSpots = (db: Db, companyId: number, at: number): { icao: string; spots: number; used: number }[] =>
  all<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY icao', companyId)
    .map((h) => ({ icao: h.icao, spots: hubCapacity(db, companyId, h.icao, at), used: hubUsed(db, companyId, h.icao) }));

/** 409 hub_full when the hub has no free spot. AI companies are not capped (their fleet size has its own limit). */
export function assertHubSpot(db: Db, companyId: number, hub: string, at: number): void {
  if (!isHuman(db, companyId)) return;
  const spots = hubCapacity(db, companyId, hub, at), used = hubUsed(db, companyId, hub);
  if (used >= spots) throw new HttpError(409, 'hub_full', `${hub} has no free parking spot (${used} of ${spots} taken)`);
}

/** The one place an aircraft row is created: it always gets a registration, an owner type and its base. */
export function insertAircraft(db: Db, o: { companyId: number; icao: string; hub: string; value: number; ownership: Ownership; at: number }): number {
  return run(db, 'INSERT INTO aircraft (company_id, icao, location, value, registration, ownership, base, acquired_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    o.companyId, o.icao, o.hub, o.value, nextRegistration(db, o.hub), o.ownership, o.hub, o.at).id;
}

export function activeContractsOf(db: Db, companyId: number): Map<number, ContractRow> {
  return new Map(all<ContractRow>(db, "SELECT * FROM contracts WHERE company_id = ? AND status = 'active'", companyId).map((c) => [c.aircraft_id, c]));
}

export const contractView = (c: ContractRow): AircraftContract => ({ kind: c.kind, id: c.id, monthly: c.monthly, hourly: c.hourly, endsAt: c.ends_at });

export function financeFields(a: { registration: string | null; ownership: Ownership; wear_pct: number; status: string; maintenance_until: number | null; available_at: number }, busy: boolean, contract: ContractRow | undefined, now: number): FleetAircraftFinance {
  const maintenance = a.status === 'maintenance';
  return {
    registration: a.registration ?? '', ownership: a.ownership, wearPct: Math.round(a.wear_pct * 10) / 10,
    status: maintenance ? 'maintenance' : busy ? 'flying' : 'available', maintenanceUntil: maintenance ? a.maintenance_until : null,
    contract: contract ? contractView(contract) : null, ferryUntil: a.available_at > now ? a.available_at : null,
  };
}

// ---------------------------------------------------------------- wear & maintenance

/** Workshop visits that are over: the aircraft is available again with fresh wear. Cheap no-op when none is due. */
export function releaseMaintenance(db: Db, now: number): void {
  run(db, `UPDATE aircraft SET status = 'available', maintenance_until = NULL, wear_pct = ? WHERE status = 'maintenance' AND maintenance_until <= ?`, WEAR_AFTER_MAINTENANCE_PCT, now);
}

/** 409 when the aircraft is in the workshop, on a ferry flight or on a line leg; 404 when it is already handed back. */
export function assertFlyable(db: Db, aircraftId: number, now: number): void {
  releaseMaintenance(db, now);
  const a = get<{ status: string; maintenance_until: number | null; returned_at: number | null; available_at: number }>(db, 'SELECT status, maintenance_until, returned_at, available_at FROM aircraft WHERE id = ?', aircraftId);
  if (!a || a.returned_at !== null) throw new HttpError(404, 'aircraft_not_found', 'aircraft not found');
  if (a.status === 'maintenance') throw new HttpError(409, 'in_maintenance', `this aircraft is in maintenance until ${new Date(a.maintenance_until ?? now).toISOString()}`);
  if (a.available_at > now) throw new HttpError(409, 'aircraft_busy', `this aircraft is on a ferry flight until ${new Date(a.available_at).toISOString()}`);
  // v3: an aircraft in the air on one of the company's autonomous lines (lines.ts) cannot be taken for a flown job.
  const leg = get<{ dest: string; until: number }>(db, "SELECT dest, arr_at + delay_min * 60000 AS until FROM scheduled_flights WHERE aircraft_id = ?1 AND status = 'done' AND dep_at <= ?2 AND arr_at + delay_min * 60000 > ?2", aircraftId, now);
  if (leg) throw new HttpError(409, 'aircraft_busy', `this aircraft is flying a line leg to ${leg.dest} until ${new Date(leg.until).toISOString()}`);
}

/** The aircraft is doing nothing and is bound to nothing: flyable (`assertFlyable`), not on a flight in progress and not on a line. What a ferry and a cession of the aircraft to another company both need. */
export function assertIdle(db: Db, aircraftId: number, now: number): void {
  assertFlyable(db, aircraftId, now);
  if (get(db, "SELECT 1 AS x FROM flights WHERE aircraft_id = ? AND status = 'active'", aircraftId)) throw new HttpError(409, 'aircraft_busy', `aircraft ${aircraftId} is on a flight`);
  if (get(db, 'SELECT 1 AS x FROM line_aircraft WHERE aircraft_id = ?', aircraftId)) throw new HttpError(409, 'aircraft_on_line', 'this aircraft flies a line: take it off the line first');
}

/** Wear accrues per block hour by category, for player companies with `wearEnabled`. At the threshold the aircraft goes to the workshop; each of its components wears too (parts.ts). */
export function accrueWear(db: Db, companyId: number, aircraftId: number, category: AircraftCategory, hours: number, at: number): void {
  if (!isHuman(db, companyId) || !wearEnabled(db, companyId)) return;
  const a = get<{ wear_pct: number }>(db, 'SELECT wear_pct FROM aircraft WHERE id = ?', aircraftId);
  if (!a) return;
  const wear = wearAfter(a.wear_pct, category, hours);
  if (wear >= WEAR_THRESHOLD_PCT) {
    // a hangar at the aircraft's base halves the time in the workshop (v3 facilities)
    const downtime = MAINTENANCE_HOURS[category] * HOUR * (hangarEffectFor(db, aircraftId, category, at)?.downtimeFactor ?? 1);
    run(db, "UPDATE aircraft SET wear_pct = ?, status = 'maintenance', maintenance_until = ? WHERE id = ?", wear, at + Math.round(downtime), aircraftId);
  } else {
    run(db, 'UPDATE aircraft SET wear_pct = ? WHERE id = ?', wear, aircraftId);
  }
  // v3 parts: the components wear with it, and a mechanical one that reaches its failure wear breaks down (spare parts decide for how long)
  wearComponents(db, { companyId, aircraftId, category, hours, at });
}

// ---------------------------------------------------------------- settlement by contract

export type FlightCosts = { settlement: Settlement; fuelKind: 'fuel' | 'club_hours' };

/** Club and monthly-rental aircraft: the hourly rate replaces fuel and maintenance (it is booked in the `fuelCost` column and as ledger kind `club_hours`).
 *  A lease with maintenance included pays no maintenance. Everything else settles as before. */
function contractCosts(db: Db, aircraftId: number, blockHours: number, s: Settlement): FlightCosts {
  const c = get<ContractRow>(db, "SELECT * FROM contracts WHERE aircraft_id = ? AND status = 'active'", aircraftId);
  if (!c) return { settlement: s, fuelKind: 'fuel' };
  if (c.kind === 'club' || c.kind === 'rental') {
    const fuelCost = Math.round((c.hourly ?? 0) * blockHours);
    return { settlement: { ...s, fuelCost, maintenance: 0, net: s.revenue - fuelCost - s.landingFee }, fuelKind: c.kind === 'club' ? 'club_hours' : 'fuel' };
  }
  if (c.kind === 'lease' && (JSON.parse(c.terms ?? '{}') as Partial<LeaseTerms>).maintenanceIncluded) {
    return { settlement: { ...s, maintenance: 0, net: s.revenue - s.fuelCost - s.landingFee }, fuelKind: 'fuel' };
  }
  return { settlement: s, fuelKind: 'fuel' };
}

/** The worn components first (v3 parts: a worn interior sells fewer seats, worn engines burn more), then `contractCosts`, then the hangar of the aircraft's base takes its share off what maintenance
 *  is still charged (B.4: -35 %, less when short of technicians). */
export function flightCosts(db: Db, aircraftId: number, blockHours: number, s: Settlement, category: AircraftCategory, at: number): FlightCosts {
  const r = contractCosts(db, aircraftId, blockHours, wornSettlement(db, aircraftId, category, s));
  const fx = r.settlement.maintenance > 0 ? hangarEffectFor(db, aircraftId, category, at) : null;
  if (!fx) return r;
  const maintenance = Math.round(r.settlement.maintenance * (1 - fx.discount));
  return { ...r, settlement: { ...r.settlement, maintenance, net: r.settlement.net + r.settlement.maintenance - maintenance } };
}
