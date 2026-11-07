// Lot FACILITIES (v3), server side, part 1: the leaf. What a building does once a company holds it (hangar: cheaper and faster maintenance, more parking spots; offices: workstations;
// operations centre: more lines) and the rows monthly billing reads. It imports the database and the catalogue only, never game.ts or fleet-extras.ts, because those import it.
// Commands are in facilities-manage.ts, read models in facilities-views.ts. docs/v3-plan.md B.4 and its S3 implementation notes.
import {
  DESKS_FREE, DESK_FAMILIES, MAX_LINES_PER_COMPANY, MAX_LINES_WITH_OPS, PARKING_SPOTS_PER_HUB, desksFor, hangarAircraft, hangarEffect, maintenanceSale, slotsFor,
  type AircraftCategory, type FacilityContractKind, type HangarEffect, type PlanFacility, type SlotSeed, type StaffFamily,
} from '@opc/shared';
import { airports } from './catalog.ts';
import { all, get, run, type Db } from './db.ts';
import { HttpError } from './http.ts';

export type FacilityRow = { id: number; hub_icao: string; slot: string };
export type FacilityContractRow = {
  id: number; facility_id: number; company_id: number; kind: FacilityContractKind; status: 'active' | 'ended'; started_at: number; ended_at: number | null; months: number | null; months_paid: number;
  monthly: number; upkeep: number; deposit: number; price: number; principal: number; value: number; notice_months: number;
  level: number; level_since: number; works_to: number | null; works_until: number | null;
};
/** A contract with the building it holds. */
export type Held = FacilityContractRow & { hub_icao: string; slot: string };

export const seedOf = (hub: string, slot: string): SlotSeed | undefined => slotsFor(hub, airports.get(hub)?.size ?? 'small').find((s) => s.slot === slot);
const effectOf = (h: Pick<Held, 'hub_icao' | 'slot'>): string => seedOf(h.hub_icao, h.slot)?.effect ?? 'none';

// ---------------------------------------------------------------- levels: works are folded lazily, the level in force is always derived from the clock

const worksDone = (c: Pick<FacilityContractRow, 'works_to' | 'works_until'>, at: number): boolean => c.works_to !== null && c.works_until !== null && c.works_until <= at;
/** The level a building works at instant `at`: during works it keeps the level below. */
export const levelAt = (c: FacilityContractRow, at: number): number => (worksDone(c, at) ? c.works_to! : c.level);
export const levelSinceAt = (c: FacilityContractRow, at: number): number => (worksDone(c, at) ? c.works_until! : c.level_since);

// ---------------------------------------------------------------- reading what a company holds

const HELD_SQL = `SELECT c.*, f.hub_icao, f.slot FROM facility_contracts c JOIN facilities f ON f.id = c.facility_id WHERE c.company_id = ? AND c.status = 'active'`;
/** The company's active contracts, optionally at one hub, in signing order. */
export const heldBy = (db: Db, companyId: number, hub?: string): Held[] =>
  hub ? all<Held>(db, `${HELD_SQL} AND f.hub_icao = ? ORDER BY c.id`, companyId, hub) : all<Held>(db, `${HELD_SQL} ORDER BY c.id`, companyId);

export const heldFacility = (db: Db, companyId: number, facilityId: number): Held | undefined =>
  get<Held>(db, `${HELD_SQL} AND c.facility_id = ?`, companyId, facilityId);

/** Make sure every slot of the airport has a row (the catalogue is code: only the ids are stored). Returns the rows in catalogue order. */
export function ensureSlots(db: Db, hub: string): FacilityRow[] {
  const seeds = slotsFor(hub, airports.get(hub)?.size ?? 'small');
  const have = all<FacilityRow>(db, 'SELECT * FROM facilities WHERE hub_icao = ?', hub);
  if (have.length < seeds.length) for (const s of seeds) run(db, 'INSERT INTO facilities (hub_icao, slot) VALUES (?, ?) ON CONFLICT DO NOTHING', hub, s.slot);
  const rows = new Map(all<FacilityRow>(db, 'SELECT * FROM facilities WHERE hub_icao = ?', hub).map((r) => [r.slot, r]));
  return seeds.map((s) => rows.get(s.slot)!);
}

// ---------------------------------------------------------------- staff the effects read (the STAFF tables)

/** Technicians employed at the hub at instant `at`. */
export const technicianCount = (db: Db, companyId: number, hub: string, at: number): number =>
  get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff WHERE company_id = ? AND family = 'maintenance' AND base = ? AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`, companyId, hub, at, at)!.n;
const technicianPayroll = (db: Db, companyId: number, hub: string, at: number): number =>
  get<{ s: number | null }>(db, `SELECT SUM(salary) AS s FROM staff WHERE company_id = ? AND family = 'maintenance' AND base = ? AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`, companyId, hub, at, at)!.s ?? 0;

// ---------------------------------------------------------------- hangar: maintenance cost, workshop time, parking spots

/** Levels in force of the company's hangars at the hub (a contract that has not started is not counted: nothing is retroactive). */
export const hangarLevels = (db: Db, companyId: number, hub: string, at: number): number[] =>
  heldBy(db, companyId, hub).filter((h) => h.started_at <= at && effectOf(h) === 'hangar').map((h) => levelAt(h, at));

/** What the company's hangars give an aircraft based at their hub, at instant `at`. null: none that can service it (a wide-body needs a level-3 hangar). */
export function hangarEffectFor(db: Db, aircraftId: number, category: AircraftCategory, at: number): HangarEffect | null {
  const a = get<{ company_id: number; base: string | null }>(db, 'SELECT company_id, base FROM aircraft WHERE id = ?', aircraftId);
  if (!a?.base) return null;
  const levels = hangarLevels(db, a.company_id, a.base, at);
  return levels.length === 0 ? null : hangarEffect(levels, technicianCount(db, a.company_id, a.base, at), category === 'jet-widebody');
}

/** Parking spots of a hub: the airport's ten, plus the aircraft each hangar houses. Players only (AI companies are not capped). */
export const hubCapacity = (db: Db, companyId: number, hub: string, at: number): number =>
  PARKING_SPOTS_PER_HUB + hangarLevels(db, companyId, hub, at).reduce((t, l) => t + hangarAircraft(l), 0);

// ---------------------------------------------------------------- offices: workstations for the people who are not on a flight

/** Non-flying staff of the base (ground, administration, maintenance, kitchen) who are employed or hired: each needs a workstation. */
export const seatsUsed = (db: Db, companyId: number, base: string, at: number): number =>
  get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff WHERE company_id = ? AND base = ? AND family IN (${DESK_FAMILIES.map(() => '?').join(',')}) AND (ends_at IS NULL OR ends_at > ?)`, companyId, base, ...DESK_FAMILIES, at)!.n;
export const seatCapacity = (db: Db, companyId: number, base: string, at: number): number =>
  DESKS_FREE + heldBy(db, companyId, base).filter((h) => effectOf(h) === 'desks').reduce((t, h) => t + desksFor(levelAt(h, at)), 0);

/** 409 no_workstation when a base has no seat left for one more of these people (STAFF calls it before it hires). */
export function assertSeat(db: Db, companyId: number, family: StaffFamily, base: string, at: number): void {
  if (!(DESK_FAMILIES as readonly string[]).includes(family)) return;
  const capacity = seatCapacity(db, companyId, base, at), used = seatsUsed(db, companyId, base, at);
  if (used >= capacity) throw new HttpError(409, 'no_workstation', `${base} has no workstation left (${used} of ${capacity}): rent administrative offices there`, { base, used, capacity });
}

// ---------------------------------------------------------------- operations centre: the line limit (C5)

const ops = (db: Db, companyId: number): boolean => heldBy(db, companyId).some((h) => effectOf(h) === 'ops');
/** Lines a company may fly: free up to MAX_LINES_PER_COMPANY, more with an operations centre at any of its hubs. */
export const lineLimit = (db: Db, companyId: number): number => (ops(db, companyId) ? MAX_LINES_WITH_OPS : MAX_LINES_PER_COMPANY);

// ---------------------------------------------------------------- monthly billing rows

/** The company's contracts as `planFacilityMonth` reads them, at instant `at`. A hangar of level 3 that is fully staffed sells its capacity (income for the month). */
export function planRows(db: Db, companyId: number, at: number): PlanFacility[] {
  return heldBy(db, companyId).map((h) => {
    const seed = seedOf(h.hub_icao, h.slot);
    const sells = seed?.effect === 'hangar' && levelAt(h, at) >= 3 && !hangarEffect([levelAt(h, at)], technicianCount(db, companyId, h.hub_icao, at), false)!.understaffed;
    return {
      id: h.id, label: `${h.hub_icao} ${h.slot}`, kind: h.kind, started_at: h.started_at, months: h.months, months_paid: h.months_paid, monthly: h.monthly, upkeep: h.upkeep, principal: h.principal,
      income: sells ? maintenanceSale(seed!.rent, technicianPayroll(db, companyId, h.hub_icao, at)) : 0,
    };
  });
}

/** Persist what the plan changed (instalments paid, principal left). */
export function savePlanRows(db: Db, before: readonly PlanFacility[], after: readonly PlanFacility[]): void {
  for (const n of after) {
    const o = before.find((x) => x.id === n.id)!;
    if (n.months_paid !== o.months_paid || n.principal !== o.principal) run(db, 'UPDATE facility_contracts SET months_paid = ?, principal = ? WHERE id = ?', n.months_paid, n.principal, n.id);
  }
}
