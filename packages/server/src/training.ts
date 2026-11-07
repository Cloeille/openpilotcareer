// Lot TRAINING (v4), server side: the read model of the training centre and the reconversion of a captain into an instructor (docs/v4-plan.md A.4, B.3, C26).
// There is no second course system: a course is `train()` of staff-people.ts (`place: 'own'` is the centre), recorded in `training_courses`; the centre is the facility of effect `training`
// (facilities.ts `centreSeats`), and the instructors are pilot rows with `role = 'instructor'`. Domain operations: callers wrap writes in `tx`.
import {
  ROLE_INSTRUCTOR, SEATS_PER_INSTRUCTOR, ageAt, courseOf, inRetrainWindow, instructorSalary, ownWhy, retirementAt,
  type CentreView, type CourseView, type PilotRef, type RetrainResult, type RetrainView, type RetrainWhy, type TrainOffer, type TrainingView,
} from '@opc/shared';
import { all, get, run, type Db } from './db.ts';
import { centreSeats, effectOf, heldBy, trainingSeats } from './facilities.ts';
import { monthlyOf } from './facilities-views.ts';
import { typeFor } from './game.ts';
import { HttpError } from './http.ts';
import { companyDemand, countOf } from './staff-needs.ts';
import { fleetTypes, memberRow, ownedStaff } from './staff-people.ts';
import { FLIES_SQL, rulesOf, stateOf, type StaffRow } from './staff.ts';
import { memberView } from './staff-views.ts';

const employed = (s: Pick<StaffRow, 'starts_at' | 'ends_at'>, now: number): boolean => s.starts_at <= now && (s.ends_at === null || s.ends_at > now);
const qualsNow = (db: Db, id: number, now: number): string[] =>
  all<{ type_icao: string }>(db, 'SELECT type_icao FROM staff_quals WHERE staff_id = ? AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?) ORDER BY type_icao', id, now, now).map((q) => q.type_icao);

const pilotRef = (db: Db, s: StaffRow, now: number): PilotRef => {
  const retiresAt = retirementAt(s.birth_year, s.role);
  return { staffId: s.id, name: s.name, base: s.base, role: s.role, age: ageAt(s.birth_year, now), retiresAt, inWindow: inRetrainWindow(retiresAt, now), types: qualsNow(db, s.id, now) };
};

const pilotsOf = (db: Db, companyId: number, now: number): StaffRow[] =>
  all<StaffRow>(db, "SELECT * FROM staff s WHERE s.company_id = ? AND s.family = 'pilot' AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?) ORDER BY s.id", companyId, now, now);

// ---------------------------------------------------------------- the centre

/** Everything the training screen shows: the centres and their seats, the courses (own and outside), who could be trained on what at which price, the instructors and the captains who could become one. */
export function trainingView(db: Db, companyId: number, now: number): TrainingView {
  const pilots = pilotsOf(db, companyId, now);
  const hubs = [...new Set(heldBy(db, companyId).filter((h) => effectOf(h) === 'training').map((h) => h.hub_icao))].sort();
  const centres: CentreView[] = hubs.map((hub) => {
    const c = centreSeats(db, companyId, hub, now);
    return { hub, instructors: c.instructors, seats: c.seats, used: c.used, monthly: heldBy(db, companyId, hub).filter((h) => effectOf(h) === 'training').reduce((t, h) => t + monthlyOf(h), 0) };
  });
  const courses = all<{ id: number; staff_id: number; name: string; type_icao: string; base: string; place: 'own' | 'outside'; start_at: number; end_at: number; cost: number; saved: number }>(db,
    `SELECT c.*, s.name FROM training_courses c JOIN staff s ON s.id = c.staff_id WHERE c.company_id = ? ORDER BY c.end_at DESC, c.id DESC LIMIT 40`, companyId)
    .map((c): CourseView => ({ id: c.id, staffId: c.staff_id, name: c.name, type: c.type_icao, base: c.base, place: c.place, startAt: c.start_at, endAt: c.end_at, cost: c.cost, saved: c.saved, running: c.end_at > now }));
  const year = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  const types = fleetTypes(db, companyId).map((icao) => typeFor(db, companyId, icao));
  const seats = new Map<string, ReturnType<typeof trainingSeats>>();
  const offers = pilots.flatMap((s) => {
    const held = new Set(all<{ type_icao: string }>(db, 'SELECT type_icao FROM staff_quals WHERE staff_id = ?', s.id).map((q) => q.type_icao));
    return types.filter((t) => !held.has(t.icao)).map((t): TrainOffer => {
      const key = `${s.base}|${t.icao}`;
      if (!seats.has(key)) seats.set(key, trainingSeats(db, companyId, s.base, t.icao, now));
      const outside = courseOf(t.category, 'outside'), own = courseOf(t.category, 'own');
      return { staffId: s.id, name: s.name, base: s.base, type: t.icao, typeName: t.name, outside, own, saved: outside.cost - own.cost, ownWhy: ownWhy(seats.get(key)!) };
    });
  });
  const convertible = pilots.filter((s) => convertWhy(db, s, now) === null).map((s) => pilotRef(db, s, now))
    .sort((a, b) => (a.retiresAt ?? Infinity) - (b.retiresAt ?? Infinity) || a.staffId - b.staffId).slice(0, 20);
  return {
    running: courses.filter((c) => c.running).length, savedYear: get<{ n: number | null }>(db, 'SELECT SUM(saved) AS n FROM training_courses WHERE company_id = ? AND start_at >= ?', companyId, year)!.n ?? 0,
    centres, courses, offers, instructors: pilots.filter((s) => s.role === ROLE_INSTRUCTOR).map((s) => pilotRef(db, s, now)), convertible,
  };
}

// ---------------------------------------------------------------- reconversion: a captain becomes an instructor

/** Why he cannot be made an instructor now, or null. Only a captain on a permanent contract who holds a rating teaches (a first officer has not the hours; a temporary hire leaves by himself). */
function convertWhy(db: Db, s: StaffRow, now: number): RetrainWhy | null {
  if (s.family !== 'pilot') return 'not_a_pilot';
  if (!employed(s, now)) return 'not_employed';
  if (s.contract === 'cdd') return 'temporary_contract';
  if (s.role === ROLE_INSTRUCTOR) return 'already_instructor';
  if (s.role !== 'captain') return 'not_a_captain';
  return qualsNow(db, s.id, now).length === 0 ? 'no_rating' : null;
}

/** For each type he holds: the pilots who fly it at his base (him included) against the positions its timetable needs there. Taking him off the line leaves `have - 1`. */
function gapOf(db: Db, s: StaffRow, types: readonly string[], now: number): RetrainView['gap'] {
  const demand = companyDemand(db, s.company_id, rulesOf(db, s.company_id)).filter((d) => d.base === s.base);
  return types.map((type) => ({
    type, need: countOf(demand, 'pilot', type),
    have: get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff s WHERE s.company_id = ? AND s.family = 'pilot' AND s.base = ? AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?) AND ${FLIES_SQL}
      AND EXISTS (SELECT 1 FROM staff_quals q WHERE q.staff_id = s.id AND q.type_icao = ? AND q.valid_from <= ? AND (q.valid_until IS NULL OR q.valid_until > ?))`, s.company_id, s.base, now, now, type, now, now)!.n,
  }));
}

export function retrainView(db: Db, companyId: number, id: number, now: number): RetrainView {
  const s = ownedStaff(db, companyId, id);
  const why = convertWhy(db, s, now), types = qualsNow(db, s.id, now);
  const retiresAt = retirementAt(s.birth_year, s.role);
  return {
    member: memberView(db, s, now), age: ageAt(s.birth_year, now), retiresAt, inWindow: inRetrainWindow(retiresAt, now), why,
    offer: why ? null : { salary: instructorSalary(s.salary), retiresAt: retirementAt(s.birth_year, ROLE_INSTRUCTOR), types, seats: SEATS_PER_INSTRUCTOR, centre: centreSeats(db, companyId, s.base, now).centre },
    gap: gapOf(db, s, types, now),
  };
}

const WHY_STATUS: Record<RetrainWhy, [number, string]> = {
  not_a_pilot: [422, 'only pilots become instructors'], not_employed: [409, 'this person is not on your payroll'], temporary_contract: [409, 'a temporary contract ends by itself'],
  already_instructor: [409, 'this person already teaches'], not_a_captain: [409, 'only a captain has the hours to teach'], no_rating: [409, 'he holds no rating to teach'],
};

/** Make a captain an instructor: his role and pay change, his ratings stay, and from now on he takes no leg (every crew query skips him) while the centre at his base counts his seats.
 *  Refused while he is flying: his current duty period finishes first. Pay: INSTRUCTOR_PAY_PCT of what he earned (the new salary is billed from the next 1st, like every payroll change). */
export function retrain(db: Db, companyId: number, id: number, now: number): RetrainResult {
  const s = ownedStaff(db, companyId, id);
  const why = convertWhy(db, s, now);
  if (why) throw new HttpError(WHY_STATUS[why][0], why, WHY_STATUS[why][1]);
  if (stateOf(db, s, now, rulesOf(db, companyId)) === 'onDuty') throw new HttpError(409, 'on_duty', 'this person is flying now');
  const salary = instructorSalary(s.salary);
  run(db, 'UPDATE staff SET role = ?, salary = ? WHERE id = ?', ROLE_INSTRUCTOR, salary, id);
  return { member: memberView(db, memberRow(db, id), now), salary };
}
