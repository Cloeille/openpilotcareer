import { fuelBurnKg, type AircraftType, type Flight, type FleetAircraft, type Job } from '@opc/shared';
import type { LiveEngine, LiveResponse, LiveSample } from './api-live.ts';

// View-model of the live screens: what GET /flights/:id/live says, turned into the figures the screens show. No DOM, no language.

export const POLL_MS = 2000;
const TIME_ACCEL_RATE = 1.01;
const TRANSITION_FT = 18_000;

export type Phase = 'preflight' | 'taxi' | 'climb' | 'cruise' | 'descent' | 'airborne' | 'landed' | 'parked' | 'unknown';
const CLIMB_FPM = 300;
const CRUISE_MIN_FT = 10_000;

/** The bridge reports preflight / taxiOut / airborne / landed / parked; airborne is split by vertical speed so a cruise reads as a cruise. */
export function phaseOf(s: Pick<LiveSample, 'phase' | 'vsFpm' | 'altFt'> | null): Phase {
  if (!s) return 'unknown';
  switch (s.phase) {
    case 'preflight': case 'landed': case 'parked': return s.phase;
    case 'taxiOut': case 'taxi': return 'taxi';
    case 'airborne':
      if (s.vsFpm > CLIMB_FPM) return 'climb';
      if (s.vsFpm < -CLIMB_FPM) return 'descent';
      return s.altFt >= CRUISE_MIN_FT ? 'cruise' : 'airborne';
    default: return 'unknown';
  }
}

export type Altitude = { kind: 'fl'; level: number } | { kind: 'ft'; ft: number };
/** `FL240` from the transition altitude up, feet below. */
export const altitudeOf = (altFt: number): Altitude => (altFt >= TRANSITION_FT ? { kind: 'fl', level: Math.round(altFt / 100) } : { kind: 'ft', ft: Math.max(0, Math.round(altFt / 10) * 10) });
export const flightLevelLabel = (level: number): string => `FL${String(level).padStart(3, '0')}`;

export const CHECK_IDS = ['slew', 'timeAccel', 'pause', 'jumps'] as const;
export type CheckId = (typeof CHECK_IDS)[number];
export type CheckState = 'ok' | 'flagged' | 'unknown';
export type Check = { id: CheckId | 'other'; state: CheckState; raw?: string };
const FLAG_CHECK: Record<string, CheckId> = { slew_detected: 'slew', time_acceleration_above_1x: 'timeAccel', long_pause: 'pause', teleport_jump_over_50nm: 'jumps' };

/** The anti-cheat checks list: one row per known flag, red once the bridge raised it; flags this client does not know are listed as they came. */
export function checksOf(s: Pick<LiveSample, 'flags' | 'simRate'> | null): Check[] {
  if (!s) return CHECK_IDS.map((id) => ({ id, state: 'unknown' as const }));
  const raised = new Set(s.flags.map((f) => FLAG_CHECK[f]).filter((c): c is CheckId => c !== undefined));
  if (s.simRate > TIME_ACCEL_RATE) raised.add('timeAccel');
  const known: Check[] = CHECK_IDS.map((id) => ({ id, state: raised.has(id) ? 'flagged' : 'ok' }));
  const other: Check[] = s.flags.filter((f) => !(f in FLAG_CHECK)).map((raw) => ({ id: 'other', state: 'flagged', raw }));
  return [...known, ...other];
}

export type EngineVm = { index: number; dial: { value: number; unit: 'torque' | 'n1' } | null; n1Pct: number | null; ittC: number | null; oilPsi: number | null };
export const engineVm = (e: LiveEngine, index: number): EngineVm => ({
  index, dial: e.torquePct !== undefined ? { value: e.torquePct, unit: 'torque' } : e.n1Pct !== undefined ? { value: e.n1Pct, unit: 'n1' } : null,
  n1Pct: e.n1Pct ?? null, ittC: e.ittC ?? null, oilPsi: e.oilPsi ?? null,
});

export type LiveFacts = {
  sample: LiveSample | null;
  receivedAt: number | null;
  lost: boolean;
  /** Milliseconds since the last sample, or null when none ever came. */
  silentMs: number | null;
  phase: Phase;
  altitude: Altitude | null;
  gsKts: number | null;
  fuelKg: number | null;
  remainingNm: number | null;
  etaAt: number | null;
  checks: Check[];
  engines: EngineVm[];
};

export function liveFacts(r: LiveResponse | null, now: number): LiveFacts {
  const s = r?.sample ?? null;
  return {
    sample: s, receivedAt: r?.receivedAt ?? null, lost: r?.bridgeLost ?? false,
    silentMs: r?.receivedAt != null ? Math.max(0, now - r.receivedAt) : null,
    phase: phaseOf(s), altitude: s ? altitudeOf(s.altFt) : null, gsKts: s ? Math.round(s.gsKts) : null, fuelKg: s ? Math.round(s.fuelKg) : null,
    remainingNm: r?.remainingNm ?? null, etaAt: r?.etaAt ?? null, checks: checksOf(s), engines: (s?.engines ?? []).map(engineVm),
  };
}

/** How much of the route is behind the aircraft, 0..1; null when the remaining distance is unknown. */
export const progressOf = (distanceNm: number, remainingNm: number | null): number | null =>
  remainingNm === null || distanceNm <= 0 ? null : Math.min(1, Math.max(0, 1 - remainingNm / distanceNm));

export type FuelVm = {
  onBoardKg: number;
  /** Tank scale: the fuel a full-range flight of the type burns. A derived figure (the API does not give tank capacity). */
  scaleKg: number; fraction: number;
  /** Derived from the type's burn rate and the current speed. */
  enduranceH: number | null; arrivalKg: number | null;
};

export function fuelVm(type: AircraftType, fuelKg: number, gsKts: number | null, remainingNm: number | null): FuelVm {
  const perNm = fuelBurnKg(type, 1);
  const scaleKg = Math.max(fuelKg, fuelBurnKg(type, type.rangeNm));
  const speed = gsKts !== null && gsKts > 40 ? gsKts : type.cruiseKts;
  return {
    onBoardKg: fuelKg, scaleKg, fraction: scaleKg > 0 ? Math.min(1, fuelKg / scaleKg) : 0,
    enduranceH: perNm > 0 ? fuelKg / (perNm * speed) : null,
    arrivalKg: remainingNm === null ? null : Math.max(0, Math.round(fuelKg - perNm * remainingNm)),
  };
}

export type LoadVm = { payloadKg: number; capacityKg: number; carriedKg: number | null };
/** Payload (the job's) and what is carried now: payload plus the live fuel. Empty weight is not known, so this is not the aircraft mass. */
export const loadVm = (job: Pick<Job, 'payloadKg'>, capacityKg: number, fuelKg: number | null): LoadVm =>
  ({ payloadKg: job.payloadKg, capacityKg, carriedKg: fuelKg === null ? null : job.payloadKg + fuelKg });

/** Wear thresholds of the ring colour: amber then red. */
export const WEAR_WARN_PCT = 35;
export const WEAR_DANGER_PCT = 70;
export const wearLevel = (pct: number): 'ok' | 'warn' | 'danger' => (pct >= WEAR_DANGER_PCT ? 'danger' : pct >= WEAR_WARN_PCT ? 'warn' : 'ok');

/** Fields other lots add to FleetAircraft / Company (contract FINANCE, START): read defensively until they are merged. */
export type AircraftExtras = { registration?: string | null; wearPct?: number | null };
export const aircraftExtras = (a: object | undefined): AircraftExtras => (a ?? {}) as AircraftExtras;
export type CompanyExtras = { callsign?: string | null; code?: string | null };
export const companyExtras = (c: object): CompanyExtras => c as CompanyExtras;

// ------------------------------------------------------------------ gauges

/** Engine dial: a 270 degree sweep opening at the bottom, 0..DIAL_MAX percent, red from the redline up. */
export const DIAL_MAX = 110;
export const DIAL_REDLINE = 100;
const SWEEP = 0.75;
/** `stroke-dasharray`/`stroke-dashoffset` for an arc of a circle of radius `r` that spans [fromPct, toPct] of the dial, drawn after rotating the circle by 135 degrees. */
export function arcDash(r: number, fromPct: number, toPct: number, max = DIAL_MAX): { dasharray: string; dashoffset: number } {
  const c = 2 * Math.PI * r;
  const clamp = (v: number): number => Math.min(max, Math.max(0, v));
  const a = clamp(fromPct);
  const b = clamp(toPct);
  const len = Math.max(0, ((b - a) / max) * SWEEP * c);
  return { dasharray: `${len.toFixed(2)} ${c.toFixed(2)}`, dashoffset: -((a / max) * SWEEP * c) };
}
/** Full ring (wear): `stroke-dasharray` for pct percent of the circumference, drawn from the top. */
export const ringDash = (r: number, pct: number): string => {
  const c = 2 * Math.PI * r;
  return `${((Math.min(100, Math.max(0, pct)) / 100) * c).toFixed(2)} ${c.toFixed(2)}`;
};

const RUNNING_MIN_PCT = 5;
/** An engine whose torque (or N1) is at or above 5 percent is counted as running. */
export const enginesRunning = (engines: EngineVm[]): number => engines.filter((e) => (e.dial?.value ?? 0) >= RUNNING_MIN_PCT).length;

/** `17:58:12Z`. */
export const zuluSeconds = (ms: number): string => `${new Date(ms).toISOString().slice(11, 19)}Z`;

// ------------------------------------------------------------------ what the live screens share

export type LiveViewId = 'cutaway' | 'cabin' | 'systems';
export const LIVE_VIEWS: readonly LiveViewId[] = ['cutaway', 'cabin', 'systems'];
export const nextView = (v: LiveViewId): LiveViewId => LIVE_VIEWS[(LIVE_VIEWS.indexOf(v) + 1) % LIVE_VIEWS.length]!;

/** Everything a live view knows about the flight that does not change while it is open. */
export type LiveCtx = {
  flight: Flight; type: AircraftType; aircraft: FleetAircraft | undefined;
  registration: string | null; wearPct: number | null;
  /** `AZR 4127` when the company has a callsign (contract START), `Flight #12` otherwise. */
  flightLabel: string;
  /** City names of the route ends, ICAO codes while unknown. */
  from: string; to: string;
};
/** One of the three views: its element, and how it follows the live data (called after every poll). */
export type Body = { el: HTMLElement; update: (f: LiveFacts) => void };

/** Callsign and flight id, `AZR 4127`; null without a callsign. */
export const callsignLabel = (callsign: string | null | undefined, flightId: number): string | null => (callsign ? `${callsign} ${flightId}` : null);
