// Lot FACILITIES (v3), server side, part 3: read models. Everything is relative to the company asking: the same building is `player` for its holder, `ai` for any other holder
// (an AI company seeded in the catalogue, or another player), `airport` when it is not for sale and `available` when she can sign. Wire types: shared/src/facilities.ts.
import {
  DAY_MS, FACILITY_MAX_LEVEL, PARKING_FEE_BY_SIZE, PLAN_FILTERS, RENEWAL_WINDOW_DAYS, SUGGEST_MIN_PER_WEEK, SUGGEST_WINDOW_DAYS, facilityLevels, hangarEffect, layoutOf, leaseExitFee, leaseTermEnd,
  leaseTerms, nextLevelAt, purchaseTerms, salaryFor, signing, techniciansFor,
  type Building, type FacilityContractView, type FacilityDetail, type FacilityOwner, type FacilityQuery, type FacilityRequirement, type FacilityView, type HubOverview, type HubParking, type HubPlan,
  type HubsOverview, type StaffFamily,
} from '@opc/shared';
import { airports } from './catalog.ts';
import { all, get, type Db } from './db.ts';
import { hubUsed } from './fleet-extras.ts';
import {
  assertHub, ensureSlots, facilityById, forRent, hangarLevels, heldBy, holderOf, holdersAt, hubCapacity, labelOf, levelAt, levelSinceAt, seedOf, seedsOf, technicianCount, worksAt,
  type FacilityContractRow, type FacilityRow, type Holder,
} from './facilities.ts';
import { balanceOf, typeFor } from './game.ts';
import { basesOf, market } from './staff-people.ts';

// ---------------------------------------------------------------- one building

export function facilityContractView(c: FacilityContractRow, at: number): FacilityContractView {
  const lease = c.kind === 'lease';
  return {
    id: c.id, kind: c.kind, startedAt: c.started_at, months: c.months, monthsPaid: c.months_paid, monthly: c.monthly, upkeep: c.upkeep, deposit: c.deposit, price: c.price, principal: c.principal,
    noticeMonths: c.notice_months, levelSince: levelSinceAt(c, at),
    exit: lease ? { fee: leaseExitFee(c.monthly, c.months ?? 0, c.months_paid, c.notice_months), refund: c.deposit } : { fee: c.principal, refund: c.value },
  };
}

/** What a held building costs a month: the rent, or the upkeep and the instalment while the credit lasts. */
export const monthlyOf = (c: FacilityContractRow): number => (c.kind === 'lease' ? c.monthly : c.upkeep + (c.principal > 0 && c.months_paid < (c.months ?? 0) ? c.monthly : 0));

export function facilityView(db: Db, companyId: number, f: FacilityRow, holder: Holder | undefined, now: number): FacilityView {
  const seed = seedOf(f.hub_icao, f.slot)!;
  const mine = holder && holder.company_id === companyId ? holder : undefined;
  const owner: FacilityOwner = mine ? 'player' : holder || seed.owner === 'ai' ? 'ai' : seed.owner === 'airport' ? 'airport' : 'available';
  const max = FACILITY_MAX_LEVEL[seed.effect];
  const level = mine ? levelAt(mine, now) : 1;
  const works = mine ? worksAt(mine, now) : null;
  const target = works?.toLevel ?? level;
  const hangars = mine && seed.effect === 'hangar' ? hangarLevels(db, companyId, f.hub_icao, now) : [];
  return {
    id: f.id, hub: f.hub_icao, slot: f.slot, name: seed.name, kind: seed.kind, effect: seed.effect, areaM2: seed.areaM2, owner, ownerName: holder?.company_name ?? seed.holder, rent: seed.rent,
    level, maxLevel: max, contract: mine ? facilityContractView(mine, now) : null, works,
    nextLevelAt: mine && target < max ? nextLevelAt(target, works?.until ?? levelSinceAt(mine, now)) : null,
    understaffed: hangars.length > 0 && hangarEffect(hangars, technicianCount(db, companyId, f.hub_icao, now), false)!.understaffed,
    monthly: mine ? monthlyOf(mine) : 0,
  };
}

// ---------------------------------------------------------------- the plan of a hub

const parkingOf = (db: Db, companyId: number, hub: string, now: number): HubParking => {
  const used = hubUsed(db, companyId, hub);
  return { spots: hubCapacity(db, companyId, hub, now), used, monthly: used * PARKING_FEE_BY_SIZE[airports.get(hub)?.size ?? 'small'] };
};

export function hubPlan(db: Db, companyId: number, icao: string, now: number): HubPlan {
  assertHub(db, companyId, icao);
  const rows = ensureSlots(db, icao);
  const holders = new Map(holdersAt(db, icao).map((h) => [h.facility_id, h]));
  const buildings: Building[] = rows.map((f) => {
    const v = facilityView(db, companyId, f, holders.get(f.id), now);
    return { slot: v.slot, facilityId: v.id, name: v.name, kind: v.kind, effect: v.effect, areaM2: v.areaM2, owner: v.owner, ownerName: v.ownerName, rent: v.rent, level: v.level, monthly: v.monthly };
  });
  const count = (o: FacilityOwner): number => buildings.filter((b) => b.owner === o).length;
  return { airport: icao, layout: layoutOf(icao), buildings, filters: PLAN_FILTERS, summary: { yours: count('player'), available: count('available'), ai: count('ai') }, parking: parkingOf(db, companyId, icao, now) };
}

// ---------------------------------------------------------------- the overview of all hubs

const employedSql = `company_id = ? AND starts_at <= ?2 AND (ends_at IS NULL OR ends_at > ?2)`;

function hubOverview(db: Db, companyId: number, icao: string, main: boolean, now: number): HubOverview {
  const a = airports.get(icao);
  const rows = ensureSlots(db, icao);
  const holders = new Map(holdersAt(db, icao).map((h) => [h.facility_id, h]));
  const views = rows.map((f) => facilityView(db, companyId, f, holders.get(f.id), now));
  const facilities = views.filter((v) => v.owner === 'player' || v.owner === 'available');
  const byFamily: Partial<Record<StaffFamily, number>> = {};
  for (const r of all<{ family: StaffFamily; n: number }>(db, `SELECT family, COUNT(*) AS n FROM staff WHERE ${employedSql} AND base = ?3 GROUP BY family`, companyId, now, icao)) byFamily[r.family] = r.n;
  const aircraft = all<{ id: number; registration: string | null; icao: string; location: string; status: string; maintenance_until: number | null; busy: number }>(db,
    `SELECT a.*, EXISTS (SELECT 1 FROM flights f WHERE f.aircraft_id = a.id AND f.status = 'active')
        OR EXISTS (SELECT 1 FROM scheduled_flights s WHERE s.aircraft_id = a.id AND s.status = 'done' AND s.dep_at <= ?3 AND s.arr_at + s.delay_min * 60000 > ?3) AS busy
     FROM aircraft a WHERE a.company_id = ?1 AND a.base = ?2 AND a.returned_at IS NULL ORDER BY a.id`, companyId, icao, now)
    .map((x) => ({ id: x.id, reg: x.registration ?? `#${x.id}`, icao: x.icao, typeName: typeFor(db, companyId, x.icao).name, status: x.status === 'maintenance' ? 'maintenance' : x.busy ? 'flying' : 'available', location: x.location, maintenanceUntil: x.status === 'maintenance' ? x.maintenance_until : null }));
  const parking = parkingOf(db, companyId, icao, now);
  const renewals = heldBy(db, companyId, icao).flatMap((h) => {
    const before = h.kind === 'lease' ? leaseTermEnd(h.started_at, h.months ?? 0) : 0;
    return before > now && before - now <= RENEWAL_WINDOW_DAYS * DAY_MS ? [{ facilityId: h.facility_id, name: seedOf(h.hub_icao, h.slot)?.name ?? labelOf(h), before }] : [];
  });
  return {
    icao, name: a?.name ?? icao, city: a?.city ?? icao, role: main ? 'main' : 'secondary', layout: layoutOf(icao), facilities,
    monthlyCost: views.reduce((t, v) => t + v.monthly, 0) + parking.monthly,
    team: { total: Object.values(byFamily).reduce((t, n) => t + n, 0), byFamily }, aircraft, renewals, parking,
  };
}

/** An airport the company flies to a lot (hand-flown or on a line) without a base there: the places a new hub would pay off. */
function suggestion(db: Db, companyId: number, now: number): HubsOverview['suggestion'] {
  const bases = new Set(basesOf(db, companyId));
  const since = now - SUGGEST_WINDOW_DAYS * DAY_MS;
  const top = all<{ icao: string; n: number }>(db, `SELECT dest AS icao, COUNT(*) AS n FROM (
      SELECT destination AS dest FROM flights WHERE company_id = ?1 AND status IN ('verified','unverified') AND completed_at >= ?2
      UNION ALL SELECT dest FROM scheduled_flights WHERE company_id = ?1 AND status = 'done' AND dep_at >= ?2) GROUP BY dest ORDER BY n DESC, dest`, companyId, since)
    .find((r) => !bases.has(r.icao) && airports.has(r.icao));
  const perWeek = top ? top.n / (SUGGEST_WINDOW_DAYS / 7) : 0;
  if (!top || perWeek < SUGGEST_MIN_PER_WEEK) return null;
  const rents = seedsOf(top.icao).filter((s) => forRent(s, false)).map((s) => s.rent);
  return { icao: top.icao, flightsPerWeek: Math.round(perWeek * 10) / 10, fromMonthly: rents.length > 0 ? Math.min(...rents) : 0 };
}

export function hubsOverview(db: Db, companyId: number, now: number): HubsOverview {
  const icaos = all<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY rowid', companyId).map((h) => h.icao);
  const hubs = icaos.map((icao, i) => hubOverview(db, companyId, icao, i === 0, now));
  return {
    company: {
      name: get<{ name: string }>(db, 'SELECT name FROM companies WHERE id = ?', companyId)!.name, hubs: hubs.length,
      aircraft: get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM aircraft WHERE company_id = ? AND returned_at IS NULL', companyId)!.n,
      employees: get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff WHERE ${employedSql}`, companyId, now)!.n,
    },
    monthlyCost: hubs.reduce((t, h) => t + h.monthlyCost, 0), hubs, suggestion: suggestion(db, companyId, now),
  };
}

// ---------------------------------------------------------------- the contract screen

/** What a technician costs a month when hired at mid experience: the price of the people a hangar still needs. */
const TECHNICIAN_SALARY = salaryFor('maintenance', 'technician', 0.5, null);

export function facilityDetail(db: Db, companyId: number, id: number, q: FacilityQuery, now: number): FacilityDetail {
  const f = facilityById(db, id);
  assertHub(db, companyId, f.hub_icao);
  const holder = holderOf(db, id);
  const facility = facilityView(db, companyId, f, holder, now);
  const seed = seedOf(f.hub_icao, f.slot)!;
  const offered = forRent(seed, !!holder);
  const level = Math.min(q.level, facility.maxLevel);
  let required: FacilityRequirement[] = [];
  if (seed.effect === 'hangar') {
    const need = hangarLevels(db, companyId, f.hub_icao, now).reduce((t, l) => t + techniciansFor(l), 0) + (facility.owner === 'player' ? 0 : techniciansFor(level));
    required = [{ family: 'maintenance', role: 'technician', need, have: technicianCount(db, companyId, f.hub_icao, now), candidates: market(db, companyId, now, { family: 'maintenance', base: f.hub_icao }).length }];
  }
  let due: FacilityDetail['due'] = null;
  if (offered) {
    const s = signing(seed.rent, q.mode === 'buy' ? 'purchase' : 'lease', level, q.mode === 'buy' && q.downPct !== undefined ? { downPct: q.downPct, months: q.months! } : undefined);
    const missing = required[0] ? Math.max(0, required[0].need - required[0].have) : 0;
    due = { today: s.today, monthly: s.monthly, staffMonthly: missing * TECHNICIAN_SALARY, balanceAfter: balanceOf(db, companyId) - s.today };
  }
  return { facility, offer: offered ? { lease: leaseTerms(seed.rent), purchase: purchaseTerms(seed.rent) } : null, levels: facilityLevels(seed.effect, seed.rent), required, due };
}
