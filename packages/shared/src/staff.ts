// Lot STAFF (v3): people, duty limits, leave, recruitment, payroll. Pure rules, constants, request schemas and wire types (docs/v3-plan.md B.3).
// Imports only types from index.ts (and DAY_MS from lines.ts), so there is no runtime cycle.
import { z } from 'zod';
import type { AircraftCategory } from './index.ts';
import { DAY_MS } from './lines.ts';

// ---------------------------------------------------------------- families and roles

export const STAFF_FAMILIES = ['pilot', 'cabin', 'ground', 'admin', 'maintenance', 'kitchen'] as const;
export type StaffFamily = (typeof STAFF_FAMILIES)[number];
export type StaffRole = 'captain' | 'fo' | 'attendant' | 'agent' | 'clerk' | 'technician' | 'cook';
export const ROLE_OF: Record<Exclude<StaffFamily, 'pilot'>, StaffRole> = { cabin: 'attendant', ground: 'agent', admin: 'clerk', maintenance: 'technician', kitchen: 'cook' };
/** Only pilots and cabin crew fly: the line engine's crew check reads these two families. */
export const FLYING_FAMILIES: readonly StaffFamily[] = ['pilot', 'cabin'];

/** Crew an aircraft needs on every leg (B.3): two pilots (one below 10 seats), one cabin attendant per 40 seats from 20 seats up (ATR 72: 2, a 130-seater: 4, a C172: none). */
export const crewNeeded = (seats: number): { pilots: number; cabin: number } => ({ pilots: seats >= 10 ? 2 : 1, cabin: seats >= 20 ? Math.ceil(seats / 40) : 0 });

// ---------------------------------------------------------------- duty limits (simplified EASA FTL; the mockup's numbers are the source)

export const DUTY_MAX_MIN = 13 * 60;
export const FLIGHT_MAX_28D_MIN = 100 * 60;
export const FLIGHT_MAX_12M_MIN = 900 * 60;
export const DUTY_MAX_7D_MIN = 60 * 60;
export const MAX_CONSECUTIVE_DUTY_DAYS = 6;
/** Shown on the staff card. It is enforced through MAX_CONSECUTIVE_DUTY_DAYS: no seventh duty day in a row. */
export const WEEKLY_REST_H = 36;
/** A duty period starts this long before the first departure and ends this long after the last landing. */
export const DUTY_REPORT_MIN = 45;
export const DUTY_RELEASE_MIN = 15;
/** Two legs of one person less than this apart belong to the same duty period; farther apart, the second one needs the full rest first. */
export const DUTY_BREAK_MIN = 6 * 60;
/** A person who has not flown for this long is back at their base (the company positions its crews for free), so a cancelled return never strands anyone for good. */
export const REPOSITION_H = 24;

export type RestPolicy = 'legal' | 'standard' | 'generous';
export type RestPolicyRules = { restBaseH: number; restAwayH: number; extraHeadcountPct: number; riskFactor: number };
/** B.8: the three policies. The rest hours are enforced by the crew check and size the crews a timetable needs; `extraHeadcountPct` is the share of pilots and cabin crew a company
 *  keeps beyond the legal minimum (generous: +7 %, the mockup's +5 people). `riskFactor` multiplies the incident risk: lot SAFETY reads it, this lot only reports it.
 *  The mockup's "fatigue 38 to 24 %" is not a constant here: fatigue is computed from the duty actually worked. */
export const REST_POLICIES: Record<RestPolicy, RestPolicyRules> = {
  legal: { restBaseH: 12, restAwayH: 10, extraHeadcountPct: 0, riskFactor: 1 },
  standard: { restBaseH: 13, restAwayH: 11, extraHeadcountPct: 0.035, riskFactor: 0.9 },
  generous: { restBaseH: 14, restAwayH: 12, extraHeadcountPct: 0.07, riskFactor: 0.7 },
};
export const REST_POLICY_NAMES = ['legal', 'standard', 'generous'] as const;
export const DEFAULT_REST_POLICY: RestPolicy = 'standard';

/** What the duty rules know about one person at the instant a leg would depart. */
export type DutyInput = {
  base: string;
  /** The current duty period (null: never flew) and the landing of the last leg, with the airport it landed at. */
  dutyStart: number | null; lastEnd: number | null; lastAt: string | null;
  /** Minutes in the windows ending the day of the leg: 28 days and 12 months of flying, 7 days of duty. */
  flight28Min: number; flight12Min: number; duty7Min: number;
  /** Consecutive duty days ending the day BEFORE the leg's day, and whether the leg's day already has duty. */
  streakDays: number; dutyToday: boolean;
};
export type DutyRule = 'busy' | 'rest' | 'daily' | 'flight28' | 'flight12' | 'week' | 'streak';
/** `overBy`: minutes beyond the limit (a streak: days). */
export type DutyBreach = { rule: DutyRule; overBy: number };

/** A leg less than DUTY_BREAK_MIN after the previous landing continues the same duty period. */
export const continuesDuty = (s: Pick<DutyInput, 'dutyStart' | 'lastEnd'>, dep: number): boolean =>
  s.dutyStart !== null && s.lastEnd !== null && dep >= s.lastEnd && dep - s.lastEnd < DUTY_BREAK_MIN * 60_000;

/** Minutes of duty the leg adds to the person's ledger: the whole period for the first leg, the time since the previous landing for the next ones. */
export const dutyIncrementMin = (s: Pick<DutyInput, 'dutyStart' | 'lastEnd'>, leg: { dep: number; arr: number }): number =>
  continuesDuty(s, leg.dep) ? (leg.arr - s.lastEnd!) / 60_000 : DUTY_REPORT_MIN + (leg.arr - leg.dep) / 60_000 + DUTY_RELEASE_MIN;

/** The first rule the person would break by flying the leg, or null. Pure; the order is the order of the checks (most basic first). */
export function dutyViolation(s: DutyInput, leg: { dep: number; arr: number }, rules: RestPolicyRules): DutyBreach | null {
  const flight = (leg.arr - leg.dep) / 60_000;
  if (s.lastEnd !== null && leg.dep < s.lastEnd) return { rule: 'busy', overBy: (s.lastEnd - leg.dep) / 60_000 };
  const same = continuesDuty(s, leg.dep);
  if (!same) {
    if (s.lastEnd !== null) {
      const restMin = (s.lastAt === s.base ? rules.restBaseH : rules.restAwayH) * 60;
      const rested = (leg.dep - DUTY_REPORT_MIN * 60_000 - (s.lastEnd + DUTY_RELEASE_MIN * 60_000)) / 60_000;
      if (rested < restMin) return { rule: 'rest', overBy: restMin - rested };
    }
    if (!s.dutyToday && s.streakDays >= MAX_CONSECUTIVE_DUTY_DAYS) return { rule: 'streak', overBy: s.streakDays + 1 - MAX_CONSECUTIVE_DUTY_DAYS };
  }
  const start = same ? s.dutyStart! : leg.dep - DUTY_REPORT_MIN * 60_000;
  const span = (leg.arr + DUTY_RELEASE_MIN * 60_000 - start) / 60_000;
  if (span > DUTY_MAX_MIN) return { rule: 'daily', overBy: span - DUTY_MAX_MIN };
  if (s.flight28Min + flight > FLIGHT_MAX_28D_MIN) return { rule: 'flight28', overBy: s.flight28Min + flight - FLIGHT_MAX_28D_MIN };
  if (s.flight12Min + flight > FLIGHT_MAX_12M_MIN) return { rule: 'flight12', overBy: s.flight12Min + flight - FLIGHT_MAX_12M_MIN };
  const week = s.duty7Min + dutyIncrementMin(s, leg);
  if (week > DUTY_MAX_7D_MIN) return { rule: 'week', overBy: week - DUTY_MAX_7D_MIN };
  return null;
}

// ---------------------------------------------------------------- fatigue, coverage, crews needed

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** B.3, in [0, 100]: 40 x duty hours of the last 7 days / 60 + 4 per consecutive duty day, minus 12 per full rest day since the last duty.
 *  Camille Lefèvre of the mockup (46 h in 7 days, 6 days in a row) comes to 55; a pilot with 30 h over 3 days, 32. [NO MODEL in the mockup: tuning constants.] */
export const fatigueOf = (o: { duty7Min: number; streakDays: number; restDays: number }): number =>
  clamp(Math.round((40 * o.duty7Min) / 60 / 60 + 4 * o.streakDays - 12 * o.restDays), 0, 100);

export type Coverage = 'ok' | 'tight' | 'short' | 'none';
/** People available against the positions a timetable needs: below CREW_SLACK of them the rosters cannot be flown legally (`short`), nobody is `none`. */
export const coverageOf = (available: number, positions: number): Coverage =>
  positions <= 0 || available >= positions * COVERAGE_OK ? 'ok' : available <= 0 ? 'none' : available >= positions * CREW_SLACK ? 'tight' : 'short';

/** Slack for leave, sickness and rest: a company employs `people / CREW_SLACK` for the people its rosters keep busy (the spec's 0.7). */
export const CREW_SLACK = 0.7;
export const COVERAGE_OK = 0.85;

/** How many crews (a captain and a first officer, or a cabin team) one aircraft's timetable keeps busy under the duty rules above, as a fraction so that aircraft of one type
 *  at one base share crews. `spanMin`: first report to last release on an operating day; `flightMin`: minutes flown that day; `daysPerWeek`: operating days.
 *  The binding rule is usually the 900 h a year (about two crews for a full-time ATR) or the 36 h weekly rest. [NO MODEL in the mockup: the spec's `13 h x 0.7` rule
 *  does not keep a rotation feasible once rest is enforced, so this takes the binding rule instead.] */
export function crewTeams(spanMin: number, flightMin: number, daysPerWeek: number, restBaseH: number): number {
  if (spanMin <= 0 || daysPerWeek <= 0) return 0;
  const perDay = Math.ceil(spanMin / DUTY_MAX_MIN);
  const rest = perDay * (spanMin + restBaseH * 60 > 24 * 60 || daysPerWeek > MAX_CONSECUTIVE_DUTY_DAYS ? 2 : 1);
  return Math.max(rest, (spanMin * daysPerWeek) / DUTY_MAX_7D_MIN, (flightMin * daysPerWeek * 4) / FLIGHT_MAX_28D_MIN, (flightMin * daysPerWeek * 52) / FLIGHT_MAX_12M_MIN);
}

/** People to employ for `people` kept busy by the rosters (teams x crew size), with the slack and the rest policy's extra headcount. */
export const positionsFor = (people: number, policy: RestPolicyRules): number =>
  people <= 0 ? 0 : Math.ceil((people / CREW_SLACK) * (1 + policy.extraHeadcountPct));

// ---------------------------------------------------------------- money (C7, B.8)

export const BASE_SALARY: Record<StaffFamily, number> = { pilot: 6_200, cabin: 3_400, ground: 3_000, admin: 4_200, maintenance: 4_600, kitchen: 2_900 };
/** Pilot pay by the category of the type: the ATR captain of the mockup is 6 200 euros, a jet captain earns more. */
const TYPE_PAY: Record<AircraftCategory, number> = {
  'piston-single': 0.45, 'piston-multi': 0.6, 'turboprop-single': 0.7, 'turboprop-multi': 0.85, 'turboprop-airliner': 1,
  'jet-business': 1.3, 'jet-airliner': 1.6, 'jet-widebody': 2.2, spaceplane: 3.5, helicopter: 0.9, other: 0.7,
};
/** Experience is flight hours for a pilot and years for the others; this maps it to 0..1 (10 000 h, 20 years). */
export const experienceFactor = (family: StaffFamily, experience: number): number => clamp(experience / (family === 'pilot' ? 10_000 : 20), 0, 1);
/** A pilot is captain from 3 000 hours. */
export const CAPTAIN_FROM_HOURS = 3_000;
/** Monthly asking salary, rounded to 50 euros. `experience` is 0 to 1 and moves it from 0.8 to 1.2 of the base. */
export function salaryFor(family: StaffFamily, role: StaffRole, experience: number, category: AircraftCategory | null): number {
  const pay = family === 'pilot' ? (category ? TYPE_PAY[category] : 1) * (role === 'fo' ? 0.7 : 1) : 1;
  return Math.round((BASE_SALARY[family] * pay * (0.8 + 0.4 * clamp(experience, 0, 1))) / 50) * 50;
}

export const HIRING_PREMIUM_MONTHS = 1;
/** Support families (docs/v3-plan.md B.3 leaves their sizing to the lot; tuning constants, not enforced by the crew check): one ground agent at every airport a line serves,
 *  one technician per two aircraft on a line, one administrator per 25 other people (at least one as soon as a line flies). */
export const GROUND_PER_AIRPORT = 1;
export const AIRCRAFT_PER_TECHNICIAN = 2;
export const PEOPLE_PER_ADMIN = 25;
/** C7: firing costs three months of salary. */
export const FIRING_MONTHS = 3;
export const LEAVE_DAYS_PER_YEAR = 25;
/** A person asks for leave in a given month with this probability (deterministic per person and month), for 3 to 10 days starting between the 4th and the 25th. */
export const LEAVE_ASK_RATE = 0.3;
export const DEFAULT_NOTICE_DAYS = 7;
export const MAX_INTERIM_DAYS = 30;
/** An interim costs 1.2 x the daily salary x 1.5, for each day, paid up front [NO MODEL for the mockup's 1 450 euros]. */
export const interimPrice = (monthlySalary: number, days: number): number => Math.round((monthlySalary / 30) * 1.2 * 1.5 * days);
/** Euros per person to make a hired employee still in notice start at once (starts_at = now). One constant for the hire panel, the member sheet and the line fix panel. */
export const START_NOW_FEE = 5_000;

/** Type rating course by category: days off the roster and price. CRJ (a jet airliner) is the mockup's 21 days and 24 000 euros. */
export const TRAINING_COURSE: Record<AircraftCategory, { days: number; cost: number }> = {
  'piston-single': { days: 7, cost: 3_500 }, 'piston-multi': { days: 10, cost: 6_000 }, 'turboprop-single': { days: 14, cost: 9_000 }, 'turboprop-multi': { days: 14, cost: 12_000 },
  'turboprop-airliner': { days: 21, cost: 18_000 }, 'jet-business': { days: 21, cost: 20_000 }, 'jet-airliner': { days: 21, cost: 24_000 }, 'jet-widebody': { days: 28, cost: 36_000 },
  spaceplane: { days: 56, cost: 120_000 }, helicopter: { days: 14, cost: 12_000 }, other: { days: 14, cost: 8_000 },
};

/** Days are numbered from the epoch (UTC). */
export const dayNo = (ms: number): number => Math.floor(ms / DAY_MS);
export const dayIso = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const isoDayNo = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
/** The year a leave day counts in. */
export const yearOfDay = (day: number): number => new Date(day * DAY_MS).getUTCFullYear();

// ---------------------------------------------------------------- request schemas

const airportCode = z.string().regex(/^[A-Z]{4}$/, 'ICAO airport code: 4 letters A-Z');
const typeCode = z.string().regex(/^[A-Z0-9]{2,4}$/, 'ICAO type designator: 2-4 chars A-Z/0-9');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const SORTS = ['experience', 'reliability', 'morale', 'salary'] as const;

export const candidatesQuerySchema = z.object({
  family: z.enum(STAFF_FAMILIES).optional(), base: airportCode.optional(), qual: typeCode.optional(), sort: z.enum(SORTS).optional(),
});
export const staffQuerySchema = z.object({ base: airportCode.optional(), family: z.enum(STAFF_FAMILIES).optional() });
/** `startNow`: pay START_NOW_FEE too, the hire starts at once. */
export const hireSchema = z.object({ candidateId: z.string().min(1).max(60), startNow: z.boolean().optional() });
export const trainSchema = z.object({ type: typeCode });
export const transferSchema = z.object({ base: airportCode });
export const interimSchema = z.object({ family: z.enum(STAFF_FAMILIES), qual: typeCode.optional(), base: airportCode.optional(), days: z.int().min(1).max(MAX_INTERIM_DAYS) })
  .refine((b) => b.family !== 'pilot' || !!b.qual, { message: 'qual: a pilot needs the type to fly', path: ['qual'] });
export const leaveQuerySchema = z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(7).max(120).optional() });
export const leaveDecisionSchema = z.object({ decision: z.enum(['grant', 'refuse']) });
export const restPolicySchema = z.object({ policy: z.enum(REST_POLICY_NAMES) });

// ---------------------------------------------------------------- wire types

export type StaffState = 'pending' | 'free' | 'onDuty' | 'resting' | 'leave' | 'training' | 'left';
export type StaffMember = {
  id: number; family: StaffFamily; name: string; role: StaffRole; base: string; hiredAt: number; startsAt: number; endsAt: number | null;
  /** Euros a month. */
  salary: number; reliability: number; morale: number;
  /** Flight hours for a pilot, years for the others. */
  experience: number;
  contract: 'cdi' | 'cdd'; noticeDays: number; state: StaffState; quals: string[];
};
export type Qualification = { type: string; name: string; validFrom: number; validUntil: number | null; inTraining: boolean };
/** `dutyMin`, `limitMin`: minutes; `restHours`, `flight28d`, `flight12m`: hours. */
export type DutyState = { dutyMin: number; limitMin: number; endsAt: number | null; restHours: number; flight28d: number; flight12m: number; fatigue: number; medicalDays: number };
/** A leg the person flew (or will fly: the engine books crews at the departure tick). */
export type DutyBlock = { flightNo: string; dep: number; arr: number; origin: string; dest: string };

/** A hire in notice: signed and paid for, on the roster, but not working before `startsAt`. */
export type Arrival = { id: number; name: string; role: StaffRole; startsAt: number };
/** `headcount`: people working now (what the crew check can use). `availability.pending` and `arriving` (soonest first): hires in notice, who already fill a post, so `vacant` = `need` - `headcount` - `pending`. */
export type FamilyRow = {
  family: StaffFamily; label: string;
  /** The aircraft type of a child row of the pilots. */
  type?: string;
  headcount: number; need: number;
  availability: { onDuty: number; resting: number; leave: number; training: number; free: number; pending: number; vacant: number };
  arriving: Arrival[];
  salaries: number; note: string | null; children?: FamilyRow[];
};
/** Today's flights cancelled for want of crew: `family` is what ran short (null when unknown), `type` the aircraft type. */
export type Blocker = { kind: 'no_crew' | 'duty_limit'; family: 'pilot' | 'cabin' | null; type: string; flights: number };
export type WatchItem = { staffId: number; name: string; family: StaffFamily; reason: 'fatigue' | 'duty'; value: number; detail: string };
/** `people` and `payroll` are the people working now; `pending` counts the hires still in notice (listed per row in `arriving`). */
export type StaffOverview = { people: number; pending: number; positions: number; payroll: number; policy: RestPolicy; families: FamilyRow[]; blockers: Blocker[]; watch: WatchItem[] };

export type StaffDetail = {
  member: StaffMember; duty: DutyState; week: DutyBlock[];
  last7d: { day: string; hours: number | null; kind: 'duty' | 'rest' }[];
  quals: Qualification[];
  contract: { kind: 'cdi' | 'cdd'; salary: number; noticeDays: number; firingCost: number; endsAt: number | null };
  nextLeave: { from: string; to: string } | null;
  /** The next flight the person could not fly under the duty rules; null while there is none. */
  alert: { flightNo: string; overBy: number; rule: DutyRule } | null;
};

export type Candidate = {
  id: string; family: StaffFamily; role: StaffRole; name: string; base: string; qual: string | null;
  experience: number; reliability: number; morale: number; askingSalary: number; noticeDays: number; premium: number;
};
export type CandidatesView = { market: number; candidates: Candidate[]; suggestion: { count: number; label: string } | null };
export type HireResult = { member: StaffMember; startsAt: number; premium: number; balanceAfter: number };
export type FireResult = { severance: number; balanceAfter: number };
export type TrainResult = { member: StaffMember; cost: number; days: number; until: number; balanceAfter: number };
export type InterimResult = { member: StaffMember; cost: number; endsAt: number; balanceAfter: number };
export type StartNowResult = { member: StaffMember; fee: number; balanceAfter: number };

export type LeaveRequest = {
  id: number; staffId: number; name: string; family: StaffFamily; from: string; to: string; days: number; status: 'pending' | 'granted' | 'refused'; kind: 'leave' | 'rest' | 'training';
  /** Pending requests only: the coverage of the person's family on the worst day of the request, before and after granting it. */
  impact: { before: Coverage; after: Coverage; worstDay: string } | null;
};
/** `extraHeadcount` and `payrollDelta` are against the legal minimum, for this company's timetable. */
export type PolicyOption = { policy: RestPolicy; restBaseH: number; restAwayH: number; extraHeadcount: number; payrollDelta: number; riskFactor: number };
export type LeaveView = {
  balance: number; resting: number; restingPilots: number; avgFatigue: number;
  /** `perDay`: people the timetable needs every day (the positions of the family); `days[i]` is the coverage of day `from` + i. */
  coverage: { family: StaffFamily; label: string; headcount: number; perDay: number; days: Coverage[] }[];
  /** The first day each family is `short` or `none`. */
  alerts: { family: StaffFamily; day: string; coverage: Coverage }[];
  from: string; requests: LeaveRequest[]; policy: RestPolicy; policies: PolicyOption[];
};
