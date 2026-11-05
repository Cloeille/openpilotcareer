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

/** ATC MODEL is a bare designator ("C172") or a localisation token ("TT:ATCCOM.AC_MODEL_A20N.0.text"). */
const ATC_MODEL = /^(?:TT:ATCCOM\.AC_MODEL[_ ])?([A-Z0-9]{2,4})(?:\.\d+\.TEXT)?$/;
export function designatorOf(atcModel: string): string | null {
  const m = ATC_MODEL.exec(atcModel.trim().toUpperCase());
  return m?.[1] && icaoTypeSchema.safeParse(m[1]).success ? m[1] : null;
}

type Snapshot = Pick<SimSample, 't' | 'lat' | 'lon' | 'fuelKg' | 'totalWeightKg' | 'emptyWeightKg' | 'atcModel'>;
const snap = (s: SimSample): Snapshot => ({ t: s.t, lat: s.lat, lon: s.lon, fuelKg: s.fuelKg, totalWeightKg: s.totalWeightKg, emptyWeightKg: s.emptyWeightKg, atcModel: s.atcModel });

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

  readonly #opts: TrackerOptions;
  constructor(opts: TrackerOptions = {}) { this.#opts = opts; }

  get phase(): Phase { return this.#phase; }
  get flags(): Flag[] { return [...this.#flags]; }
  /** Set once, when the aircraft parks. Null before that. */
  get outcome(): Outcome | null { return this.#outcome; }

  feed(s: SimSample): void {
    const prev = this.#prev;
    if (this.#phase === 'parked' || (prev && s.t <= prev.t)) return; // finished, or out-of-order reading
    if (this.#phase !== 'preflight') this.#checkCheating(s, prev);
    switch (this.#phase) {
      case 'preflight': case 'taxiOut': this.#onGroundOrLiftoff(s); break;
      case 'airborne': this.#airborne(s, prev); break;
      case 'landed': this.#landed(s); break;
    }
    this.#prev = s;
  }

  #flag(f: Flag): void { this.#flags.add(f); }

  #checkCheating(s: SimSample, prev: SimSample | null): void {
    if (s.slew) this.#flag('slew_detected');
    if (s.simRate > RATE_EPSILON) this.#flag('time_acceleration_above_1x');
    if (prev) {
      const nm = distanceNm(prev.lat, prev.lon, s.lat, s.lon);
      if (nm > TELEPORT_NM && nm / ((s.t - prev.t) / 3_600_000) > TELEPORT_MIN_KTS) this.#flag('teleport_jump_over_50nm');
    }
    if (prev && s.t - prev.t > LONG_PAUSE_MS) this.#flag('long_pause'); // the sim (or the bridge) was away for a long time
    if (s.paused) {
      this.#pausedSince ??= s.t;
      if (s.t - this.#pausedSince > LONG_PAUSE_MS) this.#flag('long_pause');
    } else {
      this.#pausedSince = null;
    }
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
    });
    return parsed.success ? { ok: true, report: parsed.data } : no(`report is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`);
  }
}
