// Lot SAFETY (v3): fatigue, incidents and the safety index. Pure rules, constants, request schemas and wire types (docs/v3-plan.md B.5).
// Imports only types from index.ts, so there is no runtime cycle.
import { z } from 'zod';
import { WEAR_AFTER_MAINTENANCE_PCT } from './finance.ts';
import { DUTY_RELEASE_MIN, DUTY_REPORT_MIN } from './staff.ts';

// ---------------------------------------------------------------- incident risk (B.5: a pure function of crew duty hours and aircraft wear)

/** Share of flights that end in an incident for a rested crew on an aircraft at 40 % wear: the average of the mockup's curve. */
export const INCIDENT_BASE_RISK = 0.0045;
/** Duty hours up to which the risk does not move, and the distance from there to the ×4 point (8 h + 5 h 15 = 13 h 15, the mockup's "4 fois la moyenne"). */
export const DUTY_KNEE_H = 8;
export const DUTY_SPAN_H = 5.25;
export const dutyFactor = (dutyHours: number): number => (dutyHours <= DUTY_KNEE_H ? 1 : 1 + 3 * ((dutyHours - DUTY_KNEE_H) / DUTY_SPAN_H) ** 2);
/** About 1.0 at 40 % wear, 1.4 at 63 %, 1.8 at 84 %. */
export const wearFactor = (wearPct: number): number => 0.76 + 1.5 * (wearPct / 100) ** 2;
/** `riskFactor` is the rest policy's (S2 `REST_POLICIES`): 1 / 0.9 / 0.7. The check value is 1.8 % at 13 h 15 of duty and 40 % wear. */
export const incidentRisk = (dutyHours: number, wearPct: number, riskFactor = 1): number =>
  Math.min(1, INCIDENT_BASE_RISK * dutyFactor(dutyHours) * wearFactor(wearPct) * riskFactor);
/** How many times the average flight's risk a flight carries (what the mockup calls "4 fois la moyenne"). */
export const riskMultiple = (risk: number): number => Math.round((risk / INCIDENT_BASE_RISK) * 10) / 10;

/** The two wear levels of the chart's curves (legend: "bon état, moins de 40 %", "usé, plus de 60 %"). */
export const CURVE_WEAR_GOOD = 40;
export const CURVE_WEAR_WORN = 63;
export const CURVE_MAX_H = 14;
export const CURVE_STEP_H = 0.5;

/** A flight the player flies is not a crew member (C4): its duty period is its own block time between the report and the release. */
export const flightDutyMin = (blockHours: number): number => DUTY_REPORT_MIN + Math.round(blockHours * 60) + DUTY_RELEASE_MIN;

// ---------------------------------------------------------------- severity, kind, cost

export const SEVERITIES = ['minor', 'serious', 'grave'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const INCIDENT_KINDS = ['hard_landing', 'technical_delay', 'bird_strike', 'gear_failure', 'engine_shutdown', 'runway_excursion', 'engine_failure'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** The second seeded roll: 70 % minor, 25 % serious, 5 % grave. */
export const SEVERITY_SHARE: Record<Severity, number> = { minor: 0.7, serious: 0.25, grave: 0.05 };
/** The third: which incident of that severity. Weights add up to 1. */
export const KIND_SHARE: Record<Severity, readonly (readonly [IncidentKind, number])[]> = {
  minor: [['hard_landing', 0.45], ['technical_delay', 0.4], ['bird_strike', 0.15]],
  serious: [['gear_failure', 0.5], ['engine_shutdown', 0.5]],
  grave: [['runway_excursion', 0.6], ['engine_failure', 0.4]],
};
/** Out of the company's control: the insurance pays all of it and the premium does not rise (15 % of the minor ones). */
export const INSURED_KINDS: readonly IncidentKind[] = ['bird_strike'];
export const isInsured = (kind: IncidentKind): boolean => INSURED_KINDS.includes(kind);

/** Repair bill ranges of B.5 (euros), paid for any aircraft worth at least INCIDENT_REF_VALUE (an ATR 72); a cheaper one pays in proportion to its value
 *  (the absolute range would put a 250 000 euro bill on a 39 000 euro Cessna). */
export const INCIDENT_COST: Record<Severity, { min: number; max: number }> = { minor: { min: 5_000, max: 20_000 }, serious: { min: 40_000, max: 120_000 }, grave: { min: 100_000, max: 250_000 } };
export const INCIDENT_REF_VALUE = 1_500_000;
/** Days in the workshop. Grave: B.5 says "grounded until a decision", but v3 has no decision to take, so it is the length of the investigation. */
export const INCIDENT_DOWNTIME_DAYS: Record<Severity, number> = { minor: 2, serious: 14, grave: 30 };
/** Stored reputation points (0 to 100, C17): the mockup's 0, -0.1 and -0.3 stars at x20 are 0, -2 and -6. */
export const INCIDENT_REPUTATION: Record<Severity, number> = { minor: 0, serious: -2, grave: -6 };

export const severityOf = (roll: number): Severity => (roll < SEVERITY_SHARE.minor ? 'minor' : roll < SEVERITY_SHARE.minor + SEVERITY_SHARE.serious ? 'serious' : 'grave');
const kindOf = (severity: Severity, roll: number): IncidentKind => {
  let acc = 0;
  for (const [kind, share] of KIND_SHARE[severity]) if (roll < (acc += share)) return kind;
  return KIND_SHARE[severity][KIND_SHARE[severity].length - 1]![0];
};

export type IncidentDraw = { severity: Severity; kind: IncidentKind; costUnit: number };

/** The whole roll, from a seeded generator (server: `mulberry32(hashSeed('incident:' + ref))`): one draw says whether it happens, three more say how.
 *  The draws are taken in a fixed order, so the same reference always gives the same answer. */
export function drawIncident(risk: number, rand: () => number): IncidentDraw | null {
  if (rand() >= risk) return null;
  const severity = severityOf(rand());
  return { severity, kind: kindOf(severity, rand()), costUnit: rand() };
}

/** Euros, rounded to 50, for an aircraft worth `aircraftValue`. `costUnit` in [0, 1) places the bill inside the severity's range. */
export const incidentCost = (severity: Severity, costUnit: number, aircraftValue: number): number => {
  const { min, max } = INCIDENT_COST[severity];
  return Math.max(50, Math.round(((min + (max - min) * costUnit) * Math.min(1, aircraftValue / INCIDENT_REF_VALUE)) / 50) * 50);
};

// ---------------------------------------------------------------- insurance (monthly billing multiplies the hull premium)

/** Premium rise, a share of the premium, for each incident of the month before that was the company's doing. The mockup's month (a grave, two at-fault minors and a bird strike) comes to +12 %. */
export const INSURANCE_SURCHARGE: Record<Severity, number> = { minor: 0.02, serious: 0.04, grave: 0.08 };
export const INSURANCE_SURCHARGE_MAX = 0.4;
export const insuranceSurcharge = (incidents: readonly { severity: Severity; kind: IncidentKind }[]): number =>
  Math.min(INSURANCE_SURCHARGE_MAX, Math.round(incidents.filter((i) => !isInsured(i.kind)).reduce((t, i) => t + INSURANCE_SURCHARGE[i.severity], 0) * 1000) / 1000);

// ---------------------------------------------------------------- the safety index (0 to 100 = fatigue 40 + aircraft 40 + training 20)

export const SAFETY_MAX = { fatigue: 40, aircraft: 40, training: 20 } as const;
/** Points lost per point of the crews' mean fatigue: the mockup's 38 % average is 27 of 40. */
export const FATIGUE_LOSS_PER_POINT = 0.35;
/** The same threshold as the staff watch list. */
export const TIRED_FATIGUE = 50;
/** A flight carrying at least this many times the average risk calls for a crew change. */
export const RISKY_FACTOR = 2;
/** A visit to the workshop leaves the aircraft at this wear (the lever "schedule the service" is worth the difference). */
export const WEAR_AFTER_SERVICE_PCT = WEAR_AFTER_MAINTENANCE_PCT;
/** An aircraft over this wear has a repair put off (the chart's "usé"). */
export const DEFERRED_REPAIR_PCT = 60;
/** A rating that ends within this many days is a check to retake: 4 points each (the mockup's 16 of 20 for one simulator check). */
export const TRAINING_WARN_DAYS = 30;
export const TRAINING_LOSS_PER_EXPIRING = 4;

export type SafetyInputs = {
  /** One fatigue (0 to 100) for each pilot and cabin attendant on the payroll. */
  fatigues: readonly number[];
  /** Wear (percent) of each aircraft of the fleet. */
  wears: readonly number[];
  /** Ratings of the crews that end within TRAINING_WARN_DAYS. */
  expiring: number;
};
export type SafetyPoints = { fatigue: number; aircraft: number; training: number };

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The aircraft part follows the wear factor of the risk curve, so the index and the chart agree: nothing lost up to 40 % wear, all of it at 100 %. It is the worst aircraft that counts. */
export const aircraftLoss = (worstWearPct: number): number => SAFETY_MAX.aircraft * clamp((wearFactor(worstWearPct) - 1) / (wearFactor(100) - 1), 0, 1);

/** Each part starts at its maximum and loses points (exact, not rounded). No crew, no aircraft or nothing expiring loses nothing. */
export const safetyScores = (i: SafetyInputs): SafetyPoints => ({
  fatigue: SAFETY_MAX.fatigue - Math.min(SAFETY_MAX.fatigue, FATIGUE_LOSS_PER_POINT * mean(i.fatigues)),
  aircraft: SAFETY_MAX.aircraft - (i.wears.length === 0 ? 0 : aircraftLoss(Math.max(...i.wears))),
  training: Math.max(0, SAFETY_MAX.training - TRAINING_LOSS_PER_EXPIRING * i.expiring),
});
export const roundScores = (p: SafetyPoints): SafetyPoints => ({ fatigue: Math.round(p.fatigue), aircraft: Math.round(p.aircraft), training: Math.round(p.training) });
/** The index is the sum of the parts as shown (27 + 29 + 16 = 72 in the mockup). */
export const safetyIndex = (p: SafetyPoints): number => p.fatigue + p.aircraft + p.training;
/** What a lever gains: the exact difference of the two indexes, to a tenth of a point. */
export const leverPoints = (before: SafetyInputs, after: SafetyInputs): number => Math.round((safetyIndex(safetyScores(after)) - safetyIndex(safetyScores(before))) * 10) / 10;

// ---------------------------------------------------------------- request schemas

export const incidentsQuerySchema = z.object({ season: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'season: YYYY-MM').optional() });

// ---------------------------------------------------------------- wire types

export type IncidentView = {
  id: number; at: number; season: string; severity: Severity; kind: IncidentKind;
  aircraftId: number; registration: string; airport: string;
  /** 'AZR 1138' for a line leg, null for a flight the player flew (then `flightId`). */
  flightNo: string | null; flightId: number | null;
  /** The facts behind the roll: the longest duty period of the crew in minutes, the aircraft's wear and the resulting risk (a fraction). */
  dutyMin: number; wearPct: number; risk: number;
  /** Euros. `covered` is what the insurance paid, the rest was charged to the company. */
  cost: number; covered: number; downtimeUntil: number;
  /** Stored points (0 to 100). */
  reputationDelta: number;
};
/** A flight of the next 24 h and the risk of the crew the line engine would give it now. `crew`: the pilots' surnames; `factor`: times the risk of an average flight (`riskMultiple`). */
export type TodayRisk = { flightNo: string; dep: number; crew: string | null; dutyHours: number; wearPct: number; risk: number; factor: number };

/** What the index gains if the problem is fixed (the gains add up: each lever is computed on what the ones before it left). `ref`: a staff id for `crew`, an aircraft id for `maintenance`. */
export type SafetyLever =
  | { action: 'crew'; points: number; ref: string; flightNo: string; name: string; dutyHours: number }
  | { action: 'maintenance'; points: number; ref: string; registration: string; wearPct: number }
  | { action: 'leave'; points: number; ref: ''; tired: number };

export type RiskPoint = { dutyHours: number; risk: number; good: number; worn: number };
export const riskCurve = (worstWearPct: number, riskFactor: number): RiskPoint[] =>
  Array.from({ length: Math.round(CURVE_MAX_H / CURVE_STEP_H) + 1 }, (_, i) => {
    const h = i * CURVE_STEP_H;
    return { dutyHours: h, risk: incidentRisk(h, worstWearPct, riskFactor), good: incidentRisk(h, CURVE_WEAR_GOOD), worn: incidentRisk(h, CURVE_WEAR_WORN) };
  });

export type SafetyView = {
  now: number;
  /** False when the company's realism has "wear and failures" off: no incident is ever rolled; the figures are still computed. */
  active: boolean;
  index: number;
  /** Against the earliest reading of the last 7 days; null until one exists (a reading is taken the first time a day's index is asked for). */
  delta7d: number | null;
  parts: {
    fatigue: { points: number; max: number; avgFatigue: number; tired: number };
    aircraft: { points: number; max: number; worst: { aircraftId: number; registration: string; wearPct: number } | null; deferred: number };
    training: { points: number; max: number; expiring: number };
  };
  /** The rest policy's factor on the risk of a crewed flight (1 / 0.9 / 0.7). */
  riskFactor: number;
  /** `risk`: the company's own curve (wear of its worst aircraft, rest policy factor); `good` and `worn`: the chart's two reference curves (CURVE_WEAR_GOOD, CURVE_WEAR_WORN, factor 1). */
  riskCurve: RiskPoint[];
  today: TodayRisk[];
  levers: SafetyLever[];
  season: { total: number; covered: number; borne: number; insuranceFrom: string | null; insuranceDelta: number };
};
