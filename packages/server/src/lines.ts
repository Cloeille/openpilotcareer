// Lot LINES (v3): autonomous lines flown by the server on the simulated clock (docs/v3-plan.md B.1, B.2).
// The simulated clock is the real UTC clock: the engine advances in 15-minute ticks, lazily on any API request, idempotent through
// `line_ticks` exactly like the AI ticks. One catch-up is one transaction, so a tick can never be paid twice and a crash replays it whole.
// A leg is resolved at its departure tick with the same maths as a flown job (`settle`), scaled by the load factor and AUTONOMY_FACTOR.
// Ticks older than MAX_LINE_CATCHUP_TICKS are replayed too but their money is booked in one posting per line, day and kind.
import {
  AUTONOMY_FACTOR, CANCELLED_LEG_REPUTATION, DAY_MS, LINE_KEEP_DAYS, LINE_TICK_MS, MAX_LINE_CATCHUP_TICKS, MAX_OFFLINE_DAYS, PAX_KG, PRESENCE_STEP_MS,
  TICKS_PER_DAY, MAX_DELAY_MIN, blockHours, dayStart, distanceNm, fuelPriceFactor, inheritedDelayMin, isoDay, jobPayout, layoutDay, lineTickOf, maskToDays,
  minToHhmm, pairLoadFactor, realismModifiers, settle, stoppageReputationTotal, weeklyDemand, weeklySeats, wearDelayMin,
  type AircraftType, type CancelCause, type DelayCause, type Line, type LineInterruptCause, type PlannedAircraft, type Programme, type ScheduledFlight, type ScheduledFlightStatus,
} from '@opc/shared';
import { airports } from './catalog.ts';
import { sha256 } from './auth.ts';
import { all, get, run, tx, type Db } from './db.ts';
import { accrueWear, flightCosts, isHuman, releaseMaintenance } from './fleet-extras.ts';
import { hasHub, post, snapshot, typeFor, type AircraftRow } from './game.ts';
import { realismSettingOf } from './realism.ts';
import { crewLeg, crewShortage } from './staff.ts';

/** Ticks replayed after a long silence; older ones are skipped (a human network lapses after MAX_OFFLINE_DAYS anyway). */
const MAX_REPLAY_TICKS = (MAX_OFFLINE_DAYS + 1) * TICKS_PER_DAY;
const CAP_MS = MAX_OFFLINE_DAYS * DAY_MS;
const CREW_LEDGER_DAYS = 366;

// ---------------------------------------------------------------- rows

export type LineRow = {
  id: number; company_id: number; a: string; b: string; status: 'active' | 'paused' | 'interrupted'; created_at: number; freq_per_day: number; days: number;
  window_start_min: number; window_end_min: number; turnaround_min: number; flight_base: number; live_from: number; laid_through: number; paused_at: number | null;
  interrupted_since: number | null; interrupt_cause: LineInterruptCause | null; stoppage_charged: number;
};
export type LegRow = {
  id: number; line_id: number; company_id: number; aircraft_id: number; flight_no: number; dep_at: number; arr_at: number; origin: string; dest: string;
  status: 'scheduled' | 'done' | 'cancelled'; delay_min: number; delay_cause: DelayCause | null; cancel_cause: CancelCause | null; taken_job: string | null;
  pax: number | null; revenue: number | null; fuel_cost: number | null; landing_fee: number | null; maintenance: number | null; crew_family: 'pilot' | 'cabin' | null;
};
export type NetworkRow = { company_id: number; enabled: number; seen_at: number; lapsed_at: number | null };
export type LineAircraftRow = AircraftRow & { home: string };

// ---------------------------------------------------------------- small helpers

/** First tick start strictly after `now`: a leg departing at or before `now` belongs to a tick that has already run (a leg resolves at the tick that STARTS at its departure). */
export const nextBoundary = (now: number): number => (lineTickOf(now) + 1) * LINE_TICK_MS;
export const lineDistance = (a: string, b: string): number => {
  const x = airports.get(a)!, y = airports.get(b)!;
  return Math.round(distanceNm(x.lat, x.lon, y.lat, y.lon));
};
export const blockMinutes = (type: AircraftType, dist: number): number => Math.ceil(blockHours(type, dist) * 60);
export const sizeOf = (icao: string) => airports.get(icao)?.size ?? 'small';
export const programmeOf = (l: LineRow): Programme => ({
  a: l.a, b: l.b, flightBase: l.flight_base, freqPerDay: l.freq_per_day, days: l.days, windowStartMin: l.window_start_min, windowEndMin: l.window_end_min, turnaroundMin: l.turnaround_min,
});
export const lineAircraft = (db: Db, lineId: number): LineAircraftRow[] =>
  all<LineAircraftRow>(db, 'SELECT a.*, la.home FROM line_aircraft la JOIN aircraft a ON a.id = la.aircraft_id WHERE la.line_id = ? ORDER BY a.id', lineId);
export const planned = (db: Db, l: Pick<LineRow, 'a' | 'b' | 'company_id'>, fleet: LineAircraftRow[]): PlannedAircraft[] => {
  const dist = lineDistance(l.a, l.b);
  return fleet.filter((x) => x.returned_at === null).map((x) => ({ id: x.id, blockMin: blockMinutes(typeFor(db, l.company_id, x.icao), dist), home: x.home }));
};
export const companyCode = (db: Db, companyId: number): string => {
  const c = get<{ code: string | null; name: string }>(db, 'SELECT code, name FROM companies WHERE id = ?', companyId);
  return c?.code ?? (c?.name ?? 'OPC').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
};

// ---------------------------------------------------------------- demand and money (one definition for the forecast and for the result)

/** Seats a week on a pair for the given programme and aircraft (in the layout's round-robin order). */
export const seatsOf = (db: Db, companyId: number, fleet: { icao: string }[]): number[] => fleet.map((x) => typeFor(db, companyId, x.icao).seats);

/** Seats a week that OTHER companies' live lines offer on the same pair. */
export function rivalSeats(db: Db, companyId: number, a: string, b: string, excludeLineId = 0): { seats: number; best: { company: string; flightsPerDay: number; seats: number } | null } {
  let seats = 0;
  let best: { company: string; flightsPerDay: number; seats: number } | null = null;
  for (const r of all<LineRow & { name: string }>(db, `SELECT l.*, c.name FROM lines l JOIN companies c ON c.id = l.company_id JOIN line_networks n ON n.company_id = l.company_id
      WHERE l.a = ? AND l.b = ? AND l.company_id != ? AND l.id != ? AND l.status != 'paused' AND n.enabled = 1`, a, b, companyId, excludeLineId)) {
    const s = weeklySeats(r.freq_per_day, r.days, seatsOf(db, r.company_id, lineAircraft(db, r.id).filter((x) => x.returned_at === null)));
    seats += s;
    if (!best || s > best.seats) best = { company: r.name, flightsPerDay: r.freq_per_day, seats: s };
  }
  return { seats, best };
}

export function loadFactorOf(db: Db, p: { companyId: number; a: string; b: string; freqPerDay: number; days: number; fleet: { icao: string }[]; excludeLineId?: number }): number {
  const demand = weeklyDemand(sizeOf(p.a), sizeOf(p.b), lineDistance(p.a, p.b));
  const own = weeklySeats(p.freqPerDay, p.days, seatsOf(db, p.companyId, p.fleet));
  return pairLoadFactor(demand, own, rivalSeats(db, p.companyId, p.a, p.b, p.excludeLineId).seats);
}

export type LegMoney = { pax: number; hours: number; revenue: number; fuel: number; fee: number; maintenance: number };

/** What one autonomous leg earns and costs: the settlement of the same job flown by the player, revenue scaled by AUTONOMY_FACTOR (C1), costs in full. */
export function legMoney(db: Db, companyId: number, aircraftId: number, type: AircraftType, o: { origin: string; dest: string; dep: number }, loadFactor: number): LegMoney {
  const dist = lineDistance(o.origin, o.dest);
  const pax = Math.min(type.seats, Math.round(type.seats * loadFactor));
  const hours = blockHours(type, dist);
  const realism = realismSettingOf(db, companyId);
  const s = settle({
    payout: jobPayout('pax', dist, pax * PAX_KG), distanceNm: dist, aircraft: type, status: 'verified', destSize: sizeOf(o.dest), destIsHub: hasHub(db, companyId, o.dest),
    ...realismModifiers(realism.toggles), ...(realism.toggles.realFuelPrice ? { fuelPriceFactor: fuelPriceFactor(o.origin, o.dep) } : {}),
  });
  const revenue = Math.round(s.revenue * AUTONOMY_FACTOR);
  const { settlement: c } = flightCosts(db, aircraftId, hours, { ...s, revenue, net: revenue - s.fuelCost - s.landingFee - s.maintenance }, type.category, o.dep);
  return { pax, hours, revenue: c.revenue, fuel: c.fuelCost, fee: c.landingFee, maintenance: c.maintenance };
}

// ---------------------------------------------------------------- networks and presence

export const networkOf = (db: Db, companyId: number): NetworkRow | undefined => get<NetworkRow>(db, 'SELECT * FROM line_networks WHERE company_id = ?', companyId);

export function ensureNetwork(db: Db, companyId: number, now: number): NetworkRow {
  run(db, 'INSERT INTO line_networks (company_id, enabled, seen_at) VALUES (?, 1, ?) ON CONFLICT DO NOTHING', companyId, now);
  return networkOf(db, companyId)!;
}

/** Does the company's network run at instant `at`? Switched on, and (for a human) its owner was seen less than MAX_OFFLINE_DAYS before. */
const runsAt = (n: NetworkRow, human: boolean, at: number): boolean => n.enabled === 1 && (!human || at < n.seen_at + CAP_MS);

/** Every request of a signed-in owner (web session or bridge API key: a player flying through the bridge is here) refreshes the presence of all their networks. Returning after the cap restarts the lines from the next tick
 *  (what ran in between never existed, see `layLines`) and lays today's timetable at once. Must run AFTER `catchUpLines`, which settles the past with the old `seen_at`. */
export function touchPresence(db: Db, token: string | null, now: number): void {
  if (!token) return;
  const hash = sha256(token);
  const stale = all<NetworkRow>(db, `SELECT n.* FROM line_networks n JOIN companies c ON c.id = n.company_id
    WHERE n.seen_at < ?2 AND (c.user_id IN (SELECT user_id FROM sessions WHERE token_hash = ?1 AND expires_at > ?3) OR c.user_id IN (SELECT user_id FROM api_keys WHERE key_hash = ?1))`, hash, now - PRESENCE_STEP_MS, now);
  if (stale.length === 0) return;
  tx(db, () => {
    for (const n of stale) {
      run(db, 'UPDATE line_networks SET seen_at = ? WHERE company_id = ?', now, n.company_id);
      if (now >= n.seen_at + CAP_MS) for (const l of all<{ id: number }>(db, 'SELECT id FROM lines WHERE company_id = ?', n.company_id)) relayLine(db, l.id, now);
    }
  });
}

/** Request hook body: play the due ticks, then record presence. Cheap no-op when up to date. */
export function linesRequest(db: Db, now: number, token: string | null): void {
  catchUpLines(db, now);
  touchPresence(db, token, now);
}

// ---------------------------------------------------------------- the tick

type Book = { companyId: number; kind: string; amount: number; at: number; pair: string; day: string; legs: number };
type Run = { bulkBefore: number; books: Map<string, Book>; touched: Map<number, number>; lines: Map<number, LineRow>; loads: Map<number, number>; types: Map<string, AircraftType> };

/** Play every tick that is due. The last MAX_LINE_CATCHUP_TICKS are resolved leg by leg; older ones are replayed too but their money is
 *  aggregated (one posting per line, day and kind). After a silence longer than the offline cap, the days past the cap are not replayed: no network ran in them. */
export function catchUpLines(db: Db, now: number): number {
  const current = lineTickOf(now);
  const last = get<{ t: number | null }>(db, 'SELECT MAX(tick) AS t FROM line_ticks')?.t ?? null;
  if (last !== null && last >= current) return 0;
  if (!get(db, 'SELECT 1 AS x FROM lines LIMIT 1')) return run(db, 'INSERT INTO line_ticks (tick) VALUES (?) ON CONFLICT DO NOTHING', current).changes; // nothing to simulate: just remember where we are
  const liveFrom = current - MAX_LINE_CATCHUP_TICKS + 1;
  const first = last === null ? current : last + 1;
  const firstEnd = Math.min(current, first + MAX_REPLAY_TICKS - 1);
  return tx(db, () => {
    const r: Run = { bulkBefore: liveFrom * LINE_TICK_MS, books: new Map(), touched: new Map(), lines: new Map(), loads: new Map(), types: new Map() };
    let played = 0;
    for (let t = first; t <= current; t = t === firstEnd && firstEnd < current ? Math.max(t + 1, liveFrom) : t + 1) {
      if (t >= liveFrom && r.books.size > 0) flushBooks(db, r);
      if (runTick(db, t, r)) played++;
    }
    flushBooks(db, r);
    for (const [companyId, at] of r.touched) snapshot(db, companyId, at);
    return played;
  });
}

function runTick(db: Db, tick: number, r: Run): boolean {
  if (run(db, 'INSERT INTO line_ticks (tick) VALUES (?) ON CONFLICT DO NOTHING', tick).changes === 0) return false;
  const ts = tick * LINE_TICK_MS;
  r.lines.clear(); r.loads.clear();
  releaseMaintenance(db, ts);
  const live = liveNetworks(db, ts);
  layLines(db, ts, live);
  resolveDue(db, ts, live, r);
  refreshLines(db, ts, live);
  if (tick % TICKS_PER_DAY === 0) {
    run(db, 'DELETE FROM scheduled_flights WHERE dep_at < ?', ts - LINE_KEEP_DAYS * DAY_MS);
    run(db, 'DELETE FROM line_ticks WHERE tick < ?', tick - LINE_KEEP_DAYS * TICKS_PER_DAY);
    run(db, 'DELETE FROM staff_duty WHERE dep_at < ?', ts - (CREW_LEDGER_DAYS * DAY_MS)); // the 12-month flight limit needs a year of ledger
  }
  return true;
}

/** Which companies' networks run at `ts`; records, for humans past the cap, when it stopped them (the instant of the cap, not of this tick). */
function liveNetworks(db: Db, ts: number): Map<number, boolean> {
  const out = new Map<number, boolean>();
  for (const n of all<NetworkRow & { human: number }>(db, 'SELECT n.*, c.user_id IS NOT NULL AS human FROM line_networks n JOIN companies c ON c.id = n.company_id')) {
    out.set(n.company_id, runsAt(n, !!n.human, ts));
    if (n.human && n.enabled === 1 && ts >= n.seen_at + CAP_MS && (n.lapsed_at === null || n.lapsed_at < n.seen_at)) {
      run(db, 'UPDATE line_networks SET lapsed_at = ? WHERE company_id = ?', n.seen_at + CAP_MS, n.company_id);
    }
  }
  return out;
}

/** Lay the legs of today and tomorrow (the days the line has not been laid for yet), never before `live_from`. */
function layLines(db: Db, ts: number, live: Map<number, boolean>): void {
  const horizon = dayStart(ts) + 2 * DAY_MS;
  for (const l of all<LineRow>(db, "SELECT * FROM lines WHERE status != 'paused' AND laid_through < ?", horizon)) {
    if (!live.get(l.company_id)) continue;
    layLine(db, l, horizon);
  }
}

/** Create the legs of the days from `laid_through` up to `horizon` (exclusive). Departures before `live_from` are skipped. Idempotent by the unique key. */
export function layLine(db: Db, l: LineRow, horizon: number): void {
  const fleet = planned(db, l, lineAircraft(db, l.id));
  for (let d = Math.max(dayStart(l.live_from), l.laid_through); d < horizon; d += DAY_MS) {
    for (const leg of layoutDay(programmeOf(l), fleet, d)) {
      if (leg.dep < l.live_from) continue;
      run(db, `INSERT INTO scheduled_flights (line_id, company_id, aircraft_id, flight_no, dep_at, arr_at, origin, dest) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        l.id, l.company_id, leg.aircraftId, leg.flightNo, leg.dep, leg.arr, leg.origin, leg.dest);
    }
  }
  run(db, 'UPDATE lines SET laid_through = ? WHERE id = ?', horizon, l.id);
}

/** Drop the legs that never ran and lay the line again from the next tick (after a change of programme or aircraft, a resume or a switch on).
 *  Laying happens now, not at the next tick, so the timetable the caller returns is already the new one. A paused line keeps no unflown legs. */
export function relayLine(db: Db, lineId: number, now: number): void {
  run(db, "DELETE FROM scheduled_flights WHERE line_id = ? AND status = 'scheduled'", lineId);
  run(db, 'UPDATE lines SET live_from = ?, laid_through = 0 WHERE id = ?', nextBoundary(now), lineId);
  const l = get<LineRow>(db, 'SELECT * FROM lines WHERE id = ?', lineId)!;
  const n = networkOf(db, l.company_id);
  if (l.status !== 'paused' && n && runsAt(n, isHuman(db, l.company_id), now)) layLine(db, l, dayStart(now) + 2 * DAY_MS);
}

function resolveDue(db: Db, ts: number, live: Map<number, boolean>, r: Run): void {
  for (const leg of all<LegRow>(db, "SELECT * FROM scheduled_flights WHERE status = 'scheduled' AND dep_at <= ? ORDER BY dep_at, id", ts)) {
    if (!live.get(leg.company_id)) { run(db, 'DELETE FROM scheduled_flights WHERE id = ?', leg.id); continue; } // switched off, or past the offline cap: it never ran
    resolveLeg(db, leg, r);
  }
}

const lineRow = (db: Db, id: number, r: Run): LineRow => {
  let l = r.lines.get(id);
  if (!l) { l = get<LineRow>(db, 'SELECT * FROM lines WHERE id = ?', id)!; r.lines.set(id, l); }
  return l;
};
const typeOfRun = (db: Db, companyId: number, icao: string, r: Run): AircraftType => {
  const key = `${companyId}:${icao}`;
  let t = r.types.get(key);
  if (!t) { t = typeFor(db, companyId, icao); r.types.set(key, t); }
  return t;
};

function resolveLeg(db: Db, leg: LegRow, r: Run): void {
  const bulk = leg.dep_at < r.bulkBefore;
  const line = lineRow(db, leg.line_id, r);
  const ac = get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ?', leg.aircraft_id);
  // An aircraft stranded at the far end (its return was cancelled) flies the rotation mirrored, so a line never stays dead on a position mismatch.
  const [origin, dest] = ac && ac.location === leg.dest ? [leg.dest, leg.origin] : [leg.origin, leg.dest];
  const grounded = !ac || ac.returned_at !== null || ac.status !== 'available' || ac.location !== origin
    || !!get(db, "SELECT 1 AS x FROM flights WHERE aircraft_id = ? AND status = 'active' AND accepted_at <= ?", leg.aircraft_id, leg.dep_at);
  const crew = grounded || !ac ? null : crewLeg(db, { id: leg.id, companyId: leg.company_id, flightNo: leg.flight_no, dep: leg.dep_at, arr: leg.arr_at, origin, dest, icao: ac.icao });
  const cause: CancelCause | null = grounded ? 'aircraft_unavailable' : crew?.cause ?? null;
  if (cause || !ac) {
    run(db, "UPDATE scheduled_flights SET status = 'cancelled', cancel_cause = ?, crew_family = ? WHERE id = ?", cause ?? 'aircraft_unavailable', crew?.family ?? null, leg.id);
    run(db, 'UPDATE companies SET reputation = MAX(0, reputation - ?) WHERE id = ?', CANCELLED_LEG_REPUTATION, leg.company_id);
    return;
  }
  const type = typeOfRun(db, leg.company_id, ac.icao, r);
  let lf = r.loads.get(line.id);
  if (lf === undefined) {
    lf = loadFactorOf(db, { companyId: line.company_id, a: line.a, b: line.b, freqPerDay: line.freq_per_day, days: line.days, fleet: lineAircraft(db, line.id).filter((x) => x.returned_at === null), excludeLineId: line.id });
    r.loads.set(line.id, lf);
  }
  const m = legMoney(db, leg.company_id, ac.id, type, { origin, dest, dep: leg.dep_at }, lf);

  const prev = get<LegRow>(db, "SELECT * FROM scheduled_flights WHERE aircraft_id = ? AND status = 'done' AND dep_at < ? ORDER BY dep_at DESC LIMIT 1", ac.id, leg.dep_at);
  const inherited = prev ? inheritedDelayMin(prev.delay_min, (leg.dep_at - prev.arr_at) / 60_000, line.turnaround_min) : 0;
  const wearDelay = wearDelayMin(ac.wear_pct);
  const delay = Math.min(MAX_DELAY_MIN, Math.max(inherited, wearDelay));
  const delayCause: DelayCause | null = delay === 0 ? null : inherited > wearDelay ? 'late_inbound' : 'wear';

  const memo = `${origin}-${dest} ${isoDay(leg.dep_at)}`;
  const entries: [string, number][] = [['line_revenue', m.revenue], ['line_fuel', -m.fuel], ['line_fee', -m.fee], ['line_maintenance', -m.maintenance]];
  for (const [kind, amount] of entries) {
    if (amount === 0) continue;
    if (!bulk) { post(db, leg.company_id, leg.dep_at, kind, amount, `${memo} ${leg.flight_no}`); continue; }
    const key = `${line.id}:${isoDay(leg.dep_at)}:${kind}`;
    const b = r.books.get(key) ?? { companyId: leg.company_id, kind, amount: 0, at: leg.dep_at, pair: `${line.a}-${line.b}`, day: isoDay(leg.dep_at), legs: 0 };
    b.amount += amount; b.legs++; b.at = Math.max(b.at, leg.dep_at);
    r.books.set(key, b);
  }
  accrueWear(db, leg.company_id, ac.id, type.category, m.hours, leg.dep_at);
  run(db, 'UPDATE aircraft SET location = ? WHERE id = ?', dest, ac.id);
  run(db, `UPDATE scheduled_flights SET status = 'done', origin = ?, dest = ?, delay_min = ?, delay_cause = ?, pax = ?, revenue = ?, fuel_cost = ?, landing_fee = ?, maintenance = ? WHERE id = ?`,
    origin, dest, delay, delayCause, m.pax, m.revenue, m.fuel, m.fee, m.maintenance, leg.id);
  r.touched.set(leg.company_id, leg.dep_at);
}

/** Post the aggregated money of the old ticks: one ledger line per line, day and kind, e.g. `LFLL-LFMN 2026-11-04 x8`. */
function flushBooks(db: Db, r: Run): void {
  for (const b of [...r.books.values()].sort((x, y) => x.at - y.at || x.kind.localeCompare(y.kind))) post(db, b.companyId, b.at, b.kind, b.amount, `${b.pair} ${b.day} x${b.legs}`);
  r.books.clear();
}

/** Derived line state: a line with no usable aircraft for the next 24 h is `interrupted` (and costs reputation, idempotently), else `active`. */
function refreshLines(db: Db, ts: number, live: Map<number, boolean>): void {
  for (const l of all<LineRow>(db, "SELECT * FROM lines WHERE status IN ('active','interrupted')")) if (live.get(l.company_id)) refreshRow(db, l, ts);
}

export function refreshLine(db: Db, lineId: number, ts: number): void {
  const l = get<LineRow>(db, "SELECT * FROM lines WHERE id = ? AND status IN ('active','interrupted')", lineId);
  if (l) refreshRow(db, l, ts);
}

function refreshRow(db: Db, l: LineRow, ts: number): void {
  const fleet = lineAircraft(db, l.id).filter((x) => x.returned_at === null);
  const aircraftOk = fleet.some((x) => (x.location === l.a || x.location === l.b) && !(x.status === 'maintenance' && (x.maintenance_until ?? 0) > ts + DAY_MS));
  // a crew exists when SOME aircraft type of the line has a flight deck and a cabin crew employed at one end of it (duty limits and leave pass, a missing person does not)
  const crewOk = fleet.length === 0 || [...new Set(fleet.map((x) => x.icao))].some((icao) => crewShortage(db, l.company_id, [icao], [l.a, l.b], ts).length === 0);
  if (aircraftOk && crewOk) {
    if (l.status === 'interrupted') run(db, "UPDATE lines SET status = 'active', interrupted_since = NULL, interrupt_cause = NULL, stoppage_charged = 0 WHERE id = ?", l.id);
    return;
  }
  const cause: LineInterruptCause = !aircraftOk && !crewOk ? 'both' : !aircraftOk ? 'aircraft' : 'crew';
  const since = l.interrupted_since ?? ts;
  if (l.status === 'active') run(db, "UPDATE lines SET status = 'interrupted', interrupted_since = ?, interrupt_cause = ? WHERE id = ?", since, cause, l.id);
  else if (l.interrupt_cause !== cause) run(db, 'UPDATE lines SET interrupt_cause = ? WHERE id = ?', cause, l.id);
  // A new line still waiting for its crew has let nobody down yet: crew-only stoppages cost reputation once the line has flown.
  const due = cause === 'crew' && !get(db, "SELECT 1 AS x FROM scheduled_flights WHERE line_id = ? AND status = 'done' LIMIT 1", l.id) ? 0 : stoppageReputationTotal(since, ts);
  if (due > l.stoppage_charged) {
    run(db, 'UPDATE companies SET reputation = MAX(0, reputation - ?) WHERE id = ?', due - l.stoppage_charged, l.company_id);
    run(db, 'UPDATE lines SET stoppage_charged = ? WHERE id = ?', due, l.id);
  }
}

// ---------------------------------------------------------------- views

export function lineView(db: Db, l: LineRow): Line {
  const fleet = lineAircraft(db, l.id);
  const dist = lineDistance(l.a, l.b);
  const blocks = fleet.map((x) => blockMinutes(typeFor(db, l.company_id, x.icao), dist));
  return {
    id: l.id, a: l.a, b: l.b, status: l.status, distanceNm: dist, blockMinutes: blocks.length > 0 ? Math.max(...blocks) : 0, freqPerDay: l.freq_per_day, days: maskToDays(l.days),
    windowStart: minToHhmm(l.window_start_min), windowEnd: minToHhmm(l.window_end_min), turnaroundMin: l.turnaround_min,
    flightNos: [l.flight_base, l.flight_base + 2 * l.freq_per_day - 1],
    aircraft: fleet.map((x) => ({ id: x.id, registration: x.registration ?? `#${x.id}`, icao: x.icao })),
    interruptedSince: l.interrupted_since, interruptCause: l.interrupt_cause,
  };
}

/** The status a client shows: `flying` and `delayed` are read off the clock, never stored. */
export function legStatus(l: LegRow, now: number): ScheduledFlightStatus {
  if (l.status !== 'done') return l.status;
  const shift = l.delay_min * 60_000;
  return now < l.dep_at + shift ? 'delayed' : now < l.arr_at + shift ? 'flying' : 'done';
}

export const legView = (l: LegRow, code: string, now: number): ScheduledFlight => ({
  id: l.id, lineId: l.line_id, flightNo: `${code} ${l.flight_no}`, dep: l.dep_at, arr: l.arr_at, origin: l.origin, dest: l.dest, aircraftId: l.aircraft_id,
  status: legStatus(l, now), delayMin: l.delay_min, delayCause: l.delay_cause, cancelCause: l.cancel_cause, pax: l.pax, takenByPlayer: l.taken_job !== null,
});

