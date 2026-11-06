// Live position for the web app: every ~2 s of flight time the current sample is posted to POST /flights/:id/live.
// Best effort by design. push() is synchronous and never throws, at most one request is in flight, and a network error,
// a slow server or an old server without the route can never delay or break the flight tracker.
import { distanceNm, liveSampleSchema, type LiveSample } from '@opc/shared';
import { ApiError, type ServerClient } from './client.ts';
import type { Flag, Phase, SimSample } from './types.ts';

export const LIVE_INTERVAL_MS = 2_000;
const MOVED_NM = 0.01;              // below this the aircraft is standing still: keep the last heading
const MAX_INTEGRATION_S = 10;       // never integrate over a longer gap (pause, stalled sim)

/** Heading and altitude for recordings that carry none (the synthetic fixtures): heading from the track between two
 *  positions, altitude from the integrated vertical speed (0 on the ground, so it is relative to the field, not MSL).
 *  A live SimConnect sample brings both from the simulator and this is not used. */
export class TrackEstimator {
  #prev: SimSample | null = null;
  #heading = 0;
  #alt = 0;

  at(s: SimSample): { altFt: number; headingDeg: number } {
    const prev = this.#prev;
    this.#prev = s;
    if (prev) {
      if (distanceNm(prev.lat, prev.lon, s.lat, s.lon) >= MOVED_NM) this.#heading = bearingDeg(prev, s);
      this.#alt += (s.verticalSpeedFpm * Math.min(MAX_INTEGRATION_S, Math.max(0, (s.t - prev.t) / 1000))) / 60;
    }
    if (s.onGround) this.#alt = 0;
    this.#alt = Math.max(0, this.#alt);
    return { altFt: Math.round(this.#alt), headingDeg: Math.round(this.#heading * 10) / 10 };
  }
}

export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLon = (b.lon - a.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLon);
  return (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
}

const mod360 = (deg: number): number => ((deg % 360) + 360) % 360;
const round = (n: number, digits = 0): number => Math.round(n * 10 ** digits) / 10 ** digits;

/** The wire sample for one SimSample, or null when it does not fit the contract (garbage SimVar): the sample is skipped, not repaired. */
export function toLiveSample(s: SimSample, phase: Phase, flags: readonly Flag[], track: { altFt: number; headingDeg: number }): LiveSample | null {
  const candidate = {
    t: s.t,
    lat: s.lat,
    lon: s.lon,
    altFt: round(s.altFt ?? track.altFt),
    gsKts: round(s.groundSpeedKts, 1),
    vsFpm: round(s.verticalSpeedFpm),
    headingDeg: round(mod360(s.headingDeg ?? track.headingDeg), 1),
    fuelKg: round(s.fuelKg, 1),
    phase,
    paused: s.paused,
    simRate: s.simRate,
    flags: [...flags],
    engines: (s.engines ?? []).map((e) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))),
  };
  const parsed = liveSampleSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export type LiveReporterOptions = {
  client: Pick<ServerClient, 'postLive'>;
  flightId: number;
  intervalMs?: number;
  log?: (line: string) => void;
};

export class LiveReporter {
  readonly #o: LiveReporterOptions;
  readonly #track = new TrackEstimator();
  #lastSentT: number | null = null;
  #lastPhase: Phase | null = null;
  #inFlight: Promise<void> | null = null;
  #stopped = false;
  #failing = false;
  #skipped = 0;
  #sent = 0;

  constructor(o: LiveReporterOptions) { this.#o = o; }

  /** Posts so far that the server accepted. */
  get sent(): number { return this.#sent; }
  /** True once the server said it will never take live samples for this flight (unknown route or flight, closed flight, key refused). */
  get stopped(): boolean { return this.#stopped; }
  /** Resolves when the request in flight (if any) is done. For tests and for a clean exit. */
  get idle(): Promise<void> { return this.#inFlight ?? Promise.resolve(); }

  push(s: SimSample, phase: Phase, flags: readonly Flag[]): void {
    try {
      const track = this.#track.at(s); // every sample, so the heading/altitude estimate keeps up between posts
      if (this.#stopped || this.#inFlight) return;
      const due = this.#lastSentT === null || s.t - this.#lastSentT >= (this.#o.intervalMs ?? LIVE_INTERVAL_MS) || phase !== this.#lastPhase;
      if (!due) return;
      const sample = toLiveSample(s, phase, flags, track);
      if (!sample) {
        if (this.#skipped++ === 0) this.#o.log?.('live position: skipping a reading the simulator sent that is not valid');
        return;
      }
      this.#lastSentT = s.t;
      this.#lastPhase = phase;
      this.#inFlight = this.#post(sample).finally(() => { this.#inFlight = null; });
    } catch (e) {
      this.#o.log?.(`live position: ${(e as Error).message}`); // never let live telemetry reach the tracker
    }
  }

  async #post(sample: LiveSample): Promise<void> {
    try {
      await this.#o.client.postLive(this.#o.flightId, sample);
      this.#sent++;
      if (this.#failing) { this.#failing = false; this.#o.log?.('live position: server reachable again'); }
    } catch (e) {
      if (!(e instanceof ApiError)) return void this.#o.log?.(`live position: ${(e as Error).message}`);
      if (e.status === 429) return; // sent faster than the server accepts (a replay at high speed): the next sample replaces this one
      if (e.status === 401 || e.status === 403) return this.#stop('the server refused the API key');
      if (e.status === 404) return this.#stop('this server has no live position for the flight (older server, or not your flight)');
      if (e.status === 409) return this.#stop('the flight is already closed');
      if (e.status === 400) return void (this.#skipped++ === 0 && this.#o.log?.(`live position: the server refused a sample (${e.message})`));
      if (!this.#failing) { this.#failing = true; this.#o.log?.(`live position not reaching the server (${e.message}); still flying, will keep trying`); }
    }
  }

  #stop(why: string): void {
    this.#stopped = true;
    this.#o.log?.(`live position stopped: ${why}`);
  }
}
