// Lot LINES (v3): what the player does to her lines. Validation lives in ONE function (`programmeProblems`), shared by the forecast
// (which reports every problem) and by create/patch (which throw the first). Domain operations: callers wrap them in `tx`.
import { randomUUID } from 'node:crypto';
import {
  DAY_MS, DEFAULT_TURNAROUND_MIN, FIRST_FLIGHT_NO, FLIGHT_NO_BLOCK, MAX_LINES_PER_COMPANY, PAX_KG, PAUSED_LINE_COST_PER_DAY, daysToMask, dayStart, hhmmToMin, jobPayout,
  SIZE_WEIGHT, layoutDay, minToHhmm, overlappingLegs, programmeProblem, weeklyDemand, weeklySeats,
  type Job, type LineBody, type LineForecastView, type LineProblemView, type LineResolve, type PlannedLeg,
} from '@opc/shared';
import { airportList, airports } from './catalog.ts';
import { all, get, run, type Db } from './db.ts';
import { LINE_JOB_PREFIX, hasHub, jobView, typeFor, type AircraftRow } from './game.ts';
import { lineLimit } from './facilities.ts';
import { HttpError } from './http.ts';
import { countOf, demandOf } from './staff-needs.ts';
import { interimForLine, interimOffer, lineShortage, recruitForLine, recruitOffer, startNowForLine, startNowOffer } from './staff-people.ts';
import { crewHeadcount, pendingStart, rulesOf } from './staff.ts';
import {
  blockMinutes, companyCode, ensureNetwork, layLine, legMoney, lineAircraft, lineDistance, loadFactorOf, networkOf, planned, programmeOf, refreshLine, relayLine, rivalSeats, seatsOf, sizeOf,
  type LegRow, type LineAircraftRow, type LineRow,
} from './lines.ts';

// ---------------------------------------------------------------- lookups

export function ownedLine(db: Db, companyId: number, id: number): LineRow {
  const l = get<LineRow>(db, 'SELECT * FROM lines WHERE id = ? AND company_id = ?', id, companyId);
  if (!l) throw new HttpError(404, 'line_not_found', 'line not found');
  return l;
}

const liveAircraft = (db: Db, companyId: number, ids: readonly number[]): AircraftRow[] =>
  ids.map((id) => get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ? AND company_id = ? AND returned_at IS NULL', id, companyId)).filter((a): a is AircraftRow => !!a);

// ---------------------------------------------------------------- validation

export type Problem = { code: string; status: number; message: string };
type Candidate = { a: string; b: string; programme: LineBody; excludeLineId: number };

/** The reference week used to compare timetables: 8 days from a Monday, so a Sunday rotation that spills past midnight meets Monday's. */
const REF_MONDAY = Date.UTC(2026, 0, 5);

/** Every reason the programme cannot be flown now, in order of importance. Pure reading: creates nothing. */
export function programmeProblems(db: Db, companyId: number, c: Candidate): { problems: Problem[]; conflicts: { aircraftId: number; flightNo: number; at: number }[] } {
  const problems: Problem[] = [];
  const add = (code: string, status: number, message: string) => problems.push({ code, status, message });
  const conflicts: { aircraftId: number; flightNo: number; at: number }[] = [];
  const { a, b, programme: p } = c;
  if (!airports.has(a) || !airports.has(b)) { add('unknown_airport', 422, `airport ${airports.has(a) ? b : a} is not in the airport database`); return { problems, conflicts }; }
  if (a === b) { add('same_airport', 422, 'a line joins two different airports'); return { problems, conflicts }; }
  const bad = programmeProblem(p);
  if (bad) { add('invalid_request', 400, bad); return { problems, conflicts }; }
  const fleet = liveAircraft(db, companyId, p.aircraftIds);
  if (fleet.length !== p.aircraftIds.length) add('aircraft_not_found', 404, 'one of the aircraft is not in your fleet');
  if (!hasHub(db, companyId, a) && !hasHub(db, companyId, b) && !get(db, 'SELECT 1 AS x FROM aircraft WHERE company_id = ? AND returned_at IS NULL AND base IN (?, ?)', companyId, a, b)) {
    add('hub_missing', 409, `neither ${a} nor ${b} is a hub or base of your company`);
  }
  const dist = lineDistance(a, b);
  for (const ac of fleet) {
    const type = typeFor(db, companyId, ac.icao);
    if (dist > type.rangeNm) add('distance_exceeds_range', 422, `${ac.registration ?? ac.icao}: ${dist} nm exceeds the ${type.rangeNm} nm range of ${ac.icao}`);
    if (ac.location !== a && ac.location !== b) add('aircraft_elsewhere', 409, `${ac.registration ?? ac.icao} is at ${ac.location}, not at ${a} or ${b}`);
  }
  const dup = get<{ id: number }>(db, 'SELECT id FROM lines WHERE company_id = ? AND a = ? AND b = ? AND id != ?', companyId, a, b, c.excludeLineId);
  if (dup) add('duplicate_line', 409, `you already fly ${a}-${b}`);
  const limit = lineLimit(db, companyId);
  if (!c.excludeLineId && get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM lines WHERE company_id = ?', companyId)!.n >= limit) {
    add('line_limit', 409, `at most ${limit} lines${limit === MAX_LINES_PER_COMPANY ? ' until you rent an operations centre' : ''}`);
  }
  if (fleet.length === p.aircraftIds.length) {
    const prog = { a, b, flightBase: 0, freqPerDay: p.freqPerDay, days: daysToMask(p.days), windowStartMin: hhmmToMin(p.windowStart), windowEndMin: hhmmToMin(p.windowEnd), turnaroundMin: p.turnaroundMin ?? DEFAULT_TURNAROUND_MIN };
    const mine = [...fleet].sort((x, y) => x.id - y.id);
    const homes = mine.map((x) => ({ id: x.id, blockMin: blockMinutes(typeFor(db, companyId, x.icao), dist), home: x.location === b ? b : a }));
    const legs: (PlannedLeg & { own: boolean })[] = [];
    for (let d = 0; d < 8; d++) for (const l of layoutDay(prog, homes, REF_MONDAY + d * DAY_MS)) legs.push({ ...l, own: true });
    // the company's other lines that share an aircraft with this programme
    for (const other of all<LineRow>(db, 'SELECT * FROM lines WHERE company_id = ? AND id != ?', companyId, c.excludeLineId)) {
      const shared = lineAircraft(db, other.id).filter((x) => p.aircraftIds.includes(x.id));
      if (shared.length === 0) continue;
      const fl = planned(db, other, shared);
      for (let d = 0; d < 8; d++) for (const l of layoutDay(programmeOf(other), fl, REF_MONDAY + d * DAY_MS)) legs.push({ ...l, own: false });
    }
    const seen = new Set<string>();
    for (const [x, y] of overlappingLegs(legs, prog.turnaroundMin)) {
      if (!x.own && !y.own) continue;
      const mineLeg = y.own ? y : x;
      const key = `${mineLeg.aircraftId}:${mineLeg.flightNo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({ aircraftId: mineLeg.aircraftId, flightNo: mineLeg.flightNo, at: mineLeg.dep });
    }
    if (conflicts.length > 0) add('aircraft_busy', 409, `${conflicts.length} flight(s) overlap on the same aircraft: add aircraft or space the departures`);
  }
  return { problems, conflicts };
}

const throwFirst = (problems: Problem[]): void => {
  const p = problems[0];
  if (p) throw new HttpError(p.status, p.code, p.message);
};

// ---------------------------------------------------------------- forecast

/** One week of the programme from `now`, valued leg by leg with the same maths the engine uses. Creates nothing. */
export function forecast(db: Db, companyId: number, b: LineBody, now: number, excludeLineId = 0): LineForecastView {
  const [a, z] = [b.a, b.b].sort() as [string, string];
  const { problems, conflicts } = programmeProblems(db, companyId, { a, b: z, programme: b, excludeLineId });
  const fleet = liveAircraft(db, companyId, b.aircraftIds).sort((x, y) => x.id - y.id);
  const days = daysToMask(b.days);
  const dist = airports.has(a) && airports.has(z) && a !== z ? lineDistance(a, z) : 0;
  const types = fleet.map((x) => typeFor(db, companyId, x.icao));
  const demand = dist > 0 ? weeklyDemand(sizeOf(a), sizeOf(z), dist) : 0;
  const rival = dist > 0 ? rivalSeats(db, companyId, a, z) : { seats: 0, best: null };
  const lf = dist > 0 && fleet.length > 0 ? loadFactorOf(db, { companyId, a, b: z, freqPerDay: b.freqPerDay, days, fleet }) : 0;
  const seatsPerWeek = weeklySeats(b.freqPerDay, days, types.map((t) => t.seats));
  let revenue = 0, costs = 0;
  if (dist > 0 && fleet.length === b.aircraftIds.length && fleet.length > 0) {
    const prog = { a, b: z, flightBase: 0, freqPerDay: b.freqPerDay, days, windowStartMin: hhmmToMin(b.windowStart), windowEndMin: hhmmToMin(b.windowEnd), turnaroundMin: b.turnaroundMin ?? DEFAULT_TURNAROUND_MIN };
    const homes = fleet.map((x, i) => ({ id: x.id, blockMin: blockMinutes(types[i]!, dist), home: x.location === z ? z : a }));
    for (let d = 0; d < 7; d++) {
      for (const l of layoutDay(prog, homes, dayStart(now) + d * DAY_MS)) {
        const idx = fleet.findIndex((x) => x.id === l.aircraftId);
        const m = legMoney(db, companyId, l.aircraftId, types[idx]!, l, lf);
        revenue += m.revenue; costs += m.fuel + m.fee + m.maintenance;
      }
    }
  }
  // crews: what the programme needs under the duty rules and what the company employs at the two ends of the line (ground: at each end)
  const needs = crewNeeds(db, companyId, { a, z, b, fleet, types, days, dist }, now);
  return {
    forecast: {
      weeklyDemand: demand, loadFactor: lf, seatsPerWeek, revenue, costs, profit: revenue - costs, estimated: true,
      competition: rival.best ? { company: rival.best.company, flightsPerDay: rival.best.flightsPerDay } : null,
    },
    conflicts, problems: problems.map((x) => x.code),
    needs: { ...needs, maintenance: fleet.some((x) => x.wear_pct >= 70) ? 'wear' : 'ok' },
    crewModelled: true, valid: problems.length === 0,
  };
}

function crewNeeds(db: Db, companyId: number, c: { a: string; z: string; b: LineBody; fleet: AircraftRow[]; types: { icao: string }[]; days: number; dist: number }, now: number) {
  const empty = { pilots: { required: 0, available: 0 }, cabin: { required: 0, available: 0 }, ground: { required: 0, available: 0, missingAt: [] as string[] } };
  if (c.dist === 0 || c.fleet.length !== c.b.aircraftIds.length || c.fleet.length === 0) return empty;
  const prog = { a: c.a, b: c.z, flightBase: 0, freqPerDay: c.b.freqPerDay, days: c.days, windowStartMin: hhmmToMin(c.b.windowStart), windowEndMin: hhmmToMin(c.b.windowEnd), turnaroundMin: c.b.turnaroundMin ?? DEFAULT_TURNAROUND_MIN };
  const aircraft = c.fleet.map((x, i) => ({ id: x.id, icao: x.icao, blockMin: blockMinutes(typeFor(db, companyId, x.icao), c.dist), home: x.location === c.z ? c.z : c.a, i }));
  const slots = demandOf(db, companyId, [{ prog, aircraft }], rulesOf(db, companyId));
  const have = crewHeadcount(db, companyId, [c.a, c.z], c.types.map((t) => t.icao), now);
  const missingAt = [c.a, c.z].filter((icao) => (have.groundAt[icao] ?? 0) < 1);
  return {
    pilots: { required: countOf(slots, 'pilot'), available: have.pilots }, cabin: { required: countOf(slots, 'cabin'), available: have.cabin },
    ground: { required: countOf(slots, 'ground'), available: have.ground, missingAt },
  };
}

// ---------------------------------------------------------------- create, change, pause, delete

const nextFlightBase = (db: Db, companyId: number): number => {
  const used = new Set(all<{ flight_base: number }>(db, 'SELECT flight_base FROM lines WHERE company_id = ?', companyId).map((r) => r.flight_base));
  let base = FIRST_FLIGHT_NO;
  while (used.has(base)) base += FLIGHT_NO_BLOCK;
  return base;
};

const setAircraft = (db: Db, lineId: number, line: Pick<LineRow, 'a' | 'b'>, ids: readonly number[]): void => {
  const keep = new Map(all<{ aircraft_id: number; home: string }>(db, 'SELECT aircraft_id, home FROM line_aircraft WHERE line_id = ?', lineId).map((r) => [r.aircraft_id, r.home]));
  run(db, 'DELETE FROM line_aircraft WHERE line_id = ?', lineId);
  for (const id of [...ids].sort((x, y) => x - y)) {
    const loc = get<{ location: string }>(db, 'SELECT location FROM aircraft WHERE id = ?', id)!.location;
    run(db, 'INSERT INTO line_aircraft (line_id, aircraft_id, home) VALUES (?, ?, ?)', lineId, id, keep.get(id) ?? (loc === line.b ? line.b : line.a));
  }
};

export function createLine(db: Db, companyId: number, b: LineBody, now: number): LineRow {
  const [a, z] = [b.a, b.b].sort() as [string, string];
  throwFirst(programmeProblems(db, companyId, { a, b: z, programme: b, excludeLineId: 0 }).problems);
  ensureNetwork(db, companyId, now);
  const id = run(db, `INSERT INTO lines (company_id, a, b, created_at, freq_per_day, days, window_start_min, window_end_min, turnaround_min, flight_base, live_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`, companyId, a, z, now, b.freqPerDay, daysToMask(b.days), hhmmToMin(b.windowStart), hhmmToMin(b.windowEnd), b.turnaroundMin ?? DEFAULT_TURNAROUND_MIN, nextFlightBase(db, companyId)).id;
  setAircraft(db, id, { a, b: z }, b.aircraftIds);
  relayLine(db, id, now);
  refreshLine(db, id, now);
  return get<LineRow>(db, 'SELECT * FROM lines WHERE id = ?', id)!;
}

type ProgrammePatch = Partial<Omit<LineBody, 'a' | 'b'>>;

/** The programme the line would have once `patch` is applied: every field the patch leaves out keeps the line's own. */
const mergedProgramme = (db: Db, l: LineRow, patch: ProgrammePatch): LineBody => ({
  a: l.a, b: l.b, freqPerDay: patch.freqPerDay ?? l.freq_per_day, days: patch.days ?? maskDays(l.days),
  windowStart: patch.windowStart ?? minToHhmm(l.window_start_min), windowEnd: patch.windowEnd ?? minToHhmm(l.window_end_min),
  turnaroundMin: patch.turnaroundMin ?? l.turnaround_min, aircraftIds: patch.aircraftIds ?? lineAircraft(db, l.id).map((x) => x.id),
});

/** The forecast of an existing line under `patch`: what `patchLine` would be judged by, the line itself left out of its own conflicts. Creates nothing. */
export function forecastPatch(db: Db, companyId: number, id: number, patch: ProgrammePatch, now: number): LineForecastView {
  return forecast(db, companyId, mergedProgramme(db, ownedLine(db, companyId, id), patch), now, id);
}

/** Change a line's programme. The legs that have not departed are dropped and laid again from the new programme at the next tick (`relayLine`); legs already flown, cancelled or taken
 *  by the player, and the one in the air (resolved at its departure), are history and stay as they are. */
export function patchLine(db: Db, companyId: number, id: number, patch: ProgrammePatch, now: number): LineRow {
  const l = ownedLine(db, companyId, id);
  const merged = mergedProgramme(db, l, patch);
  throwFirst(programmeProblems(db, companyId, { a: l.a, b: l.b, programme: merged, excludeLineId: id }).problems);
  run(db, 'UPDATE lines SET freq_per_day = ?, days = ?, window_start_min = ?, window_end_min = ?, turnaround_min = ? WHERE id = ?',
    merged.freqPerDay, daysToMask(merged.days), hhmmToMin(merged.windowStart), hhmmToMin(merged.windowEnd), merged.turnaroundMin ?? DEFAULT_TURNAROUND_MIN, id);
  if (patch.aircraftIds) setAircraft(db, id, l, patch.aircraftIds);
  relayLine(db, id, now);
  refreshLine(db, id, now);
  return get<LineRow>(db, 'SELECT * FROM lines WHERE id = ?', id)!;
}
const maskDays = (mask: number): boolean[] => Array.from({ length: 7 }, (_, i) => (mask & (1 << i)) !== 0);

/** Pause: no more legs are laid and the ones that have not run are dropped; the aircraft keep their monthly costs (decision C2, no daily fee). Resume re-lays from the next tick. */
export function setPaused(db: Db, companyId: number, id: number, paused: boolean, now: number): LineRow {
  const l = ownedLine(db, companyId, id);
  if (paused && l.status === 'paused') throw new HttpError(409, 'already_paused', 'the line is already paused');
  if (!paused && l.status !== 'paused') throw new HttpError(409, 'not_paused', 'the line is not paused');
  if (paused) {
    run(db, "UPDATE lines SET status = 'paused', paused_at = ?, interrupted_since = NULL, interrupt_cause = NULL, stoppage_charged = 0 WHERE id = ?", now, id);
    run(db, "DELETE FROM scheduled_flights WHERE line_id = ? AND status = 'scheduled'", id);
  } else {
    run(db, "UPDATE lines SET status = 'active', paused_at = NULL WHERE id = ?", id);
    relayLine(db, id, now);
    refreshLine(db, id, now);
  }
  return get<LineRow>(db, 'SELECT * FROM lines WHERE id = ?', id)!;
}

export function deleteLine(db: Db, companyId: number, id: number): void {
  ownedLine(db, companyId, id);
  run(db, 'DELETE FROM lines WHERE id = ?', id);
}

/** C3: off means no legs are generated, nothing is paid, no revenue; unflown legs are dropped. On re-lays every line from the next tick. */
export function setEnabled(db: Db, companyId: number, enabled: boolean, now: number): void {
  const n = ensureNetwork(db, companyId, now);
  if ((n.enabled === 1) === enabled) return;
  run(db, 'UPDATE line_networks SET enabled = ? WHERE company_id = ?', enabled ? 1 : 0, companyId);
  if (!enabled) run(db, "DELETE FROM scheduled_flights WHERE company_id = ? AND status = 'scheduled'", companyId);
  else for (const l of all<{ id: number }>(db, "SELECT id FROM lines WHERE company_id = ? AND status != 'paused'", companyId)) relayLine(db, l.id, now);
}

// ---------------------------------------------------------------- stoppage: problem and remedies

/** Aircraft the company could assign to `lineId`: available now (or back within a day), at one end of the line, and not already on it. */
const freeFor = (db: Db, l: LineRow, now: number) => {
  const onLine = new Set(lineAircraft(db, l.id).map((x) => x.id));
  return all<AircraftRow>(db, 'SELECT * FROM aircraft WHERE company_id = ? AND returned_at IS NULL AND location IN (?, ?) ORDER BY id', l.company_id, l.a, l.b)
    .filter((x) => !onLine.has(x.id) && !get(db, "SELECT 1 AS x FROM flights WHERE aircraft_id = ? AND status = 'active'", x.id))
    .filter((x) => x.status === 'available' || (x.maintenance_until ?? Infinity) <= now + DAY_MS)
    .map((x) => ({ id: x.id, registration: x.registration ?? `#${x.id}`, icao: x.icao, freeAt: x.status === 'available' ? now : x.maintenance_until! }));
};

/** Expected revenue of one operating day of the line with the aircraft it has (or `fleet`), by the engine's own maths. */
export function expectedPerDay(db: Db, l: LineRow, fleet: LineAircraftRow[], now: number): { revenue: number; margin: number; load: number; fuel: number } {
  const live = fleet.filter((x) => x.returned_at === null);
  const lf = loadFactorOf(db, { companyId: l.company_id, a: l.a, b: l.b, freqPerDay: l.freq_per_day, days: l.days, fleet: live, excludeLineId: l.id });
  const homes = planned(db, l, live);
  let revenue = 0, cost = 0, fuel = 0;
  const day = nextOperatingDay(l, now);
  for (const leg of layoutDay(programmeOf(l), homes, day)) {
    const ac = live.find((x) => x.id === leg.aircraftId)!;
    const m = legMoney(db, l.company_id, ac.id, typeFor(db, l.company_id, ac.icao), leg, lf);
    revenue += m.revenue; cost += m.fuel + m.fee + m.maintenance; fuel += m.fuel;
  }
  return { revenue, margin: revenue - cost, load: lf, fuel };
}
/** What the line loses each day it does not fly: one operating day of it with the aircraft it has (the figure of `problem.cost.perDay`, and what the recruiter agency prices a stoppage by). */
export function stoppageCostPerDay(db: Db, l: LineRow, now: number): number {
  const fleet = lineAircraft(db, l.id).filter((x) => x.returned_at === null);
  return expectedPerDay(db, l, fleet.length > 0 ? fleet : lineAircraft(db, l.id), now).revenue;
}
const nextOperatingDay = (l: LineRow, now: number): number => {
  let d = dayStart(now);
  for (let i = 0; i < 7 && (l.days & (1 << ((new Date(d).getUTCDay() + 6) % 7))) === 0; i++) d += DAY_MS;
  return d;
};

export function problemView(db: Db, l: LineRow, now: number): LineProblemView {
  const fleet = lineAircraft(db, l.id).filter((x) => x.returned_at === null);
  const aircraftProblems = fleet.filter((x) => x.status === 'maintenance' || (x.location !== l.a && x.location !== l.b)).map((x) => ({
    kind: 'aircraft' as const, ready: false, until: x.status === 'maintenance' ? x.maintenance_until : null,
    detail: x.status === 'maintenance' ? `${x.registration} maintenance` : `${x.registration} at ${x.location}`,
  }));
  const short = lineShortage(db, l, now);
  const crewProblems = short.map((x) => ({
    kind: 'crew' as const, ready: false, until: pendingStart(db, l.company_id, x.family, x.type, [l.a, l.b], now),
    detail: `${x.family === 'pilot' ? `${x.type} pilots` : 'cabin crew'} ${x.have}/${x.need}`,
  }));
  const problem = [...aircraftProblems, ...crewProblems];
  const since = l.interrupted_since ?? now;
  const cancelled = all<LegRow>(db, "SELECT * FROM scheduled_flights WHERE line_id = ? AND status = 'cancelled' AND taken_job IS NULL AND dep_at >= ?", l.id, since);
  const lf = loadFactorOf(db, { companyId: l.company_id, a: l.a, b: l.b, freqPerDay: l.freq_per_day, days: l.days, fleet, excludeLineId: l.id });
  const lost = cancelled.reduce((s, leg) => {
    const ac = get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ?', leg.aircraft_id);
    return s + (ac ? legMoney(db, l.company_id, ac.id, typeFor(db, l.company_id, ac.icao), { origin: leg.origin, dest: leg.dest, dep: leg.dep_at }, lf).revenue : 0);
  }, 0);
  const perDay = stoppageCostPerDay(db, l, now);
  const free = freeFor(db, l, now);
  const projection = Array.from({ length: 7 }, (_, i) => {
    const d = dayStart(now) + i * DAY_MS;
    const running = (l.days & (1 << ((new Date(d).getUTCDay() + 6) % 7))) !== 0;
    const ok = fleet.some((x) => x.status === 'available' || (x.maintenance_until ?? Infinity) < d + DAY_MS);
    return { date: new Date(d).toISOString().slice(0, 10), status: !running ? 'off' as const : ok ? 'assured' as const : 'stopped' as const };
  });
  return {
    problem,
    cost: { cancelled: cancelled.length, lostRevenue: lost, perDay, reputation: -l.stoppage_charged, slotsLostAt: l.interrupted_since === null ? null : l.interrupted_since + 14 * DAY_MS },
    options: {
      reassign: free.length > 0 ? { aircraft: free, flightsPerDay: l.freq_per_day * 2, deltaPerDay: perDay } : null,
      recruit: short.length === 0 ? null : recruitOffer(db, l, short, now),
      interim: short.length === 0 ? null : interimOffer(db, l, short, now),
      startNow: short.length === 0 ? null : startNowOffer(db, l, short, now),
      pause: { fixedCostPerDay: PAUSED_LINE_COST_PER_DAY },
    },
    projection,
  };
}

/** The remedies that need crew (`recruit`, `interim`, `start_now`) end by deriving the line's status again, like every change to a line: nothing writes `active` by hand. */
export function resolveLine(db: Db, companyId: number, id: number, o: LineResolve, now: number): LineRow {
  const l = ownedLine(db, companyId, id);
  if (o.option === 'pause') return setPaused(db, companyId, id, true, now);
  if (o.option === 'recruit' || o.option === 'interim' || o.option === 'start_now') {
    if (o.option === 'recruit') {
      if (lineShortage(db, l, now).length === 0) throw new HttpError(409, 'nothing_to_recruit', 'the line has all the crew it needs');
      recruitForLine(db, l, now, o.withInterim ?? false);
    } else if (o.option === 'interim') interimForLine(db, l, now);
    else startNowForLine(db, l, now);
    refreshLine(db, id, now);
    return ownedLine(db, companyId, id);
  }
  if (o.aircraftId === undefined) throw new HttpError(400, 'invalid_request', 'aircraftId: required to reassign');
  if (!freeFor(db, l, now).some((x) => x.id === o.aircraftId)) throw new HttpError(409, 'aircraft_not_free', 'that aircraft cannot serve this line now');
  const ids = [...lineAircraft(db, id).map((x) => x.id), o.aircraftId];
  return patchLine(db, companyId, id, { aircraftIds: ids }, now);
}

// ---------------------------------------------------------------- take a rotation (the bridge to flown jobs, B.2 item 9)

/** The player flies this rotation herself: the autonomous leg is cancelled without penalty and becomes a private job (100 % of the job rate) that
 *  only this company sees until the leg would have landed. The job names the aircraft TYPE, so any aircraft of it at the origin can fly it. */
export function takeRotation(db: Db, companyId: number, lineId: number, legId: number, now: number): { job: Job; reservedUntil: number } {
  ownedLine(db, companyId, lineId);
  const leg = get<LegRow>(db, 'SELECT * FROM scheduled_flights WHERE id = ? AND line_id = ?', legId, lineId);
  if (!leg) throw new HttpError(404, 'flight_not_found', 'scheduled flight not found');
  if (leg.status !== 'scheduled') throw new HttpError(409, 'not_takeable', leg.taken_job ? 'you already took this flight' : `this flight is already ${leg.status}`);
  const ac = get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE id = ?', leg.aircraft_id)!;
  const type = typeFor(db, companyId, ac.icao);
  const line = get<LineRow>(db, 'SELECT * FROM lines WHERE id = ?', lineId)!;
  const lf = loadFactorOf(db, { companyId, a: line.a, b: line.b, freqPerDay: line.freq_per_day, days: line.days, fleet: lineAircraft(db, lineId), excludeLineId: lineId });
  const pax = Math.min(type.seats, Math.round(type.seats * lf));
  const dist = lineDistance(leg.origin, leg.dest);
  const payout = jobPayout('pax', dist, pax * PAX_KG);
  const id = LINE_JOB_PREFIX + randomUUID();
  run(db, `INSERT INTO custom_jobs (id, company_id, created_at, kind, origin, destination, distance_nm, payload_kg, pax, payout, required_aircraft, source, expires_at)
    VALUES (?, ?, ?, 'pax', ?, ?, ?, ?, ?, ?, ?, 'line', ?)`, id, companyId, now, leg.origin, leg.dest, dist, pax * PAX_KG, pax, payout, ac.icao, leg.arr_at);
  run(db, "UPDATE scheduled_flights SET status = 'cancelled', cancel_cause = NULL, taken_job = ? WHERE id = ?", id, leg.id);
  return {
    job: jobView({ id, source: 'line', kind: 'pax', origin: leg.origin, destination: leg.dest, distance_nm: dist, payload_kg: pax * PAX_KG, pax, payout, required_aircraft: ac.icao, planned_fuel_kg: null, route: null }),
    reservedUntil: leg.arr_at,
  };
}

// ---------------------------------------------------------------- AI companies (B.2 item 10)

/** A bought aircraft with at least this many seats flies a line for its AI company; smaller ones keep taking board jobs (ai.ts). */
export const AI_LINE_MIN_SEATS = 9;
const AI_LINE_TARGET_NM = 250;

/** Give a newly bought AI aircraft a line out of its hub: the biggest airport that is 120 nm away and within 60 % of the aircraft's range, nearest to
 *  250 nm first. Three, then two, then one rotation a day, whichever has no overlap. No random numbers, so it replays identically. */
export function assignAiLine(db: Db, companyId: number, aircraft: AircraftRow, now: number): LineRow | null {
  const hub = airports.get(aircraft.location);
  const type = typeFor(db, companyId, aircraft.icao);
  if (!hub || type.seats < AI_LINE_MIN_SEATS) return null;
  const reach = type.rangeNm * 0.6;
  const options = airportList
    .filter((x) => x.icao !== hub.icao)
    .map((x) => ({ x, d: lineDistance(hub.icao, x.icao) }))
    .filter((c) => c.d >= 120 && c.d <= reach)
    .sort((p, q) => SIZE_WEIGHT[q.x.size] - SIZE_WEIGHT[p.x.size] || Math.abs(p.d - AI_LINE_TARGET_NM) - Math.abs(q.d - AI_LINE_TARGET_NM) || p.x.icao.localeCompare(q.x.icao))
    .slice(0, 5);
  for (const { x } of options) {
    const [a, b] = [hub.icao, x.icao].sort() as [string, string];
    for (const freqPerDay of [3, 2, 1]) {
      const body: LineBody = { a, b, freqPerDay, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [aircraft.id] };
      if (programmeProblems(db, companyId, { a, b, programme: body, excludeLineId: 0 }).problems.length === 0) return createLine(db, companyId, body, now);
    }
  }
  return null;
}

export { companyCode, networkOf, seatsOf, layLine };
