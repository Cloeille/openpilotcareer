// Contract of the bridge core: what the simulator tells us (SimSample) and what the core concludes (phases, flags, outcome).
// SimSample is a trust boundary (sim host and fixture files), hence the zod schema is the single definition.
import { z } from 'zod';
import type { Telemetry } from '@opc/shared';

export const PHASES = ['preflight', 'taxiOut', 'airborne', 'landed', 'parked'] as const;
export type Phase = (typeof PHASES)[number];

export const ENGINE_KINDS = ['piston', 'turboprop', 'jet', 'helicopter', 'other'] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

/** `reload`: SimConnect's FlightLoaded event. `reconnect`: the sim quit or the link closed, and the bridge connected again (the sim may have crashed). */
export const RESUMES = ['reload', 'reconnect'] as const;
export type Resume = (typeof RESUMES)[number];

const finite = z.number().refine(Number.isFinite, 'must be finite');

/** One reading of the user aircraft. Units are fixed here so the core never converts: knots, feet/minute, kilograms. */
export const simSampleSchema = z.object({
  /** Host wall clock, ms since epoch. Becomes takeoffAt/landedAt in the report. */
  t: z.number().int().positive(),
  onGround: z.boolean(),
  lat: finite.pipe(z.number().min(-90).max(90)),
  lon: finite.pipe(z.number().min(-180).max(180)),
  groundSpeedKts: finite.pipe(z.number().min(0)),
  verticalSpeedFpm: finite,
  /** Latched touchdown rate of the last landing, only present on samples where the host saw it change. Any sign. */
  touchdownFpm: finite.optional(),
  fuelKg: finite.pipe(z.number().min(0)),
  totalWeightKg: finite.pipe(z.number().min(0)),
  emptyWeightKg: finite.pipe(z.number().min(0)).optional(),
  simRate: finite.pipe(z.number().positive()),
  slew: z.boolean(),
  paused: z.boolean(),
  /** SimVar ATC MODEL: either a bare ICAO designator or MSFS's `TT:ATCCOM.AC_MODEL_<ICAO>.0.text` token. */
  atcModel: z.string().max(200),
  title: z.string().max(200),
  engineKind: z.enum(ENGINE_KINDS),
  /** PLANE ALT ABOVE GROUND. Absent in recordings that predate it, and when the SimVar is garbage: the low-altitude descent rule then does not apply. */
  aglFt: finite.optional(),
  /** Only present when true: MSFS says the aircraft crashed (Crashed event, CRASH FLAG or CRASH SEQUENCE). Stays set until a flight is loaded. */
  crashed: z.boolean().optional(),
  /** Set by the host on the first reading after the track was broken from the host's side: a flight was (re)loaded in the running sim, or the link to the sim was lost and re-established. */
  resumed: z.enum(RESUMES).optional(),
  /** Live telemetry only (never used by the tracker): absent in recordings that predate it, and when the SimVar is garbage. */
  altFt: finite.optional(),
  headingDeg: finite.optional(),
  /** One entry per engine; a gauge the aircraft does not have is left out, never zero-filled. */
  engines: z.array(z.object({ torquePct: finite.optional(), n1Pct: finite.optional(), ittC: finite.optional(), oilPsi: finite.optional() })).max(8).optional(),
});
export type SimSample = z.infer<typeof simSampleSchema>;

/** Anti-cheat flag names are part of the panel contract (shown verbatim in the in-sim panel). */
export const FLAGS = ['slew_detected', 'time_acceleration_above_1x', 'teleport_jump_over_50nm', 'long_pause', 'reload_after_crash'] as const;
export type Flag = (typeof FLAGS)[number];

/** Final verdict of one flight: a report to send to the server, or the reason there is nothing to send. */
export type Outcome = { ok: true; report: Telemetry } | { ok: false; reason: string };

export type TrackerOptions = {
  /** ICAO type designator to report when ATC MODEL is not a valid designator (e.g. add-on aircraft). */
  aircraftIcao?: string;
};
