// Lot LINES (v3): autonomous lines on the simulated clock. Pure rules, constants and wire types (docs/v3-plan.md B.1, B.2).
// Imports only types from index.ts, so there is no runtime cycle.
import { z } from 'zod';
import type { AirportSize } from './index.ts';

// ---------------------------------------------------------------- clock (B.1: the simulated clock IS the real UTC clock)

export const LINE_TICK_MS = 900_000;
export const TICKS_PER_DAY = 96;
export const DAY_MS = 86_400_000;
/** Ticks replayed leg by leg; older ones are settled in bulk (one posting per kind, line and day). */
export const MAX_LINE_CATCHUP_TICKS = 192;
/** Decision C1: lines stop earning this long after the owner's last request. */
export const MAX_OFFLINE_DAYS = 14;
/** Past legs and ticks are pruned after this many days. */
export const LINE_KEEP_DAYS = 35;

export const lineTickOf = (ms: number): number => Math.floor(ms / LINE_TICK_MS);
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const dayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;
/** Monday = 0 ... Sunday = 6 (UTC). */
export const weekdayOf = (ms: number): number => (new Date(ms).getUTCDay() + 6) % 7;

// ---------------------------------------------------------------- tuning constants (decisions of Part C, one value each)

/** C1: an autonomous leg earns this share of what the same job pays when flown by the player. Costs are paid in full. */
export const AUTONOMY_FACTOR = 0.5;
/** C2: a paused or interrupted line costs nothing extra. */
export const PAUSED_LINE_COST_PER_DAY = 0;
/** C5: free up to 6 lines; beyond that an operations-centre building is needed (lot FACILITIES). Until it exists the cap is hard. */
export const MAX_LINES_PER_COMPANY = 6;
/** A request from the owner refreshes the offline clock at most this often. */
export const PRESENCE_STEP_MS = 60_000;
export const MAX_FREQ_PER_DAY = 48;
export const DEFAULT_TURNAROUND_MIN = 30;
export const FIRST_FLIGHT_NO = 1100;
/** Each line owns a block of flight numbers (a line flies at most 2 x MAX_FREQ_PER_DAY legs a day), so editing a programme never renumbers another line. */
export const FLIGHT_NO_BLOCK = 100;
/** `weeklyDemand` is calibrated so that large-large at 262 nm (the mockup's LFMN-LEBL) comes to 5 200 passengers a week. */
export const DEMAND_K = 893;
export const LOAD_FACTOR_MIN = 0.35;
export const LOAD_FACTOR_MAX = 0.95;
export const SLOT_LOSS_DAYS = 14;
/** Stored reputation points (0-100, C17). */
export const CANCELLED_LEG_REPUTATION = 0.02;
export const STOPPAGE_REPUTATION_FIRST_DAY = 2;
export const STOPPAGE_REPUTATION_NEXT_DAYS = 1;
export const WEAR_DELAY_FROM_PCT = 70;
export const WEAR_DELAY_STEP_PCT = 10;
export const WEAR_DELAY_STEP_MIN = 10;
export const MAX_DELAY_MIN = 180;
/** A leg that lands less than this late counts as on time. */
export const ON_TIME_LIMIT_MIN = 15;

// ---------------------------------------------------------------- programme

export const SIZE_WEIGHT: Record<AirportSize, number> = { small: 1, medium: 2, large: 4 };

export const hhmmToMin = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export const minToHhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Bit 0 = Monday ... bit 6 = Sunday. */
export const daysToMask = (days: readonly boolean[]): number => days.reduce((m, d, i) => (d ? m | (1 << i) : m), 0);
export const maskToDays = (mask: number): boolean[] => Array.from({ length: 7 }, (_, i) => (mask & (1 << i)) !== 0);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM (UTC)');
const airport = z.string().regex(/^[A-Z]{4}$/, 'ICAO airport code: 4 letters A-Z');

const programmeShape = {
  freqPerDay: z.int().min(1).max(MAX_FREQ_PER_DAY),
  days: z.array(z.boolean()).length(7),
  windowStart: hhmm,
  windowEnd: hhmm,
  turnaroundMin: z.int().min(15).max(240).optional(),
  aircraftIds: z.array(z.int().positive()).min(1).max(20),
};

/** Rules a whole programme must satisfy (also run on a PATCH after merging, server side). Null when valid. */
export function programmeProblem(p: { days: readonly boolean[]; windowStart: string; windowEnd: string; aircraftIds: readonly number[] }): string | null {
  if (!p.days.some(Boolean)) return 'days: at least one operating day';
  if (hhmmToMin(p.windowEnd) <= hhmmToMin(p.windowStart)) return 'windowEnd: must be after windowStart';
  if (new Set(p.aircraftIds).size !== p.aircraftIds.length) return 'aircraftIds: duplicates';
  return null;
}
const checked = <S extends z.ZodType<{ days: boolean[]; windowStart: string; windowEnd: string; aircraftIds: number[] }>>(s: S) =>
  s.superRefine((p, ctx) => { const m = programmeProblem(p); if (m) ctx.addIssue({ code: 'custom', message: m }); });

/** Body of `POST /lines/forecast` and `POST /lines`. */
export const lineBodySchema = checked(z.object({ a: airport, b: airport, ...programmeShape }));
export type LineBody = z.infer<typeof lineBodySchema>;
/** Body of `PATCH /lines/:id`: any of the programme fields (the merged programme is validated by the server). */
export const linePatchSchema = z.object(programmeShape).partial().refine((p) => Object.keys(p).length > 0, 'nothing to change');
export const lineResolveSchema = z.object({ option: z.enum(['reassign', 'recruit', 'pause']), aircraftId: z.int().positive().optional() });
export const networkEnabledSchema = z.object({ enabled: z.boolean() });
export const lineDayQuerySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const networkQuerySchema = z.object({ company: z.coerce.number().int().positive().optional() });

/** A line as stored: a pair of airports flown both ways on a daily programme. */
export type Programme = {
  a: string; b: string; flightBase: number; freqPerDay: number; days: number;
  windowStartMin: number; windowEndMin: number; turnaroundMin: number;
};
/** `home`: the airport where the aircraft starts each of its rotations (A or B of the line), so a rotation always ends where it began. */
export type PlannedAircraft = { id: number; blockMin: number; home: string };
export type PlannedLeg = { aircraftId: number; flightNo: number; dep: number; arr: number; origin: string; dest: string };

const snapDown = (min: number): number => Math.floor(min / 15) * 15;
const snapUp = (min: number): number => Math.ceil(min / 15) * 15;

/** The legs of the rotations that START on the UTC day `dayStartMs`: `freqPerDay` departures evenly across the window, each followed by
 *  its return after the block time and the turnaround. Aircraft are assigned round-robin. Departures sit on the 15-minute grid, so a
 *  tick resolves exactly the legs due in it. Flight numbers keep their direction (even A to B, odd B to A). Returns may spill past midnight. Pure. */
export function layoutDay(p: Programme, fleet: readonly PlannedAircraft[], dayStartMs: number): PlannedLeg[] {
  if (fleet.length === 0 || (p.days & (1 << weekdayOf(dayStartMs))) === 0) return [];
  const span = p.windowEndMin - p.windowStartMin;
  const lineBlock = Math.max(...fleet.map((f) => f.blockMin));
  const legs: PlannedLeg[] = [];
  for (let i = 0; i < p.freqPerDay; i++) {
    const ac = fleet[i % fleet.length]!;
    const outMin = snapDown(p.windowStartMin + Math.floor((i * span) / p.freqPerDay));
    const backMin = snapUp(outMin + lineBlock + p.turnaroundMin);
    const fromA = ac.home === p.a;
    const [from, to] = fromA ? [p.a, p.b] : [p.b, p.a];
    const base = p.flightBase + 2 * i;
    legs.push({ aircraftId: ac.id, flightNo: base + (fromA ? 0 : 1), dep: dayStartMs + outMin * 60_000, arr: dayStartMs + (outMin + ac.blockMin) * 60_000, origin: from, dest: to });
    legs.push({ aircraftId: ac.id, flightNo: base + (fromA ? 1 : 0), dep: dayStartMs + backMin * 60_000, arr: dayStartMs + (backMin + ac.blockMin) * 60_000, origin: to, dest: from });
  }
  return legs;
}

/** Pairs of legs of one aircraft that overlap (the next one leaves before the previous has landed and turned around). */
export function overlappingLegs<T extends PlannedLeg>(legs: readonly T[], turnaroundMin: number): [T, T][] {
  const out: [T, T][] = [];
  const byAircraft = new Map<number, T[]>();
  for (const l of legs) byAircraft.set(l.aircraftId, [...(byAircraft.get(l.aircraftId) ?? []), l]);
  for (const list of byAircraft.values()) {
    list.sort((x, y) => x.dep - y.dep);
    for (let i = 1; i < list.length; i++) if (list[i]!.dep < list[i - 1]!.arr + turnaroundMin * 60_000) out.push([list[i - 1]!, list[i]!]);
  }
  return out;
}

// ---------------------------------------------------------------- demand and load factor (B.2 items 4 and 5)

/** Passengers per week on a pair, both ways. */
export const weeklyDemand = (sizeA: AirportSize, sizeB: AirportSize, distanceNm: number): number =>
  Math.round((DEMAND_K * SIZE_WEIGHT[sizeA] * SIZE_WEIGHT[sizeB]) / (1 + distanceNm / 150));

/** Load factor of a line: the pair's demand shared by seats with rivals on the pair, over the line's own seats, clamped. 0 without seats. */
export function pairLoadFactor(demand: number, ownSeats: number, rivalSeats: number): number {
  if (ownSeats <= 0) return 0;
  const captured = (demand * ownSeats) / (ownSeats + rivalSeats);
  return Math.min(LOAD_FACTOR_MAX, Math.max(LOAD_FACTOR_MIN, captured / ownSeats));
}

/** Seats a line offers in a week (both directions): slot `i` is flown by aircraft `i mod n`, whose seat count is `seats[i mod n]`. */
export function weeklySeats(freqPerDay: number, daysMask: number, seats: readonly number[]): number {
  if (seats.length === 0) return 0;
  let day = 0;
  for (let i = 0; i < freqPerDay; i++) day += 2 * seats[i % seats.length]!;
  return day * maskToDays(daysMask).filter(Boolean).length;
}

/** Crew a type needs (B.3): two pilots, one cabin crew member per 40 seats. Lot STAFF owns the model; until it merges this only sizes the forecast. */
export const crewNeeded = (seats: number): { pilots: number; cabin: number } => ({ pilots: 2, cabin: Math.ceil(seats / 40) });

// ---------------------------------------------------------------- delays and stoppages (B.2 items 2 and 7)

/** +10 min per 10 points of wear from 70 % (explainable, no randomness). */
export const wearDelayMin = (wearPct: number): number =>
  wearPct >= WEAR_DELAY_FROM_PCT ? WEAR_DELAY_STEP_MIN * (1 + Math.floor((wearPct - WEAR_DELAY_FROM_PCT) / WEAR_DELAY_STEP_PCT)) : 0;

/** Delay a departure inherits: the previous leg lands `prevDelayMin` late, so the aircraft is ready `prevDelayMin + turnaround - gap` minutes
 *  after the planned departure (`gapMin` = planned departure minus planned arrival of the previous leg). */
export const inheritedDelayMin = (prevDelayMin: number, gapMin: number, turnaroundMin: number): number =>
  Math.max(0, prevDelayMin + turnaroundMin - gapMin);

/** Reputation lost at the UTC midnight `boundary` by a line interrupted since `since`: the first stoppage day costs more. Nothing before it started. */
export const stoppageReputation = (since: number, boundary: number): number =>
  since >= boundary ? 0 : dayStart(since) === boundary - DAY_MS ? STOPPAGE_REPUTATION_FIRST_DAY : STOPPAGE_REPUTATION_NEXT_DAYS;

/** Total reputation a stoppage that began at `since` has cost by `now` (every day boundary crossed). */
export function stoppageReputationTotal(since: number, now: number): number {
  let total = 0;
  for (let b = dayStart(since) + DAY_MS; b <= now; b += DAY_MS) total += stoppageReputation(since, b);
  return total;
}

// ---------------------------------------------------------------- wire types

export type LineStatus = 'active' | 'paused' | 'interrupted';
export type LineInterruptCause = 'aircraft' | 'crew' | 'both';
export type CancelCause = 'aircraft_unavailable' | 'no_crew' | 'duty_limit' | 'line_paused';
export type DelayCause = 'wear' | 'late_inbound';
/** `flying` is derived from the timetable and the clock, never stored. */
export type ScheduledFlightStatus = 'scheduled' | 'flying' | 'done' | 'delayed' | 'cancelled';

export type Line = {
  id: number; a: string; b: string; status: LineStatus; distanceNm: number; blockMinutes: number; freqPerDay: number; days: boolean[];
  windowStart: string; windowEnd: string; turnaroundMin: number;
  /** First and last flight number of the line (a line of 4 round trips uses 8 numbers). */
  flightNos: [number, number];
  aircraft: { id: number; registration: string; icao: string }[];
  interruptedSince: number | null; interruptCause: LineInterruptCause | null;
};

export type ScheduledFlight = {
  id: number; lineId: number | null; flightNo: string; dep: number; arr: number; origin: string; dest: string; aircraftId: number;
  status: ScheduledFlightStatus; delayMin: number; delayCause: DelayCause | null; cancelCause: CancelCause | null;
  pax: number | null; takenByPlayer: boolean;
};

export type LineDay = { date: string; rotations: number; loadFactor: number; planned: boolean };

export type LineForecast = {
  weeklyDemand: number; loadFactor: number; seatsPerWeek: number; revenue: number; costs: number; profit: number; estimated: true;
  competition: { company: string; flightsPerDay: number } | null;
};

export type LineProblem = { kind: 'aircraft' | 'crew'; detail: string; ready: boolean; until: number | null };

export type FlyingRow = { flightId: number; flightNo: string; lineId: number | null; from: string; to: string; progress: number; delayMin: number; reg: string; own: boolean };
export type NetworkView = {
  now: number; enabled: boolean;
  /** When the 14-day offline cap (C1) last stopped this network; null if it never did. */
  lapsedAt: number | null;
  lines: Line[]; flying: FlyingRow[];
  /** `onTimePct` is null until a leg of the day has flown. */
  today: { done: number; cancelled: number; onTimePct: number | null; nextDeparture: ScheduledFlight | null };
};

export type LineDetail = {
  line: Line; week: LineDay[]; day: ScheduledFlight[];
  /** `loadFactor` is a ratio (0-1). Without a finished leg in the last 7 days the money figures are the model's expectation (`estimated`). */
  kpis: { aircraft: number; freq: string; loadFactor: number; loadTrend7d: number; revenuePerDay: number; marginPerDay: number; estimated: boolean };
  /** Of the selected day. `crews` is 0 until lot STAFF; `margin = revenue - fuel - fees - crews - maintenance`. */
  pnl: { revenue: number; fuel: number; fees: number; crews: number; maintenance: number; margin: number; flights: number; pax: number };
  depends: { key: 'aircraft' | 'crew' | 'maintenance' | 'network'; label: string; value: string; ok: boolean }[];
};

export type LineForecastView = {
  forecast: LineForecast;
  conflicts: { aircraftId: number; flightNo: number; at: number }[];
  /** Why the programme cannot be created now (codes of `POST /lines` errors); empty when `valid`. */
  problems: string[];
  needs: {
    pilots: { required: number; available: number }; cabin: { required: number; available: number };
    ground: { required: number; available: number; missingAt: string[] }; maintenance: string;
  };
  /** False until lot STAFF merges: `available` then mirrors `required` and the crew check never cancels a leg. */
  crewModelled: boolean;
  valid: boolean;
};

export type FreeAircraft = { id: number; registration: string; icao: string; freeAt: number };
export type LineProblemView = {
  problem: LineProblem[];
  /** `reputation` is in stored points and negative (a loss); `slotsLostAt` is when 14 days of stoppage forfeit the slots (informational: nothing is deleted). */
  cost: { cancelled: number; lostRevenue: number; perDay: number; reputation: number; slotsLostAt: number | null };
  options: {
    reassign: { aircraft: FreeAircraft[]; flightsPerDay: number; deltaPerDay: number } | null;
    recruit: { candidates: number; monthly: number; readyAt: number | null } | null;
    pause: { fixedCostPerDay: number };
  };
  /** `off`: a day the line does not operate. */
  projection: { date: string; status: 'assured' | 'stopped' | 'off' }[];
};

/** `upcoming` also lists today's cancelled legs (with their cause); the player's own active flight is a `flying` row with `own: true` and `lineId: null`. */
export type OpsRow = ScheduledFlight & { reg: string; typeName: string; crew: string | null; note: string | null; own: boolean };
export type OpsView = {
  now: number; enabled: boolean;
  counts: { flying: number; upcoming: number; cancelled: number; delayed: number };
  flying: OpsRow[]; upcoming: OpsRow[];
};
