// Lot LIVE: live flight telemetry. A bridge posts a LiveSample every couple of seconds while the player flies;
// the web app reads the latest one back. Nothing here is persisted except `flights.last_live_at`.
import { z } from 'zod';
import { distanceNm } from './index.ts';

/** Same phases the bridge tracker walks through (sim/bridge/src/types.ts). */
export const LIVE_PHASES = ['preflight', 'taxiOut', 'airborne', 'landed', 'parked'] as const;
export type LivePhase = (typeof LIVE_PHASES)[number];

/** At most one accepted sample per flight per this many ms. */
export const LIVE_MIN_INTERVAL_MS = 1_000;
/** An active flight whose last sample is older than this has lost its bridge. */
export const LIVE_BRIDGE_LOST_MS = 30_000;
/** Below this ground speed (or on the ground) no ETA is given. */
export const LIVE_ETA_MIN_GS_KTS = 30;
export const LIVE_MAX_ENGINES = 8;

const range = (min: number, max: number) => z.number().min(min).max(max);

/** Engine gauges the sim exposes for this aircraft. A gauge the aircraft does not have is omitted, never zero-filled. */
export const liveEngineSchema = z.object({
  torquePct: range(0, 300).optional(),
  n1Pct: range(0, 200).optional(),
  ittC: range(-100, 2_500).optional(),
  oilPsi: range(0, 500).optional(),
});
export type LiveEngine = z.infer<typeof liveEngineSchema>;

/** Trust boundary of `POST /flights/:id/live`. Units: feet, knots, feet/minute, degrees, kilograms, degrees Celsius, psi. */
export const liveSampleSchema = z.object({
  /** Bridge host clock, ms since epoch. Informational: the server stamps its own receive time. */
  t: z.number().int().positive(),
  lat: range(-90, 90),
  lon: range(-180, 180),
  altFt: range(-2_000, 100_000),
  gsKts: range(0, 3_000),
  vsFpm: range(-30_000, 30_000),
  headingDeg: range(0, 360),
  fuelKg: range(0, 1_000_000),
  phase: z.enum(LIVE_PHASES),
  paused: z.boolean(),
  simRate: z.number().positive().max(128),
  /** Anti-cheat flags the bridge has raised so far (same names as telemetry). */
  flags: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(16),
  engines: z.array(liveEngineSchema).max(LIVE_MAX_ENGINES),
});
export type LiveSample = z.infer<typeof liveSampleSchema>;

/** `GET /flights/:id/live`. */
export type LiveState = {
  sample: LiveSample | null;
  /** Server clock when the latest sample arrived (persisted `last_live_at` when the sample itself was lost in a restart). */
  receivedAt: number | null;
  bridgeLost: boolean;
  remainingNm: number | null;
  etaAt: number | null;
};

/** True when a flight that WAS reporting has been silent for more than the bridge-lost delay. A flight that never reported is not "lost": it is waiting for its bridge. */
export const isBridgeLost = (receivedAt: number | null, now: number): boolean => receivedAt !== null && now - receivedAt > LIVE_BRIDGE_LOST_MS;

/** Great-circle distance still to fly and the arrival time at the current ground speed. `etaAt` is only given in flight (airborne, not paused, fast enough). */
export function liveProgress(sample: LiveSample, receivedAt: number, destination: { lat: number; lon: number } | null): { remainingNm: number | null; etaAt: number | null } {
  if (!destination) return { remainingNm: null, etaAt: null };
  const nm = distanceNm(sample.lat, sample.lon, destination.lat, destination.lon);
  const flying = sample.phase === 'airborne' && !sample.paused && sample.gsKts >= LIVE_ETA_MIN_GS_KTS;
  // at a sim rate above 1x the same distance takes proportionally less wall-clock time
  const etaAt = flying ? Math.round(receivedAt + (nm / sample.gsKts / sample.simRate) * 3_600_000) : null;
  return { remainingNm: Math.round(nm * 10) / 10, etaAt };
}
