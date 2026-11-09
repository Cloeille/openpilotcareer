// Sample streams shaped like flight 175 (Quasar QASR, VCCJ -> ZBAD, 2 635 nm), built in code from the synthetic flight model:
// a recording of what the bridge reads once it asks for BRAKE PARKING POSITION, and the ways the samples of a flight can go missing.
import { checkTelemetry, distanceNm, resolveCatalogEntry, type Telemetry } from '@opc/shared';
import { CRAFT, simulate } from '../scripts/make-fixtures.ts';
import { airportPosition } from '../src/airports.ts';
import type { SimSample, TrackerOptions } from '../src/types.ts';

export const JOB: TrackerOptions = { aircraftIcao: 'QASR', originIcao: 'VCCJ', destinationIcao: 'ZBAD' };
export const QUASAR = { ...CRAFT.airliner!, atcModel: 'QASR', title: 'Flying Fries Quasar', cruiseKts: 5_000, liftoffKts: 220, landingKts: 190, emptyKg: 130_000, payloadKg: 2_000, fuelKg: 40_000, burnKgPerHour: 28_000 };
const base = simulate({ from: 'VCCJ', to: 'ZBAD', craft: QUASAR, startMs: Date.UTC(2026, 10, 4, 9, 0, 0) });

export const LIFTOFF = base.findIndex((s) => !s.onGround);
export const TOUCHDOWN = base.findIndex((s, i) => i > LIFTOFF && s.onGround);

/** The flight as the bridge records it: the parking brake is off while the aircraft moves, and `brake` once it stands still after landing.
 *  `standNm` (negative: south) is how far from the airport reference point the aircraft touches down and stops, as a stand does: the last minute of the approach drifts there. */
export function recorded(o: { brake: boolean; standNm?: number; stoppedFor?: number }): SimSample[] {
  const stream = o.stoppedFor === undefined ? base : base.slice(0, base.findIndex((s, i) => i > TOUCHDOWN && s.groundSpeedKts < 1) + o.stoppedFor);
  return stream.map((s, i) => ({
    ...s,
    lat: s.lat + ((o.standNm ?? 0) / 60) * Math.min(1, Math.max(0, (i - TOUCHDOWN + 56) / 56)),
    parkingBrake: i > TOUCHDOWN && s.groundSpeedKts < 1 && o.brake,
  }));
}

/** The samples after `from` and before `to` never arrive and the clock jumps `gapMs` between the two that do: a pause, a stalled bridge, a sim that hung. */
export function silentGap(stream: SimSample[], from: number, to: number, gapMs: number, over: Partial<SimSample> = {}): SimSample[] {
  const shift = stream[from]!.t + gapMs - stream[to]!.t;
  return [...stream.slice(0, from + 1), ...stream.slice(to).map((s, i) => ({ ...s, t: s.t + shift, ...(i === 0 ? over : {}) }))];
}

const dep = airportPosition('VCCJ')!, arr = airportPosition('ZBAD')!;
const quasarType = resolveCatalogEntry({ icao: 'QASR', name: 'Flying Fries Quasar', category: 'spaceplane', engines: 4, wtc: 'H', perf: { seats: 0, cargoKg: 2000, cruiseKts: 5000, rangeNm: 9999 } });

/** What the server says about a report of this flight, `ignoreFlags` being the pause tolerance of the company's realism setting. */
export const serverSays = (r: Telemetry, ignoreFlags?: string[]) => checkTelemetry(r, {
  origin: 'VCCJ', destination: 'ZBAD', distanceNm: distanceNm(dep.lat, dep.lon, arr.lat, arr.lon), payloadKg: 2_000, aircraftIcao: 'QASR', aircraft: quasarType,
  acceptedAt: base[0]!.t - 3_600_000, now: base.at(-1)!.t + 4 * 3_600_000, antiCheat: true, ...(ignoreFlags ? { ignoreFlags } : {}),
});
