// Lot STAFF (v3): people and duty. Every person is a row (pools are views). The line engine calls `crewLeg` for each leg it resolves: it picks the crew
// under the duty rules of shared/staff.ts, books it in `staff_duty` (the ledger the 28-day and 12-month limits are sums over) or names why not.
// A leaf of the line modules (lines.ts imports it): it never imports lines.ts values.
import {
  DAY_MS, DUTY_RELEASE_MIN, DUTY_REPORT_MIN, MAX_CONSECUTIVE_DUTY_DAYS, REPOSITION_H, REST_POLICIES, continuesDuty, crewNeeded, dayNo, dutyIncrementMin, dutyViolation, fatigueOf,
  type CancelCause, type DutyInput, type RestPolicy, type RestPolicyRules, type StaffFamily, type StaffRole, type StaffState,
} from '@opc/shared';
import { all, get, run, type Db } from './db.ts';
import { isHuman } from './fleet-extras.ts';
import { typeFor } from './game.ts';

export type StaffRow = {
  id: number; company_id: number; family: StaffFamily; name: string; role: StaffRole; base: string; hired_at: number; starts_at: number; ends_at: number | null;
  salary: number; experience: number; reliability: number; morale: number; contract: 'cdi' | 'cdd'; notice_days: number; candidate_id: string | null;
};

export const policyOf = (db: Db, companyId: number): RestPolicy => get<{ policy: RestPolicy }>(db, 'SELECT policy FROM staff_company WHERE company_id = ?', companyId)?.policy ?? 'standard';
export const rulesOf = (db: Db, companyId: number): RestPolicyRules => REST_POLICIES[policyOf(db, companyId)];

/** On the payroll at instant `at` (hired people who have not started yet are not). */
export const isEmployed = (s: Pick<StaffRow, 'starts_at' | 'ends_at'>, at: number): boolean => s.starts_at <= at && (s.ends_at === null || s.ends_at > at);
/** Everyone who is employed or will be (a hire in notice), not yet let go. */
export const rosterOf = (db: Db, companyId: number, now: number): StaffRow[] =>
  all<StaffRow>(db, 'SELECT * FROM staff WHERE company_id = ? AND (ends_at IS NULL OR ends_at > ?) ORDER BY id', companyId, now);

// ---------------------------------------------------------------- the duty ledger

/** The duty facts about one person at instant `at`, all read from the ledger (`dep_at <= at`: later bookings never matter). */
export function dutyInput(db: Db, s: Pick<StaffRow, 'id' | 'base'>, at: number): DutyInput {
  const last = get<{ arr_at: number; dest: string; duty_start: number }>(db, 'SELECT arr_at, dest, duty_start FROM staff_duty WHERE staff_id = ? AND dep_at <= ? ORDER BY dep_at DESC, arr_at DESC LIMIT 1', s.id, at);
  const w = get<{ f28: number | null; f12: number | null; d7: number | null }>(db,
    `SELECT SUM(CASE WHEN dep_at > ? THEN flight_min END) AS f28, SUM(flight_min) AS f12, SUM(CASE WHEN dep_at > ? THEN duty_min END) AS d7
     FROM staff_duty WHERE staff_id = ? AND dep_at > ? AND dep_at <= ?`, at - 28 * DAY_MS, at - 7 * DAY_MS, s.id, at - 365 * DAY_MS, at)!;
  const today = dayNo(at);
  const days = new Set(all<{ day: number }>(db, 'SELECT DISTINCT day FROM staff_duty WHERE staff_id = ? AND day >= ? AND day <= ?', s.id, today - MAX_CONSECUTIVE_DUTY_DAYS, today).map((r) => r.day));
  let streak = 0;
  while (streak < MAX_CONSECUTIVE_DUTY_DAYS && days.has(today - 1 - streak)) streak++;
  return {
    base: s.base, dutyStart: last?.duty_start ?? null, lastEnd: last?.arr_at ?? null, lastAt: last?.dest ?? null,
    flight28Min: w.f28 ?? 0, flight12Min: w.f12 ?? 0, duty7Min: w.d7 ?? 0, streakDays: streak, dutyToday: days.has(today),
  };
}

/** Where the person is at `at`: where they last landed, or home once they have been idle for REPOSITION_H. */
export const positionOf = (s: Pick<StaffRow, 'base'>, i: DutyInput, at: number): string =>
  i.lastEnd !== null && at - i.lastEnd < REPOSITION_H * 3_600_000 ? i.lastAt! : s.base;

// ---------------------------------------------------------------- availability

const qualifiedSql = `AND EXISTS (SELECT 1 FROM staff_quals q WHERE q.staff_id = s.id AND q.type_icao = ? AND q.valid_from <= ? AND (q.valid_until IS NULL OR q.valid_until > ?))`;

/** Employed at `dep`, rated on `qual` (pilots), and not on granted leave, rest or training on a day the leg touches. */
function availablePeople(db: Db, companyId: number, family: StaffFamily, dep: number, arr: number, qual: string | null): StaffRow[] {
  return all<StaffRow>(db, `SELECT s.* FROM staff s WHERE s.company_id = ? AND s.family = ? AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?)
    ${qual ? qualifiedSql : ''}
    AND NOT EXISTS (SELECT 1 FROM staff_leave l WHERE l.staff_id = s.id AND l.status = 'granted' AND l.from_day <= ? AND l.to_day >= ?) ORDER BY s.id`,
  companyId, family, dep, dep, ...(qual ? [qual, dep, dep] : []), dayNo(arr), dayNo(dep));
}

export type LegCtx = { id: number; companyId: number; flightNo: number; dep: number; arr: number; origin: string; dest: string; icao: string };
type Crewed = { s: StaffRow; i: DutyInput };
export type CrewCause = Extract<CancelCause, 'no_crew' | 'duty_limit'>;
export type CrewPlan = { ok: true; picks: Crewed[] } | { ok: false; cause: CrewCause; family: 'pilot' | 'cabin' };

/** `count` people of `family` for the leg: employed, rated, at the origin and legal. People already in a duty period come first (a crew stays together), then the least loaded. */
function choose(db: Db, leg: LegCtx, family: 'pilot' | 'cabin', count: number, qual: string | null, rules: RestPolicyRules): CrewPlan {
  if (count === 0) return { ok: true, picks: [] };
  const here = availablePeople(db, leg.companyId, family, leg.dep, leg.arr, qual)
    .map((s) => ({ s, i: dutyInput(db, s, leg.dep) })).filter((p) => positionOf(p.s, p.i, leg.dep) === leg.origin);
  const legal = here.filter((p) => dutyViolation(p.i, leg, rules) === null);
  if (legal.length < count) return { ok: false, cause: here.length >= count ? 'duty_limit' : 'no_crew', family };
  legal.sort((x, y) => Number(!continuesDuty(x.i, leg.dep)) - Number(!continuesDuty(y.i, leg.dep)) || x.i.duty7Min - y.i.duty7Min || x.s.id - y.s.id);
  return { ok: true, picks: legal.slice(0, count) };
}

/** The crew a leg would get, without booking it. Pilots first: the cause names the first family that falls short. */
export function planCrew(db: Db, leg: LegCtx): CrewPlan {
  const need = crewNeeded(typeFor(db, leg.companyId, leg.icao).seats);
  const rules = rulesOf(db, leg.companyId);
  const pilots = choose(db, leg, 'pilot', need.pilots, leg.icao, rules);
  if (!pilots.ok) return pilots;
  const cabin = choose(db, leg, 'cabin', need.cabin, null, rules);
  return cabin.ok ? { ok: true, picks: [...pilots.picks, ...cabin.picks] } : cabin;
}

function book(db: Db, leg: LegCtx, picks: readonly Crewed[]): void {
  for (const { s, i } of picks) {
    const start = continuesDuty(i, leg.dep) ? i.dutyStart! : leg.dep - DUTY_REPORT_MIN * 60_000;
    run(db, `INSERT INTO staff_duty (staff_id, leg_id, day, flight_no, dep_at, arr_at, origin, dest, duty_start, duty_min, flight_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      s.id, leg.id, dayNo(leg.dep), leg.flightNo, leg.dep, leg.arr, leg.origin, leg.dest, start, dutyIncrementMin(i, leg), (leg.arr - leg.dep) / 60_000);
  }
}

/** The line engine's crew check (replaces the S1 stub): null when the leg has its crew, booked in the ledger; else why it cannot fly.
 *  AI companies have no staff model: their legs always have a crew. Called once per leg inside the tick's transaction. */
export function crewLeg(db: Db, leg: LegCtx): { cause: CrewCause; family: 'pilot' | 'cabin' } | null {
  if (!isHuman(db, leg.companyId)) return null;
  const plan = planCrew(db, leg);
  if (!plan.ok) return { cause: plan.cause, family: plan.family };
  book(db, leg, plan.picks);
  return null;
}

// ---------------------------------------------------------------- headcount shortage (what interrupts a line)

export type Shortage = { family: 'pilot' | 'cabin'; type: string | null; have: number; need: number };

/** What a line lacks to fly even one leg at `ts`: for each aircraft type, a full flight deck rated on it and a cabin crew, employed and based at one end of the line.
 *  Duty limits and leave do not count: they pass, a missing person does not. Empty for AI companies. */
export function crewShortage(db: Db, companyId: number, icaos: readonly string[], ends: readonly [string, string], ts: number): Shortage[] {
  if (!isHuman(db, companyId)) return [];
  const out: Shortage[] = [];
  const count = (family: StaffFamily, qual: string | null): number =>
    get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff s WHERE s.company_id = ? AND s.family = ? AND s.base IN (?, ?) AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?) ${qual ? qualifiedSql : ''}`,
      companyId, family, ends[0], ends[1], ts, ts, ...(qual ? [qual, ts, ts] : []))!.n;
  let cabin = 0;
  for (const icao of new Set(icaos)) {
    const need = crewNeeded(typeFor(db, companyId, icao).seats);
    const have = count('pilot', icao);
    if (have < need.pilots) out.push({ family: 'pilot', type: icao, have, need: need.pilots });
    cabin = Math.max(cabin, need.cabin);
  }
  if (cabin > 0 && count('cabin', null) < cabin) out.push({ family: 'cabin', type: null, have: count('cabin', null), need: cabin });
  return out;
}

/** People employed now at the two ends of a line: pilots rated on any of its aircraft types, cabin crew, ground agents (in total and per airport). Used by the forecast. */
export function crewHeadcount(db: Db, companyId: number, ends: readonly [string, string], icaos: readonly string[], ts: number): { pilots: number; cabin: number; ground: number; groundAt: Record<string, number> } {
  const people = (family: StaffFamily, airport?: string): number => get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff s WHERE s.company_id = ? AND s.family = ? AND s.base ${airport ? '= ?' : 'IN (?, ?)'}
    AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?)`, companyId, family, ...(airport ? [airport] : [ends[0], ends[1]]), ts, ts)!.n;
  const pilots = icaos.length === 0 ? 0 : get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff s WHERE s.company_id = ? AND s.family = 'pilot' AND s.base IN (?, ?) AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?)
    AND EXISTS (SELECT 1 FROM staff_quals q WHERE q.staff_id = s.id AND q.type_icao IN (${icaos.map(() => '?').join(',')}) AND q.valid_from <= ? AND (q.valid_until IS NULL OR q.valid_until > ?))`,
    companyId, ends[0], ends[1], ts, ts, ...icaos, ts, ts)!.n;
  return { pilots, cabin: people('cabin'), ground: people('ground'), groundAt: { [ends[0]]: people('ground', ends[0]), [ends[1]]: people('ground', ends[1]) } };
}

/** The hires in notice who would fill a position of `family` (rated on `type` for pilots) at either end of a line, soonest first. A hire cancelled during its notice is not one. */
export function pendingHires(db: Db, companyId: number, family: 'pilot' | 'cabin', type: string | null, ends: readonly [string, string], now: number): { id: number; starts_at: number }[] {
  return all<{ id: number; starts_at: number }>(db, `SELECT s.id, s.starts_at FROM staff s WHERE s.company_id = ? AND s.family = ? AND s.base IN (?, ?) AND s.starts_at > ? AND (s.ends_at IS NULL OR s.ends_at > s.starts_at)
    ${type ? 'AND EXISTS (SELECT 1 FROM staff_quals q WHERE q.staff_id = s.id AND q.type_icao = ?)' : ''} ORDER BY s.starts_at, s.id`, companyId, family, ends[0], ends[1], now, ...(type ? [type] : []));
}

/** When the next hire in notice who would fill a shortage of `family` (rated on `type` for pilots) starts, or null when nobody is coming. */
export const pendingStart = (db: Db, companyId: number, family: 'pilot' | 'cabin', type: string | null, ends: readonly [string, string], now: number): number | null =>
  pendingHires(db, companyId, family, type, ends, now)[0]?.starts_at ?? null;

// ---------------------------------------------------------------- one person's state now

/** Pending hire, training, leave, on duty (up to the release after the last landing), resting (until the rest is over) or free. */
export function stateOf(db: Db, s: StaffRow, now: number, rules: RestPolicyRules): StaffState {
  if (s.ends_at !== null && s.ends_at <= now) return 'left';
  if (s.starts_at > now) return 'pending';
  const today = dayNo(now);
  const leave = get<{ kind: string }>(db, "SELECT kind FROM staff_leave WHERE staff_id = ? AND status = 'granted' AND from_day <= ? AND to_day >= ? ORDER BY kind = 'training' DESC, kind = 'leave' DESC LIMIT 1", s.id, today, today);
  if (leave) return leave.kind === 'training' ? 'training' : leave.kind === 'rest' ? 'resting' : 'leave';
  const last = get<{ arr_at: number; dest: string }>(db, 'SELECT arr_at, dest FROM staff_duty WHERE staff_id = ? AND dep_at <= ? ORDER BY dep_at DESC, arr_at DESC LIMIT 1', s.id, now);
  if (!last) return 'free';
  const released = last.arr_at + DUTY_RELEASE_MIN * 60_000;
  if (now < released) return 'onDuty';
  // rest runs from the release to the next report time (the same measure as shared dutyViolation)
  return now < released + (last.dest === s.base ? rules.restBaseH : rules.restAwayH) * 3_600_000 ? 'resting' : 'free';
}

// ---------------------------------------------------------------- facts about one person (fatigue, windows)

export type DutyFacts = { fatigue: number; flight28Min: number; flight12Min: number; duty7Min: number; dutyStart: number | null; lastEnd: number | null; lastAt: string | null };

/** B.3 fatigue and the windows of the limits, as of `now`. The streak is the run of duty days ending on the LAST duty day; every full day since it removes 12 points. */
export function dutyFacts(db: Db, s: StaffRow, now: number): DutyFacts {
  const i = dutyInput(db, s, now);
  const today = dayNo(now);
  const days = new Set(all<{ day: number }>(db, 'SELECT DISTINCT day FROM staff_duty WHERE staff_id = ? AND day > ? AND day <= ?', s.id, today - 8, today).map((r) => r.day));
  let lastDay = today;
  while (lastDay > today - 8 && !days.has(lastDay)) lastDay--;
  let streak = 0;
  while (days.has(lastDay - streak)) streak++;
  const fatigue = days.size === 0 ? 0 : fatigueOf({ duty7Min: i.duty7Min, streakDays: streak, restDays: Math.max(0, today - lastDay - 1) });
  return { fatigue, flight28Min: i.flight28Min, flight12Min: i.flight12Min, duty7Min: i.duty7Min, dutyStart: i.dutyStart, lastEnd: i.lastEnd, lastAt: i.lastAt };
}

// ---------------------------------------------------------------- what a flown leg cost in people

/** One duty row's share of its person's salary: that day's pay (a thirtieth of the month) in proportion to the flying the person did that day. Aliases: `d` staff_duty, `s` staff. */
const DUTY_COST_SQL = 'd.flight_min * 1.0 / (SELECT SUM(x.flight_min) FROM staff_duty x WHERE x.staff_id = d.staff_id AND x.day = d.day) * s.salary / 30';

/** Salary cost of the crew of the given legs: each person's day of salary (a thirtieth of the month) is shared by the legs they flew that day, in proportion to the flying. */
export function crewCost(db: Db, legIds: readonly number[]): number {
  if (legIds.length === 0) return 0;
  const marks = legIds.map(() => '?').join(',');
  return Math.round(all<{ cost: number }>(db, `SELECT ${DUTY_COST_SQL} AS cost FROM staff_duty d JOIN staff s ON s.id = d.staff_id WHERE d.leg_id IN (${marks})`, ...legIds).reduce((t, r) => t + r.cost, 0));
}

/** The crew cost of every duty row departing in [from, to), by flight number (the line a flight number belongs to is `lines.flight_base`'s block). Duty rows outlive their scheduled leg (`leg_id` is cleared when the leg is pruned), so a closed month is read from here. */
export function dutyCostByFlight(db: Db, companyId: number, from: number, to: number): { flightNo: number; at: number; cost: number }[] {
  return all<{ flightNo: number; at: number; cost: number }>(db, `SELECT d.flight_no AS flightNo, d.dep_at AS at, ${DUTY_COST_SQL} AS cost FROM staff_duty d JOIN staff s ON s.id = d.staff_id
    WHERE s.company_id = ? AND d.dep_at >= ? AND d.dep_at < ?`, companyId, from, to);
}

/** Surnames of the pilots who flew a leg ("Lefèvre / Martin"), null when nobody is booked on it. */
export function pilotNames(db: Db, legId: number): string | null {
  const rows = all<{ name: string }>(db, "SELECT s.name FROM staff_duty d JOIN staff s ON s.id = d.staff_id WHERE d.leg_id = ? AND s.family = 'pilot' ORDER BY s.role = 'captain' DESC, s.id", legId);
  return rows.length === 0 ? null : rows.map((r) => r.name.split(' ').slice(1).join(' ') || r.name).join(' / ');
}
