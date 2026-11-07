// Pure flight tracker: feed it SimSamples in time order, it walks preflight -> taxiOut -> airborne -> landed -> parked,
// raises anti-cheat flags, and at `parked` produces the Telemetry report (or the reason there is none).
// No I/O and no SimConnect: everything here is testable from recorded sample streams.
import { distanceNm, icaoTypeSchema, telemetrySchema } from '@opc/shared';
import { nearestAirport } from './airports.ts';
import type { Flag, Outcome, Phase, SimSample, TrackerOptions } from './types.ts';

const MOVING_KTS = 5;               // ground speed that ends `preflight`
const LIFTOFF_CONFIRM_MS = 3_000;   // off the ground this long = airborne (ignores a single "on ground" flicker)
const LANDED_KTS = 30;              // a ground contact slower than this is a landing; faster is a touch-and-go or bounce
const LANDED_KTS_HELICOPTER = 5;    // helicopters stop on touchdown instead of rolling out
const PARKED_KTS = 1;
const PARK_HOLD_MS = 30_000;
const AIRPORT_MATCH_NM = 10;        // takeoff/landing farther than this from every known airport is off-airport
const TELEPORT_NM = 50;
const TELEPORT_MIN_KTS = 1_500;     // jump must also be faster than anything flyable, so a long sample gap is not a teleport
const LONG_PAUSE_MS = 15 * 60_000;
const RATE_EPSILON = 1.01;
// Reloads and game crashes are allowed (a flight can be reloaded from an earlier save, a sim can crash), see #checkTrack.
const RELOAD_NM = 5;                    // a reload lands this close to a recorded point of the flight (or its departure); a position move must exceed it to count as a jump
const BREADCRUMB_NM = 1;                // one recorded point of the track per nm flown
const CRASH_LOOKBACK_MS = 10_000;       // a reload within this long of a crash or violent descent (measured on sim time before the break) is a reload after a crash
const VIOLENT_DESCENT_FPM = -6_000;     // vertical speed below this is a violent descent at any height
const LOW_DESCENT_FPM = -2_500;         // below this, under LOW_DESCENT_AGL_FT above ground: no approach sinks that fast that close to the terrain
const LOW_DESCENT_AGL_FT = 1_000;

/** ATC MODEL is a bare designator ("C172") or a localisation token ("TT:ATCCOM.AC_MODEL_A20N.0.text"). */
const ATC_MODEL = /^(?:TT:ATCCOM\.AC_MODEL[_ ])?([A-Z0-9]{2,4})(?:\.\d+\.TEXT)?$/;
export function designatorOf(atcModel: string): string | null {
  const m = ATC_MODEL.exec(atcModel.trim().toUpperCase());
  return m?.[1] && icaoTypeSchema.safeParse(m[1]).success ? m[1] : null;
}

type Snapshot = Pick<SimSample, 't' | 'lat' | 'lon' | 'fuelKg' | 'totalWeightKg' | 'emptyWeightKg' | 'atcModel'>;
const snap = (s: SimSample): Snapshot => ({ t: s.t, lat: s.lat, lon: s.lon, fuelKg: s.fuelKg, totalWeightKg: s.totalWeightKg, emptyWeightKg: s.emptyWeightKg, atcModel: s.atcModel });

type Crumb = { lat: number; lon: number; nm: number };   // a point of the recorded track and the distance flown to reach it
const crashedOrViolent = (s: SimSample): boolean =>
  s.crashed === true || s.verticalSpeedFpm < VIOLENT_DESCENT_FPM || (s.aglFt !== undefined && s.aglFt < LOW_DESCENT_AGL_FT && s.verticalSpeedFpm < LOW_DESCENT_FPM);

/** A ground contact while airborne: a landing if the aircraft slows down, a touch-and-go if it takes off again. */
type Contact = Snapshot & { distanceNm: number; approachFpm: number; touchdownFpm: number | undefined };

export class FlightTracker {
  #phase: Phase = 'preflight';
  #flags = new Set<Flag>();
  #outcome: Outcome | null = null;
  #prev: SimSample | null = null;
  #firstOff: Snapshot | null = null;     // first off-ground sample of the current liftoff attempt
  #takeoff: Snapshot | null = null;
  #flownNm = 0;
  #contact: Contact | null = null;
  #stoppedSince: number | null = null;
  #pausedSince: number | null = null;
  #crumbs: Crumb[] = [];                 // [0] is the departure; the rest is the track flown, one point per BREADCRUMB_NM
  #badAt: number | null = null;          // sample time of the latest crash or violent descent since the last break of the track
  #reloads = 0;
  #restarts = 0;
  #downtimeMs = 0;

  readonly #opts: TrackerOptions;
  constructor(opts: TrackerOptions = {}) { this.#opts = opts; }

  get phase(): Phase { return this.#phase; }
  get flags(): Flag[] { return [...this.#flags]; }
  /** Set once, when the aircraft parks. Null before that. */
  get outcome(): Outcome | null { return this.#outcome; }

  feed(s: SimSample): void {
    const prev = this.#prev;
    if (this.#phase === 'parked' || (prev && s.t <= prev.t)) return; // finished, or out-of-order reading
    if (this.#phase === 'preflight') this.#crumbs = [{ lat: s.lat, lon: s.lon, nm: 0 }]; // the departure is where the aircraft stood when the flight began
    const rewound = this.#phase !== 'preflight' && this.#checkCheating(s, prev);
    switch (this.#phase) {
      case 'preflight': case 'taxiOut': this.#onGroundOrLiftoff(s); break;
      case 'airborne': this.#airborne(s, rewound ? null : prev); break; // a reload is not distance flown
      case 'landed': this.#landed(s); break;
    }
    if (crashedOrViolent(s)) this.#badAt = s.t;
    this.#prev = s;
  }

  #flag(f: Flag): void { this.#flags.add(f); }

  /** Raises the flags `s` deserves. True when `s` is a reload that rewound the flight to an earlier point. */
  #checkCheating(s: SimSample, prev: SimSample | null): boolean {
    if (s.slew) this.#flag('slew_detected');
    if (s.simRate > RATE_EPSILON) this.#flag('time_acceleration_above_1x');
    const rewound = prev !== null && this.#checkTrack(s, prev);
    if (s.paused) {
      this.#pausedSince ??= s.t;
      if (s.t - this.#pausedSince > LONG_PAUSE_MS) this.#flag('long_pause');
    } else {
      this.#pausedSince = null;
    }
    return rewound;
  }

  /** Was `s` flown to from `prev`? A break of the track is a position jump faster than anything flyable, or the host saying the flight
   *  was reloaded (FlightLoaded) or the sim restarted (the link dropped and came back). The time the sim was away is downtime, not a long pause.
   *  A break that lands back on the recorded track is a reload of an earlier save: allowed, and the flight is rewound to that point.
   *  Anywhere else it is a teleport when it is far. Reloading right after a crash or a violent descent is `reload_after_crash`, always.
   *  True when the flight was rewound. */
  #checkTrack(s: SimSample, prev: SimSample): boolean {
    const gapMs = s.t - prev.t;
    const nm = distanceNm(prev.lat, prev.lon, s.lat, s.lon);
    if (!s.resumed && gapMs > LONG_PAUSE_MS) this.#flag('long_pause'); // the sim (or the bridge) was away for a long time, and the host did not say why
    const moved = nm > RELOAD_NM;
    if (!s.resumed && !(moved && nm / (gapMs / 3_600_000) > TELEPORT_MIN_KTS)) return false;
    // back on the track? A break that left the aircraft where it was has nothing to rewind, except that a reload before takeoff starts over
    const back = moved ? this.#nearestCrumb(s) : this.#takeoff ? -1 : 0;
    if (moved && back < 0 && nm > TELEPORT_NM) this.#flag('teleport_jump_over_50nm'); // forward, off the track: the sim jumped too fast to have flown it
    if (s.resumed || back >= 0) {
      if (s.resumed === 'reconnect') this.#restarts++; else this.#reloads++;
      if (s.resumed) this.#downtimeMs += gapMs;
      if (this.#badAt !== null && prev.t - this.#badAt <= CRASH_LOOKBACK_MS) this.#flag('reload_after_crash');
    }
    this.#badAt = null;
    if (back < 0) return false;
    this.#rewind(back);
    return true;
  }

  /** Index of the recorded point closest to `s` and within RELOAD_NM of it, else -1. */
  #nearestCrumb(s: SimSample): number {
    let best = -1, bestNm = RELOAD_NM;
    this.#crumbs.forEach((c, i) => {
      const d = distanceNm(c.lat, c.lon, s.lat, s.lon);
      if (d <= bestNm) { best = i; bestNm = d; }
    });
    return best;
  }

  /** Back to the state at recorded point `i`; the points after it belong to a timeline that no longer exists, so a jump back onto them is a teleport. */
  #rewind(i: number): void {
    this.#crumbs.length = i + 1;
    this.#flownNm = this.#crumbs[i]!.nm;
    this.#firstOff = this.#contact = this.#stoppedSince = null;
    if (i === 0) { this.#phase = 'preflight'; this.#takeoff = null; } else this.#phase = 'airborne';
  }

  /** preflight/taxiOut share liftoff detection, so a helicopter can lift from a hover without ever taxiing. */
  #onGroundOrLiftoff(s: SimSample): void {
    if (s.onGround) {
      this.#firstOff = null;
      if (this.#phase === 'preflight' && s.groundSpeedKts >= MOVING_KTS) this.#phase = 'taxiOut';
      return;
    }
    this.#firstOff ??= snap(s);
    if (s.t - this.#firstOff.t >= LIFTOFF_CONFIRM_MS) {
      this.#takeoff = this.#firstOff;
      this.#flownNm = distanceNm(this.#firstOff.lat, this.#firstOff.lon, s.lat, s.lon);
      this.#phase = 'airborne';
    }
  }

  #airborne(s: SimSample, prev: SimSample | null): void {
    if (prev) this.#flownNm += distanceNm(prev.lat, prev.lon, s.lat, s.lon);
    if (this.#flownNm - this.#crumbs.at(-1)!.nm >= BREADCRUMB_NM) this.#crumbs.push({ lat: s.lat, lon: s.lon, nm: this.#flownNm });
    if (!s.onGround) { this.#contact = null; return; } // airborne again: touch-and-go or bounce, not a landing
    this.#contact ??= { ...snap(s), distanceNm: this.#flownNm, approachFpm: prev?.verticalSpeedFpm ?? 0, touchdownFpm: undefined };
    this.#contact.touchdownFpm ??= s.touchdownFpm;
    if (s.groundSpeedKts < (s.engineKind === 'helicopter' ? LANDED_KTS_HELICOPTER : LANDED_KTS)) this.#phase = 'landed';
  }

  #landed(s: SimSample): void {
    if (!s.onGround) { // took off again (stop-and-go): the flight continues
      this.#contact = null;
      this.#phase = 'airborne';
      return;
    }
    // the touchdown rate can be latched by the sim a reading after the wheels touch
    if (this.#contact) this.#contact.touchdownFpm ??= s.touchdownFpm;
    if (s.groundSpeedKts >= PARKED_KTS) { this.#stoppedSince = null; return; }
    this.#stoppedSince ??= s.t;
    if (s.t - this.#stoppedSince >= PARK_HOLD_MS) {
      this.#phase = 'parked';
      this.#outcome = this.#finish();
    }
  }

  #finish(): Outcome {
    const no = (reason: string): Outcome => ({ ok: false, reason });
    const takeoff = this.#takeoff, landing = this.#contact;
    if (!takeoff || !landing) return no('no complete flight was recorded');
    const departureIcao = nearestAirport(takeoff.lat, takeoff.lon, AIRPORT_MATCH_NM);
    if (!departureIcao) return no('takeoff was not at a known airport');
    const arrivalIcao = nearestAirport(landing.lat, landing.lon, AIRPORT_MATCH_NM);
    if (!arrivalIcao) return no('landing was not at a known airport');
    const aircraftIcao = designatorOf(takeoff.atcModel) ?? this.#opts.aircraftIcao?.toUpperCase();
    if (!aircraftIcao) return no(`aircraft type unknown (ATC MODEL "${takeoff.atcModel}"): pass --aircraft with its ICAO designator`);
    if (takeoff.emptyWeightKg === undefined) return no('the aircraft does not report its empty weight, so the payload cannot be measured');
    const parsed = telemetrySchema.safeParse({
      takeoffAt: new Date(takeoff.t).toISOString(),
      landedAt: new Date(landing.t).toISOString(),
      departureIcao,
      arrivalIcao,
      aircraftIcao,
      payloadKg: Math.round(Math.max(0, takeoff.totalWeightKg - takeoff.emptyWeightKg - takeoff.fuelKg)),
      fuelUsedKg: Math.round(Math.max(0, takeoff.fuelKg - landing.fuelKg)),
      // the sim's latched touchdown rate; else the last vertical speed before the wheels touched. Always reported as a descent.
      landingFpm: -Math.round(Math.abs(landing.touchdownFpm ?? landing.approachFpm)),
      distanceNm: Math.round(landing.distanceNm * 10) / 10,
      source: 'simconnect',
      // flagged flights are still reported: the server, not the client, rejects them (and tells the pilot why)
      ...(this.#flags.size > 0 ? { flags: [...this.#flags] } : {}),
      // allowed, but kept visible: the server shows them and excuses the downtime from the flight duration
      ...(this.#reloads + this.#restarts > 0 ? { interruptions: { reloads: this.#reloads, simRestarts: this.#restarts, downtimeMs: this.#downtimeMs } } : {}),
    });
    return parsed.success ? { ok: true, report: parsed.data } : no(`report is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`);
  }
}
