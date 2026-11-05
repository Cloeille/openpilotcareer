// Synthetic flight generator for the bridge's test fixtures.
//   node scripts/make-fixtures.ts                        rewrite every committed fixture in fixtures/
//   node scripts/make-fixtures.ts FROM TO AIRCRAFT OUT   one clean flight for a specific job (AIRCRAFT: airliner|ga|helicopter)
// These streams are SYNTHETIC: generated from airport coordinates and a simple flight model, never recorded from a simulator.
// ponytail: constant ground speed over the whole leg (no climb/descent speed profile); only the stream's shape matters to the tracker.
import { fileURLToPath } from 'node:url';
import { distanceNm } from '@opc/shared';
import { airportPosition } from '../src/airports.ts';
import { writeSamples } from '../src/fixture.ts';
import type { EngineKind, SimSample } from '../src/types.ts';

export type Craft = {
  atcModel: string; title: string; engineKind: EngineKind; cruiseKts: number; liftoffKts: number; landingKts: number;
  emptyKg: number; payloadKg: number; fuelKg: number; burnKgPerHour: number; touchdownFpm: number;
};
export type Scenario = {
  from: string; to: string; craft: Craft; startMs: number;
  touchAndGo?: boolean; goAround?: boolean; slew?: boolean; timeAccel?: number; teleport?: boolean;
};

export const CRAFT: Record<string, Craft> = {
  airliner: { atcModel: 'TT:ATCCOM.AC_MODEL_A320.0.text', title: 'Airbus A320neo Synthetic', engineKind: 'jet', cruiseKts: 447, liftoffKts: 140, landingKts: 135, emptyKg: 42_500, payloadKg: 12_000, fuelKg: 6_000, burnKgPerHour: 2_400, touchdownFpm: 240 },
  ga: { atcModel: 'C172', title: 'Cessna 172 Skyhawk Synthetic', engineKind: 'piston', cruiseKts: 118, liftoffKts: 55, landingKts: 62, emptyKg: 770, payloadKg: 300, fuelKg: 120, burnKgPerHour: 28, touchdownFpm: 180 },
  helicopter: { atcModel: 'TT:ATCCOM.AC_MODEL EC35.0.text', title: 'Airbus H135 Synthetic', engineKind: 'helicopter', cruiseKts: 130, liftoffKts: 0, landingKts: 3, emptyKg: 1_500, payloadKg: 400, fuelKg: 450, burnKgPerHour: 190, touchdownFpm: 150 },
};

const r5 = (n: number): number => Math.round(n * 1e5) / 1e5;
/** Point at fraction `f` of the great circle a->b (f > 1 extrapolates past b). */
function along(a: { lat: number; lon: number }, b: { lat: number; lon: number }, f: number): { lat: number; lon: number } {
  const rad = Math.PI / 180;
  const [p1, l1, p2, l2] = [a.lat * rad, a.lon * rad, b.lat * rad, b.lon * rad];
  const d = distanceNm(a.lat, a.lon, b.lat, b.lon) / 3440.065;
  if (d === 0) return a;
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / rad, lon: Math.atan2(y, x) / rad };
}

export function simulate(sc: Scenario): SimSample[] {
  const A = airportPosition(sc.from), B = airportPosition(sc.to);
  if (!A || !B) throw new Error(`unknown airport ${sc.from} or ${sc.to}`);
  const c = sc.craft, heli = c.engineKind === 'helicopter';
  const nm = distanceNm(A.lat, A.lon, B.lat, B.lon);
  const out: SimSample[] = [];
  let t = sc.startMs, fuel = c.fuelKg, pos = A as { lat: number; lon: number };
  const push = (hostSec: number, simSec: number, p: Partial<SimSample>): void => {
    t += Math.round(hostSec * 1000);
    fuel = Math.max(0, fuel - (c.burnKgPerHour * simSec) / 3600);
    out.push({
      t, onGround: false, lat: r5(pos.lat), lon: r5(pos.lon), groundSpeedKts: 0, verticalSpeedFpm: 0,
      fuelKg: Math.round(fuel * 10) / 10, totalWeightKg: Math.round((c.emptyKg + c.payloadKg + fuel) * 10) / 10, emptyWeightKg: c.emptyKg,
      simRate: 1, slew: false, paused: false, atcModel: c.atcModel, title: c.title, engineKind: c.engineKind, ...p,
    });
  };
  const still = (seconds: number, step: number, p: Partial<SimSample>): void => { for (let i = 0; i < seconds / step; i++) push(step, step, { onGround: true, ...p }); };
  /** Fly from fraction f0 to f1 of the route over `simSec` simulated seconds, one sample per `stepSec`. */
  const leg = (f0: number, f1: number, simSec: number, stepSec: number, p: Partial<SimSample>, rate = 1): void => {
    const n = Math.max(1, Math.round(simSec / stepSec));
    for (let i = 1; i <= n; i++) { pos = along(A, B, f0 + ((f1 - f0) * i) / n); push(stepSec / rate, stepSec, { groundSpeedKts: c.cruiseKts, simRate: rate, ...p }); }
  };

  still(60, 5, {});
  if (!heli) {
    still(300, 10, { groundSpeedKts: 12 });
    for (let k = 1; k <= 20; k++) push(1, 1, { onGround: true, groundSpeedKts: (c.liftoffKts * k) / 20 });
  }
  for (let k = 0; k < 15; k++) push(1, 1, { groundSpeedKts: Math.max(5, c.liftoffKts), verticalSpeedFpm: heli ? 300 : 700 });

  const flightSec = (nm / c.cruiseKts) * 3600;
  const fFinal = 1 - (60 * c.cruiseKts) / 3600 / nm;       // start of the last minute
  const rate = sc.timeAccel ?? 1;
  const fTouchGo = 0.5;
  const firstEnd = sc.teleport ? 0.3 : sc.touchAndGo ? fTouchGo : fFinal;
  const slewAt = sc.slew ? { slew: true } : {};
  leg(0, firstEnd, flightSec * firstEnd, 60, { verticalSpeedFpm: 0, ...slewAt }, rate);
  if (sc.teleport) leg(0.9, fFinal, flightSec * (fFinal - 0.9), 60, {});
  if (sc.touchAndGo) {
    leg(firstEnd, firstEnd, 5, 1, { verticalSpeedFpm: -400, groundSpeedKts: c.landingKts });
    push(1, 1, { onGround: true, groundSpeedKts: c.landingKts, touchdownFpm: -c.touchdownFpm });
    for (let k = 0; k < 3; k++) push(1, 1, { onGround: true, groundSpeedKts: c.landingKts + 3 });
    for (let k = 0; k < 5; k++) push(1, 1, { groundSpeedKts: c.landingKts + 10, verticalSpeedFpm: 600 });
    leg(fTouchGo, fFinal, flightSec * (fFinal - fTouchGo), 60, {});
  }
  if (sc.goAround) {
    leg(fFinal, 0.999, 55, 1, { verticalSpeedFpm: -600 });
    leg(0.999, 1.012, 90, 3, { verticalSpeedFpm: 1500 });                  // go-around: power up, climb past the field
    leg(1.012, 0.97, 240, 20, { verticalSpeedFpm: 0, groundSpeedKts: c.cruiseKts }); // back around the circuit
    leg(0.97, 0.9995, 60, 1, { verticalSpeedFpm: -600 });                  // second approach
  } else {
    leg(fFinal, 0.9995, 56, 1, { verticalSpeedFpm: -600 });
  }
  pos = B;
  push(1, 1, { verticalSpeedFpm: -c.touchdownFpm, groundSpeedKts: c.landingKts });
  push(1, 1, { onGround: true, groundSpeedKts: c.landingKts, verticalSpeedFpm: 0, touchdownFpm: -c.touchdownFpm });
  for (let k = 1; k <= 40; k++) push(1, 1, { onGround: true, groundSpeedKts: Math.max(0, c.landingKts * (1 - k / 30)) });
  still(60, 10, {});
  return out;
}

const FIXTURES: Record<string, Omit<Scenario, 'startMs'>> = {
  'airliner-a320-lfpg-egll': { from: 'LFPG', to: 'EGLL', craft: CRAFT.airliner! },
  'ga-c172-lfpn-lfaq': { from: 'LFPN', to: 'LFAQ', craft: CRAFT.ga! },
  'helicopter-ec35-lfpn-lfpt': { from: 'LFPN', to: 'LFPT', craft: CRAFT.helicopter! },
  'touch-and-go-c172-lfpn-lfaq': { from: 'LFPN', to: 'LFAQ', craft: CRAFT.ga!, touchAndGo: true },
  'go-around-c172-lfpn-lfaq': { from: 'LFPN', to: 'LFAQ', craft: CRAFT.ga!, goAround: true },
  'cheat-slew-c172-lfpn-lfaq': { from: 'LFPN', to: 'LFAQ', craft: CRAFT.ga!, slew: true },
  'cheat-simrate4x-c172-lfpn-lfaq': { from: 'LFPN', to: 'LFAQ', craft: CRAFT.ga!, timeAccel: 4 },
  'cheat-teleport-c172-lfpn-lfqq': { from: 'LFPN', to: 'LFQQ', craft: CRAFT.ga!, teleport: true },
};
const START = Date.UTC(2026, 10, 4, 9, 0, 0);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [from, to, kind, outPath] = process.argv.slice(2);
  if (from && to && kind && outPath) {
    const craft = CRAFT[kind];
    if (!craft) throw new Error(`aircraft must be one of ${Object.keys(CRAFT).join(', ')}`);
    writeSamples(outPath, simulate({ from, to, craft, startMs: START }));
  } else {
    for (const [name, sc] of Object.entries(FIXTURES)) writeSamples(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), simulate({ ...sc, startMs: START }));
  }
}
