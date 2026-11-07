// Lot PARTS (v3), server side, part 1: the leaf. What happens to an aircraft's components as it flies (wear, and the breakdown when a mechanical one reaches its failure wear), what that wear costs a
// flight and an incident roll, and the shelf of spare parts a breakdown draws on. It imports the database, the ledger, the realism toggles and the facilities leaf only, never game.ts or fleet-extras.ts,
// because those import it. Commands are in parts-manage.ts, read models in parts-views.ts. docs/v3-plan.md B.6 and its S5 implementation notes.
import {
  DAY_MS, FAILURE_WEAR_PCT, HEAVY_HANGAR_LEVEL, RENEWED_WEAR_PCT, TRANSPORT_COST, addEffects, componentWearAfter, componentsOf, deliveryDays, failedPart, fixHours, hangarEffect, isMechanical, kitOf,
  moneyFactors, partClassOf, reliabilityRiskFactor, seedWear, wearEffects,
  type AircraftCategory, type CatalogPart, type Component, type Effects, type Mechanical, type PartClass, type PartsPolicy, type Settlement,
} from '@opc/shared';
import { hashSeed, mulberry32 } from './board.ts';
import { all, get, run, type Db } from './db.ts';
import { hangarLevels, technicianCount } from './facilities.ts';
import type { AircraftRow } from './game.ts';
import { HttpError } from './http.ts';
import { post } from './ledger.ts';
import { wearEnabled } from './realism.ts';

export type ComponentRow = { aircraft_id: number; component: Component; wear_pct: number; refurb_until: number | null };
export type OrderRow = { id: number; company_id: number; hub: string; part: string; qty: number; ordered_at: number; eta: number; cost: number; express: number; received: number };
export type BreakdownRow = { id: number; company_id: number; aircraft_id: number; hub: string; component: Mechanical; part: string; failed_at: number; eta: number; ready_at: number; paid: number; from_stock: number };
export type PolicyRow = { company_id: number; hub: string; icao: string; cls: PartClass; policy: PartsPolicy };

// ---------------------------------------------------------------- whose aircraft

/** The company's own aircraft (not handed back), 404 otherwise. */
export function ownAircraft(db: Db, companyId: number, aircraftId: number): AircraftRow {
  const a = get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ? AND company_id = ? AND returned_at IS NULL', aircraftId, companyId);
  if (!a) throw new HttpError(404, 'aircraft_not_found', 'aircraft not found');
  return a;
}
/** The aircraft a hub keeps parts for: based there and hers (a club or rented aircraft is kept by its owner). */
export const basedAt = (db: Db, companyId: number, hub: string): AircraftRow[] =>
  all<AircraftRow>(db, "SELECT * FROM aircraft WHERE company_id = ? AND base = ? AND returned_at IS NULL AND ownership IN ('owned','leased','financed') ORDER BY id", companyId, hub);

// ---------------------------------------------------------------- the lease an aircraft came with

export type LeaseTerms = { maintenanceIncluded?: boolean; airframeHours?: number; lessor?: string; purchaseOptionPrice?: number };
/** The terms of the aircraft's lease or rental contract (the last one, active or not) and whether it is still running. A club or rented aircraft has terms `{}`. */
export function contractOf(db: Db, aircraftId: number): { terms: LeaseTerms; kind: string; active: boolean; endsAt: number | null } | null {
  const c = get<{ terms: string | null; kind: string; status: string; ends_at: number | null }>(db, 'SELECT terms, kind, status, ends_at FROM contracts WHERE aircraft_id = ? ORDER BY id DESC LIMIT 1', aircraftId);
  return c ? { terms: c.terms ? (JSON.parse(c.terms) as LeaseTerms) : {}, kind: c.kind, active: c.status === 'active', endsAt: c.ends_at } : null;
}
/** Who pays for a part that fails: not the company when the aircraft is the club's, a monthly rental, or a lease with maintenance included. */
const lessorPays = (db: Db, aircraftId: number): boolean => {
  const c = contractOf(db, aircraftId);
  return !!c && c.active && (c.kind === 'club' || c.kind === 'rental' || (c.kind === 'lease' && c.terms.maintenanceIncluded === true));
};

// ---------------------------------------------------------------- components: seeded on first use, then worn by the hours flown

export const componentRows = (db: Db, aircraftId: number): ComponentRow[] => all<ComponentRow>(db, 'SELECT * FROM aircraft_components WHERE aircraft_id = ? ORDER BY rowid', aircraftId);

/** The aircraft's components as they stand: the stored rows, and for any not stored yet the wear it comes with (its lease offer's airframe hours; an aircraft bought new starts from new). A pure read. */
export function loadComponents(db: Db, aircraftId: number, category: AircraftCategory): ComponentRow[] {
  const have = new Map(componentRows(db, aircraftId).map((r) => [r.component, r]));
  const hours = have.size >= componentsOf(category).length ? 0 : (contractOf(db, aircraftId)?.terms.airframeHours ?? 0);
  return componentsOf(category).map((c) => have.get(c) ?? { aircraft_id: aircraftId, component: c, wear_pct: seedWear(c, category, hours), refurb_until: null });
}
/** The same, with the missing rows stored: components are written the first time an aircraft wears or is worked on, never by a read. */
export function ensureComponents(db: Db, aircraftId: number, category: AircraftCategory): ComponentRow[] {
  const stored = componentRows(db, aircraftId);
  if (stored.length >= componentsOf(category).length) return stored;
  const have = new Set(stored.map((r) => r.component));
  const rows = loadComponents(db, aircraftId, category);
  for (const r of rows) if (!have.has(r.component)) run(db, 'INSERT INTO aircraft_components (aircraft_id, component, wear_pct) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', aircraftId, r.component, r.wear_pct);
  return rows;
}

export const effectsOf = (rows: readonly Pick<ComponentRow, 'component' | 'wear_pct'>[]): Effects => addEffects(rows.map((r) => wearEffects(r.component, r.wear_pct)));

/** The settlement of a flight with the worn components' effect on it (B.6: engines and propellers cost speed, so fuel and maintenance; the interior, the gear and the avionics cost passengers).
 *  Untouched when "wear and failures" is off for the company (nothing wears, so nothing costs). */
export function wornSettlement(db: Db, aircraftId: number, category: AircraftCategory, s: Settlement): Settlement {
  const company = get<{ company_id: number }>(db, 'SELECT company_id FROM aircraft WHERE id = ?', aircraftId)?.company_id;
  if (company === undefined || !wearEnabled(db, company)) return s;
  const f = moneyFactors(effectsOf(loadComponents(db, aircraftId, category)));
  const revenue = Math.round(s.revenue * f.revenue), fuelCost = Math.round(s.fuelCost * f.cost), maintenance = Math.round(s.maintenance * f.cost);
  return { ...s, revenue, fuelCost, maintenance, net: revenue - fuelCost - s.landingFee - maintenance };
}

/** What the incident roll multiplies its risk by for this aircraft: its worn gear and avionics cost reliability (B.6). The stored components (the roll runs right after the flight wore them); 1 when there are none. */
export function reliabilityRisk(db: Db, aircraftId: number): number {
  const rows = componentRows(db, aircraftId);
  return rows.length === 0 ? 1 : reliabilityRiskFactor(effectsOf(rows).reliability);
}

export type Wear = { companyId: number; aircraftId: number; category: AircraftCategory; hours: number; at: number };
/** Wear every component by the hours flown, then break down the mechanical ones that reached FAILURE_WEAR_PCT. Called by `accrueWear`, which has already decided that wear is on for the company. */
export function wearComponents(db: Db, o: Wear): void {
  for (const r of ensureComponents(db, o.aircraftId, o.category)) {
    const wear = componentWearAfter(r.wear_pct, r.component, o.category, o.hours);
    run(db, 'UPDATE aircraft_components SET wear_pct = ? WHERE aircraft_id = ? AND component = ?', wear, o.aircraftId, r.component);
    if (wear >= FAILURE_WEAR_PCT && isMechanical(r.component)) breakdown(db, o, r.component);
  }
}

// ---------------------------------------------------------------- the hangar's part in it (B.4, level 2)

/** A fully staffed hangar of level HEAVY_HANGAR_LEVEL or more stands at the hub (one that can service the aircraft: a wide-body needs a level-3 hangar): AOG fixed in 4 h, heavy checks without a ferry. */
export function heavyHangarAt(db: Db, companyId: number, hub: string, at: number, category: AircraftCategory): boolean {
  const levels = hangarLevels(db, companyId, hub, at), fx = hangarEffect(levels, technicianCount(db, companyId, hub, at), category === 'jet-widebody');
  return !!fx && !fx.understaffed && Math.max(...levels) >= HEAVY_HANGAR_LEVEL;
}

// ---------------------------------------------------------------- the shelf: stock, orders on their way, policies

export const stockOf = (db: Db, companyId: number, hub: string): Map<string, number> =>
  new Map(all<{ part: string; qty: number }>(db, 'SELECT part, qty FROM parts_stock WHERE company_id = ? AND hub = ? AND qty > 0', companyId, hub).map((r) => [r.part, r.qty]));
const addStock = (db: Db, companyId: number, hub: string, part: string, qty: number): void => {
  run(db, 'INSERT INTO parts_stock (company_id, hub, part, qty) VALUES (?, ?, ?, ?) ON CONFLICT (company_id, hub, part) DO UPDATE SET qty = qty + excluded.qty', companyId, hub, part, qty);
};
/** Take `qty` of a part off the shelf; false (and nothing taken) when the shelf holds fewer. */
export const takeStock = (db: Db, companyId: number, hub: string, part: string, qty: number): boolean =>
  run(db, 'UPDATE parts_stock SET qty = qty - ? WHERE company_id = ? AND hub = ? AND part = ? AND qty >= ?', qty, companyId, hub, part, qty).changes > 0;

export const openOrders = (db: Db, companyId: number, hub?: string): OrderRow[] =>
  hub ? all<OrderRow>(db, 'SELECT * FROM parts_orders WHERE company_id = ? AND hub = ? AND received = 0 ORDER BY eta, id', companyId, hub)
    : all<OrderRow>(db, 'SELECT * FROM parts_orders WHERE company_id = ? AND received = 0 ORDER BY eta, id', companyId);

/** Orders that have arrived by `upTo` go on the shelf. Lazy and idempotent (an order is received once); replaying a past instant receives only what had arrived by then. */
export function receiveOrders(db: Db, companyId: number, upTo: number): void {
  for (const o of all<OrderRow>(db, 'SELECT * FROM parts_orders WHERE company_id = ? AND received = 0 AND eta <= ? ORDER BY eta, id', companyId, upTo)) {
    addStock(db, companyId, o.hub, o.part, o.qty);
    run(db, 'UPDATE parts_orders SET received = 1 WHERE id = ?', o.id);
  }
}

/** Policies at a hub that still mean something: the type has an aircraft based there. */
export const policiesAt = (db: Db, companyId: number, hub: string): PolicyRow[] =>
  all<PolicyRow>(db, `SELECT p.* FROM parts_policy p WHERE p.company_id = ? AND p.hub = ? AND EXISTS (SELECT 1 FROM aircraft a WHERE a.company_id = p.company_id AND a.base = p.hub AND a.icao = p.icao AND a.returned_at IS NULL) ORDER BY p.icao`, companyId, hub);

/** What a set of policies asks the shelf to hold, per part. Parts belong to a class, not to a type, so one shelf serves every type of the class: the largest kit asked for wins. */
export function targetsOf(policies: readonly Pick<PolicyRow, 'cls' | 'policy'>[]): Map<string, number> {
  const t = new Map<string, number>();
  for (const p of policies) for (const l of kitOf(p.cls, p.policy)) t.set(l.part.id, Math.max(t.get(l.part.id) ?? 0, l.qty));
  return t;
}

/** Order `qty` of a part for the hub. The money leaves now; the part arrives after the delivery (2 to 5 days, seeded by the order; a day when `express`). `freight` is billed on top (a standing order of a policy has none). */
export function placeOrder(db: Db, o: { companyId: number; hub: string; part: CatalogPart; qty: number; express: boolean; freight: number; at: number }): OrderRow {
  const cost = o.part.price * o.qty + o.freight;
  const days = o.express ? 1 : deliveryDays(mulberry32(hashSeed(`order:${o.companyId}:${o.hub}:${o.part.id}:${o.at}`))());
  const row = get<OrderRow>(db, 'INSERT INTO parts_orders (company_id, hub, part, qty, ordered_at, eta, cost, express) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
    o.companyId, o.hub, o.part.id, o.qty, o.at, o.at + days * DAY_MS, cost, o.express ? 1 : 0)!;
  post(db, o.companyId, o.at, 'parts_order', -cost, `${o.qty} x ${o.part.name} for ${o.hub}${o.express ? ' (express)' : ''}`);
  return row;
}

export const freightOf = (cls: PartClass, express: boolean): number => TRANSPORT_COST[cls][express ? 'express' : 'normal'];
export const onTheWay = (db: Db, companyId: number, hub: string, part: string): number =>
  get<{ n: number }>(db, 'SELECT COALESCE(SUM(qty), 0) AS n FROM parts_orders WHERE company_id = ? AND hub = ? AND part = ? AND received = 0', companyId, hub, part)!.n;

// ---------------------------------------------------------------- breakdowns

/** A mechanical component reached its failure wear. The part that failed is on the shelf (six hours of repair, four in a staffed level-2 hangar, B.4) or it is bought on the spot, delivered after 2 to 5 days.
 *  The aircraft stays in the workshop until the repair is over, the component starts again from RENEWED_WEAR_PCT, and a shelf that was drawn on is topped up to its policy. The club, a monthly rental and a lease
 *  with maintenance included pay for the part themselves. Seeded by the aircraft, the component and the instant, and unique on them: replaying a breakdown records it once, takes one part and bills it once. */
function breakdown(db: Db, o: Wear, component: Mechanical): void {
  const ac = get<{ base: string | null; location: string; registration: string | null }>(db, 'SELECT base, location, registration FROM aircraft WHERE id = ?', o.aircraftId);
  if (!ac) return;
  if (get(db, 'SELECT 1 AS x FROM breakdowns WHERE aircraft_id = ? AND component = ? AND failed_at = ?', o.aircraftId, component, o.at)) return; // replayed: its part is already off the shelf and billed
  const hub = ac.base ?? ac.location, cls = partClassOf(o.category), rand = mulberry32(hashSeed(`breakdown:${o.aircraftId}:${component}:${o.at}`));
  const part = failedPart(cls, component, rand()), days = deliveryDays(rand());
  receiveOrders(db, o.companyId, o.at);
  const fix = fixHours(heavyHangarAt(db, o.companyId, hub, o.at, o.category)) * 3_600_000;
  const fromStock = takeStock(db, o.companyId, hub, part.id, 1);
  const eta = fromStock ? o.at : o.at + days * DAY_MS, readyAt = eta + fix;
  const paid = fromStock || lessorPays(db, o.aircraftId) ? 0 : part.price + freightOf(cls, false);
  run(db, 'INSERT INTO breakdowns (company_id, aircraft_id, hub, component, part, failed_at, eta, ready_at, paid, from_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', o.companyId, o.aircraftId, hub, component, part.id, o.at, eta, readyAt, paid, fromStock ? 1 : 0);
  if (paid > 0) post(db, o.companyId, o.at, 'parts_emergency', -paid, `${part.name} for ${ac.registration ?? `#${o.aircraftId}`}`, null, { aircraftId: o.aircraftId });
  run(db, 'UPDATE aircraft_components SET wear_pct = ? WHERE aircraft_id = ? AND component = ?', RENEWED_WEAR_PCT, o.aircraftId, component);
  // the workshop keeps the aircraft until the repair is over (the later of this and any visit already booked); releaseMaintenance then hands it back as serviced
  run(db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = MAX(COALESCE(maintenance_until, 0), ?) WHERE id = ?", readyAt, o.aircraftId);
  if (fromStock) restock(db, o.companyId, hub, part, o.at);
}

/** After a part left the shelf, order the missing one back up to the policy's target (a standing order, no freight), if the account can pay for it: a tick never overdraws the company. */
function restock(db: Db, companyId: number, hub: string, part: CatalogPart, at: number): void {
  const target = targetsOf(policiesAt(db, companyId, hub)).get(part.id) ?? 0;
  const have = (stockOf(db, companyId, hub).get(part.id) ?? 0) + onTheWay(db, companyId, hub, part.id);
  if (target <= have || (get<{ balance: number }>(db, 'SELECT balance FROM companies WHERE id = ?', companyId)?.balance ?? 0) < part.price * (target - have)) return;
  placeOrder(db, { companyId, hub, part, qty: target - have, express: false, freight: 0, at });
}

export const breakdownsOf = (db: Db, companyId: number, hub?: string): BreakdownRow[] =>
  hub ? all<BreakdownRow>(db, 'SELECT * FROM breakdowns WHERE company_id = ? AND hub = ? ORDER BY failed_at DESC, id DESC', companyId, hub)
    : all<BreakdownRow>(db, 'SELECT * FROM breakdowns WHERE company_id = ? ORDER BY failed_at DESC, id DESC', companyId);
