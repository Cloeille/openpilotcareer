// Lot SAFETY (v3) read models: GET /safety and GET /safety/incidents (docs/v3-plan.md B.5). The roll itself is in safety.ts.
// "Today" is a dry run of the line engine's own crew check over the next 24 h: the same `crewLeg` books the legs in order inside a savepoint that is rolled back,
// so the duty hours shown are the ones the engine will compute, with the crews already chained from leg to leg.
import {
  BASE_WEAR_PCT, DAY_MS, DEFERRED_REPAIR_PCT, FLYING_FAMILIES, RISKY_FACTOR, SAFETY_MAX, TIRED_FATIGUE, TODAY_MAX, TRAINING_WARN_DAYS, WEAR_AFTER_SERVICE_PCT,
  dayNo, incidentRisk, insuranceSurcharge, leverPoints, riskCurve, riskMultiple, roundScores, safetyIndex, safetyScores, seasonOf,
  type IncidentKind, type IncidentView, type SafetyInputs, type SafetyLever, type SafetyView, type TodayRisk,
} from '@opc/shared';
import { all, get, run, type Db } from './db.ts';
import { addMonths } from './game.ts';
import { companyCode, type LegRow } from './lines.ts';
import { crewDutyMin, incidentsOf, incidentsOn, type IncidentRow } from './safety.ts';
import { crewLeg, dutyFacts, isEmployed, pilotNames, rosterOf, rulesOf } from './staff.ts';

const round1 = (n: number): number => Math.round(n * 10) / 10;
/** 12.67 hours as `12 h 40`. */
const hm = (hours: number): string => {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

const KIND_TITLE: Record<IncidentKind, string> = {
  hard_landing: 'Hard landing', technical_delay: 'Technical delay', bird_strike: 'Bird strike', gear_failure: 'Landing gear failure',
  engine_shutdown: 'Engine shut down in flight', runway_excursion: 'Runway excursion', engine_failure: 'Engine failure',
};

// ---------------------------------------------------------------- the journal

export function incidentView(db: Db, r: IncidentRow & { registration: string | null }): IncidentView {
  return {
    id: r.id, at: r.at, season: r.season, severity: r.severity, kind: r.kind, title: KIND_TITLE[r.kind], detail: `Crew at ${hm(r.duty_min / 60)} of duty, aircraft at ${Math.round(r.wear_pct)} % wear`,
    aircraftId: r.aircraft_id, registration: r.registration ?? `#${r.aircraft_id}`, airport: r.airport,
    flightNo: r.flight_no === null ? null : `${companyCode(db, r.company_id)} ${r.flight_no}`, flightId: r.flight_id,
    dutyMin: r.duty_min, wearPct: round1(r.wear_pct), risk: r.risk, cost: r.cost, covered: r.covered, downtimeUntil: r.downtime_until, reputationDelta: r.reputation_delta,
  };
}

export const journal = (db: Db, companyId: number, season: string): IncidentView[] => incidentsOf(db, companyId, season).map((r) => incidentView(db, r));

// ---------------------------------------------------------------- the index

type Person = { id: number; fatigue: number };

/** Pilots and cabin crew on the payroll now, with their fatigue (the staff lot's own figure). */
const crewOf = (db: Db, companyId: number, now: number): Person[] =>
  rosterOf(db, companyId, now).filter((s) => FLYING_FAMILIES.includes(s.family) && isEmployed(s, now)).map((s) => ({ id: s.id, fatigue: dutyFacts(db, s, now).fatigue }));

/** Type ratings of permanent pilots that end within TRAINING_WARN_DAYS (a temporary contract's rating ends with the contract: that is not a check to retake). */
const expiringRatings = (db: Db, companyId: number, now: number): number =>
  get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM staff_quals q JOIN staff s ON s.id = q.staff_id
    WHERE s.company_id = ? AND s.family = 'pilot' AND s.contract = 'cdi' AND s.starts_at <= ? AND (s.ends_at IS NULL OR s.ends_at > ?)
    AND q.valid_from <= ? AND q.valid_until > ? AND q.valid_until <= ?`, companyId, now, now, now, now, now + TRAINING_WARN_DAYS * DAY_MS)!.n;

const READING_KEEP_DAYS = 30;
/** Legs of the next 24 h the preview chains crews through: a bound on the cost of a read (6 lines of 48 round trips would otherwise be 576). */
const PREVIEW_MAX_LEGS = 120;
/** Today's reading is the index the first time the day is asked for; the delta is against the earliest reading of the last 7 days (0 on the very first answer). */
function deltaOf(db: Db, companyId: number, now: number, index: number): number {
  const today = dayNo(now);
  run(db, 'INSERT INTO safety_readings (company_id, day, idx) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', companyId, today, index);
  run(db, 'DELETE FROM safety_readings WHERE company_id = ? AND day < ?', companyId, today - READING_KEEP_DAYS);
  const base = get<{ idx: number }>(db, 'SELECT idx FROM safety_readings WHERE company_id = ? AND day >= ? AND day <= ? ORDER BY day LIMIT 1', companyId, today - 7, today);
  return index - (base?.idx ?? index);
}

// ---------------------------------------------------------------- today's flights

type Preview = TodayRisk & { pilotIds: number[] };
type PreviewLeg = LegRow & { icao: string; wear: number; ac_status: string; maintenance_until: number | null; ac_returned: number | null };

/** Run `fn`, then undo every write it made (the enclosing transaction goes on). */
function rolledBack<T>(db: Db, fn: () => T): T {
  db.exec('SAVEPOINT preview');
  try {
    return fn();
  } finally {
    db.exec('ROLLBACK TO preview; RELEASE preview');
  }
}

/** The legs of the next 24 h that a crew can be found for, in departure order, each with the crew the engine would give it. A leg nobody could crew would be cancelled, so it carries no risk and is left out. */
function preview(db: Db, companyId: number, now: number, riskFactor: number): Preview[] {
  const code = companyCode(db, companyId);
  const legs = all<PreviewLeg>(db, `SELECT f.*, a.icao, a.wear_pct AS wear, a.status AS ac_status, a.maintenance_until, a.returned_at AS ac_returned
    FROM scheduled_flights f JOIN aircraft a ON a.id = f.aircraft_id WHERE f.company_id = ? AND f.status = 'scheduled' AND f.dep_at >= ? AND f.dep_at < ? ORDER BY f.dep_at, f.id LIMIT ?`, companyId, now, now + DAY_MS, PREVIEW_MAX_LEGS);
  return rolledBack(db, () => legs.flatMap((l): Preview[] => {
    if (l.ac_returned !== null || (l.ac_status === 'maintenance' && (l.maintenance_until ?? 0) > l.dep_at)) return [];
    if (crewLeg(db, { id: l.id, companyId, flightNo: l.flight_no, dep: l.dep_at, arr: l.arr_at, origin: l.origin, dest: l.dest, icao: l.icao })) return [];
    const dutyHours = crewDutyMin(db, l.id) / 60;
    const risk = incidentRisk(dutyHours, l.wear, riskFactor);
    const pilotIds = all<{ staff_id: number }>(db, "SELECT d.staff_id FROM staff_duty d JOIN staff s ON s.id = d.staff_id WHERE d.leg_id = ? AND s.family = 'pilot'", l.id).map((r) => r.staff_id);
    return [{ flightNo: `${code} ${l.flight_no}`, dep: l.dep_at, crew: pilotNames(db, l.id) ?? '', dutyHours: Math.round(dutyHours * 100) / 100, wearPct: round1(l.wear), risk, factor: riskMultiple(risk), pilotIds }];
  }));
}

// ---------------------------------------------------------------- levers

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The three things that would lift the index, in that order, each computed on what the ones before it left (so the gains add up). A lever worth nothing is not offered. */
function leversOf(db: Db, people: readonly Person[], fleet: readonly { id: number; registration: string | null; wear_pct: number }[], inputs: SafetyInputs, flights: readonly Preview[]): SafetyLever[] {
  const out: SafetyLever[] = [];
  let cur = inputs;
  const offer = (after: SafetyInputs, lever: Omit<SafetyLever, 'points'>): void => {
    const points = leverPoints(cur, after);
    if (points <= 0) return;
    out.push({ ...lever, points });
    cur = after;
  };

  // crew: the most tired pilot of the riskiest flight is relieved by someone rested
  const risky = flights[0];
  if (risky && risky.factor >= RISKY_FACTOR) {
    const tiredest = people.filter((p) => risky.pilotIds.includes(p.id)).sort((a, b) => b.fatigue - a.fatigue || a.id - b.id)[0];
    if (tiredest) {
      offer({ ...cur, fatigues: people.map((p, i) => (p.id === tiredest.id ? 0 : cur.fatigues[i]!)) }, {
        action: 'crew', ref: String(tiredest.id), label: `Replace the crew of ${risky.flightNo}`,
        detail: `${risky.crew} at ${hm(risky.dutyHours)} of duty: ${risky.factor} times the average risk`,
      });
    }
  }

  // maintenance: the worst aircraft goes through the workshop
  const worst = [...fleet].sort((a, b) => b.wear_pct - a.wear_pct || a.id - b.id)[0];
  if (worst) {
    offer({ ...cur, wears: fleet.map((a) => (a.id === worst.id ? WEAR_AFTER_SERVICE_PCT : a.wear_pct)) }, {
      action: 'maintenance', ref: String(worst.id), label: `Service ${worst.registration ?? `#${worst.id}`}`, detail: `Wear at ${Math.round(worst.wear_pct)} %`,
    });
  }

  // leave: everybody at or over the tired threshold rests
  const tired = people.filter((p) => p.fatigue >= TIRED_FATIGUE).length;
  if (tired > 0) {
    offer({ ...cur, fatigues: cur.fatigues.map((f) => (f >= TIRED_FATIGUE ? 0 : f)) }, {
      action: 'leave', ref: '', label: `Rest ${plural(tired, 'tired crew member', 'tired crew members')}`, detail: `Fatigue at ${TIRED_FATIGUE} % or more`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- GET /safety

/** Writes today's reading when it is the first of the day: call it inside a transaction. */
export function safetyView(db: Db, companyId: number, now: number): SafetyView {
  const people = crewOf(db, companyId, now);
  const fleet = all<{ id: number; registration: string | null; wear_pct: number }>(db, 'SELECT id, registration, wear_pct FROM aircraft WHERE company_id = ? AND returned_at IS NULL ORDER BY id', companyId);
  const inputs: SafetyInputs = { fatigues: people.map((p) => p.fatigue), wears: fleet.map((a) => a.wear_pct), expiring: expiringRatings(db, companyId, now) };
  const points = roundScores(safetyScores(inputs));
  const index = safetyIndex(points);
  const riskFactor = rulesOf(db, companyId).riskFactor;

  const flights = preview(db, companyId, now, riskFactor).sort((a, b) => b.risk - a.risk || a.dep - b.dep).slice(0, TODAY_MAX);
  const worst = fleet.length === 0 ? null : fleet.reduce((w, a) => (a.wear_pct > w.wear_pct ? a : w));

  const incidents = incidentsOf(db, companyId, seasonOf(now));
  const total = incidents.reduce((n, i) => n + i.cost, 0), covered = incidents.reduce((n, i) => n + i.covered, 0);
  const rise = insuranceSurcharge(incidents);

  return {
    now, active: incidentsOn(db, companyId), index, delta7d: deltaOf(db, companyId, now, index),
    parts: {
      fatigue: { points: points.fatigue, max: SAFETY_MAX.fatigue, avgFatigue: people.length === 0 ? 0 : Math.round(people.reduce((n, p) => n + p.fatigue, 0) / people.length), tired: people.filter((p) => p.fatigue >= TIRED_FATIGUE).length },
      aircraft: { points: points.aircraft, max: SAFETY_MAX.aircraft, worst: worst && { aircraftId: worst.id, registration: worst.registration ?? `#${worst.id}`, wearPct: round1(worst.wear_pct) }, deferred: fleet.filter((a) => a.wear_pct >= DEFERRED_REPAIR_PCT).length },
      training: { points: points.training, max: SAFETY_MAX.training, expiring: inputs.expiring },
    },
    riskFactor,
    riskCurve: riskCurve(worst?.wear_pct ?? BASE_WEAR_PCT, riskFactor),
    today: flights.map(({ pilotIds: _ids, ...f }) => f),
    levers: leversOf(db, people, fleet, inputs, flights),
    season: { total, covered, borne: total - covered, insuranceFrom: rise > 0 ? seasonOf(addMonths(now, 1)) : null, insuranceDelta: rise },
  };
}
