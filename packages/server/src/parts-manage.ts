// Lot PARTS (v3), server side, part 2: what the player does (set a stock policy, order a part, send an aircraft to the workshop). Domain operations: callers wrap them in `tx`; a payment the balance
// cannot cover is 409 insufficient_funds, as in facilities-manage.ts. docs/v3-plan.md B.6 and its S5 implementation notes.
import {
  DAY_MS, PARTS, PARTS_RESALE_FACTOR, REFURB_DAYS, componentsOf, groundDayValue, groundDaysPerYear, kitCapital, kitCovers, partById, partClassOf, refurbCost, wearAfterAction,
  type Component, type OrderResult, type PartsPolicy, type PolicyResult, type RefurbAction, type RefurbishResult,
} from '@opc/shared';
import { get, run, type Db } from './db.ts';
import { assertHub } from './facilities.ts';
import { assertFlyable } from './fleet-extras.ts';
import { balanceOf, post, snapshot, typeFor } from './game.ts';
import { HttpError } from './http.ts';
import { economicsOf, orderLine, worksPlan } from './parts-views.ts';
import { basedAt, ensureComponents, freightOf, onTheWay, ownAircraft, placeOrder, policiesAt, receiveOrders, stockOf, targetsOf, takeStock } from './parts.ts';
import { wearEnabled } from './realism.ts';

const short = (needed: number, balance: number): HttpError => new HttpError(409, 'insufficient_funds', `needs ${needed - balance} more`, { needed, balance, missing: needed - balance });
const pay = (db: Db, companyId: number, needed: number): void => { const b = balanceOf(db, companyId); if (b < needed) throw short(needed, b); };

// ---------------------------------------------------------------- the policy of a type

/** Set the stock policy of one type at a hub. The shelf is topped up to what the hub's policies ask (kits are bought without freight and arrive in 2 to 5 days), and parts the old policy asked for and
 *  the new one does not are sold back at PARTS_RESALE_FACTOR; parts the player ordered by hand beyond any policy are never sold. One payment check for the whole change, so it never half-books. */
export function setPolicy(db: Db, companyId: number, hub: string, icao: string, policy: PartsPolicy, now: number): PolicyResult {
  assertHub(db, companyId, hub);
  const own = basedAt(db, companyId, hub).filter((a) => a.icao === icao);
  if (own.length === 0) throw new HttpError(404, 'no_aircraft', `none of your ${icao} is based at ${hub}`);
  receiveOrders(db, companyId, now);
  const type = typeFor(db, companyId, icao), cls = partClassOf(type.category);
  const was = policiesAt(db, companyId, hub), oldPolicy = was.find((p) => p.icao === icao)?.policy ?? 'none', oldTargets = targetsOf(was);
  run(db, 'INSERT INTO parts_policy (company_id, hub, icao, cls, policy) VALUES (?, ?, ?, ?, ?) ON CONFLICT (company_id, hub, icao) DO UPDATE SET policy = excluded.policy, cls = excluded.cls', companyId, hub, icao, cls, policy);
  const targets = targetsOf(policiesAt(db, companyId, hub)), stock = stockOf(db, companyId, hub);
  const buy = PARTS.flatMap((p) => { const missing = (targets.get(p.id) ?? 0) - (stock.get(p.id) ?? 0) - onTheWay(db, companyId, hub, p.id); return missing > 0 ? [{ part: p, qty: missing }] : []; });
  const sell = PARTS.flatMap((p) => { const qty = Math.min(stock.get(p.id) ?? 0, (oldTargets.get(p.id) ?? 0) - (targets.get(p.id) ?? 0)); return qty > 0 ? [{ part: p, qty }] : []; });
  const ordered = buy.reduce((t, l) => t + l.part.price * l.qty, 0), refund = sell.reduce((t, l) => t + Math.round(l.part.price * l.qty * PARTS_RESALE_FACTOR), 0);
  if (balanceOf(db, companyId) + refund < ordered) throw short(ordered - refund, balanceOf(db, companyId));
  for (const l of sell) { takeStock(db, companyId, hub, l.part.id, l.qty); post(db, companyId, now, 'parts_sale', Math.round(l.part.price * l.qty * PARTS_RESALE_FACTOR), `${l.qty} x ${l.part.name} sold back (${hub})`); }
  for (const l of buy) placeOrder(db, { companyId, hub, part: l.part, qty: l.qty, express: false, freight: 0, at: now });
  const econ = economicsOf(type), covers = (p: PartsPolicy) => groundDaysPerYear(type.category, kitCovers(cls, p)) * own.length;
  const deltaGroundDays = covers(policy) - covers(oldPolicy);
  snapshot(db, companyId, now);
  return { icao, policy, capital: kitCapital(cls, policy), deltaGroundDays, annualSaving: Math.round(-deltaGroundDays * groundDayValue(econ)), ordered, refund, balanceAfter: balanceOf(db, companyId) };
}

// ---------------------------------------------------------------- one part, by hand

export function orderPart(db: Db, companyId: number, hub: string, partId: string, qty: number, express: boolean, now: number): OrderResult {
  assertHub(db, companyId, hub);
  const part = partById(partId);
  if (!part) throw new HttpError(404, 'unknown_part', `no part ${partId}`);
  receiveOrders(db, companyId, now);
  const freight = freightOf(part.cls, express), cost = part.price * qty + freight;
  pay(db, companyId, cost);
  const row = placeOrder(db, { companyId, hub, part, qty, express, freight, at: now });
  snapshot(db, companyId, now);
  return { order: orderLine(row), cost, balanceAfter: balanceOf(db, companyId) };
}

// ---------------------------------------------------------------- the workshop

/** Send the aircraft to the workshop to overhaul or replace some of its components. The work is paid now and the aircraft is out of service until it is done: the days of the longest item, halved by a
 *  hangar at its base (B.4), plus the ferry (convoy fee and two days) for a heavy check when no staffed level-2 hangar stands there. The visit services the whole airframe too (wear back to 5 %, as every
 *  workshop visit). Components start over from their new wear at once: the aircraft cannot fly, so nothing wears meanwhile. */
export function refurbish(db: Db, companyId: number, aircraftId: number, items: { component: Component; action: RefurbAction }[], now: number): RefurbishResult {
  const a = ownAircraft(db, companyId, aircraftId);
  if (!wearEnabled(db, companyId)) throw new HttpError(409, 'wear_off', 'this company plays without wear and failures: nothing to refurbish');
  if (!['owned', 'leased', 'financed'].includes(a.ownership)) throw new HttpError(409, 'not_refurbishable', 'a club or rented aircraft is serviced by its owner');
  assertFlyable(db, a.id, now);
  if (get(db, "SELECT 1 AS x FROM flights WHERE aircraft_id = ? AND status = 'active'", a.id)) throw new HttpError(409, 'aircraft_busy', 'this aircraft is on a flight');
  const type = typeFor(db, companyId, a.icao), has = componentsOf(type.category);
  for (const i of items) if (!has.includes(i.component)) throw new HttpError(422, 'no_such_component', `a ${type.name} has no ${i.component}`);
  const rows = new Map(ensureComponents(db, a.id, type.category).map((r) => [r.component, r]));
  const priced = items.map((i) => ({ ...i, cost: refurbCost(i.action, i.component, a.value) }));
  const works = worksPlan(db, a, type, Math.max(...items.map((i) => REFURB_DAYS[i.action][i.component])), now), downUntil = now + works.days * DAY_MS;
  const total = priced.reduce((t, i) => t + i.cost, 0) + works.ferryCost;
  pay(db, companyId, total);
  const reg = a.registration ?? `#${a.id}`;
  for (const i of priced) {
    post(db, companyId, now, 'refurbish', -i.cost, `${reg} ${i.component} ${i.action}`, null, { aircraftId: a.id });
    run(db, 'UPDATE aircraft_components SET wear_pct = ?, refurb_until = ? WHERE aircraft_id = ? AND component = ?', wearAfterAction(i.action, rows.get(i.component)!.wear_pct), downUntil, a.id, i.component);
  }
  if (works.ferryCost > 0) post(db, companyId, now, 'ferry', -works.ferryCost, `${reg} ferry to a workshop`, null, { aircraftId: a.id });
  run(db, "UPDATE aircraft SET status = 'maintenance', maintenance_until = ? WHERE id = ?", downUntil, a.id);
  snapshot(db, companyId, now);
  return { cost: total, ferry: works.ferryCost, downUntil, balanceAfter: balanceOf(db, companyId), items: priced.map(({ component, action, cost }) => ({ component, action, cost })) };
}
