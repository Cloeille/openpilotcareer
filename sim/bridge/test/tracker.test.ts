import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkTelemetry, deriveAircraft, distanceNm, telemetrySchema, type Telemetry } from '@opc/shared';
import { readSamples } from '../src/fixture.ts';
import { designatorOf, FlightTracker } from '../src/tracker.ts';
import type { Phase, SimSample, TrackerOptions } from '../src/types.ts';

const load = (name: string): SimSample[] => readSamples(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)));
function run(samples: SimSample[], opts?: TrackerOptions) {
  const tr = new FlightTracker(opts);
  const phases: Phase[] = [];
  for (const s of samples) {
    tr.feed(s);
    if (phases.at(-1) !== tr.phase) phases.push(tr.phase);
  }
  return { tr, phases };
}

test('airliner: full phase walk, report matches the flight', () => {
  const { tr, phases } = run(load('airliner-a320-lfpg-egll'));
  assert.deepEqual(phases, ['preflight', 'taxiOut', 'airborne', 'landed', 'parked']);
  assert.ok(tr.outcome?.ok, JSON.stringify(tr.outcome));
  const r = tr.outcome.report;
  assert.ok(telemetrySchema.safeParse(r).success);
  assert.deepEqual([r.departureIcao, r.arrivalIcao, r.aircraftIcao, r.source], ['LFPG', 'EGLL', 'A320', 'simconnect']);
  assert.equal(r.payloadKg, 12_000);
  assert.equal(r.landingFpm, -240);
  assert.ok(r.distanceNm > 185 && r.distanceNm < 192, `distance ${r.distanceNm}`);
  assert.ok(r.fuelUsedKg > 400 && r.fuelUsedKg < 1500, `fuel ${r.fuelUsedKg}`);
  assert.ok(Date.parse(r.landedAt) > Date.parse(r.takeoffAt));
  assert.equal(r.flags, undefined);
});

test('GA piston: ATC MODEL is a bare designator', () => {
  const { tr } = run(load('ga-c172-lfpn-lfaq'));
  assert.ok(tr.outcome?.ok);
  assert.deepEqual([tr.outcome.report.departureIcao, tr.outcome.report.arrivalIcao, tr.outcome.report.aircraftIcao, tr.outcome.report.payloadKg], ['LFPN', 'LFAQ', 'C172', 300]);
});

test('helicopter: lifts off from a hover (no taxi) and stops on touchdown', () => {
  const { tr, phases } = run(load('helicopter-ec35-lfpn-lfpt'));
  assert.deepEqual(phases, ['preflight', 'airborne', 'landed', 'parked']);
  assert.ok(tr.outcome?.ok, JSON.stringify(tr.outcome));
  assert.deepEqual([tr.outcome.report.aircraftIcao, tr.outcome.report.arrivalIcao], ['EC35', 'LFPT']);
});

test('touch-and-go is not a landing: one flight, reported from the final landing', () => {
  const { tr, phases } = run(load('touch-and-go-c172-lfpn-lfaq'));
  assert.deepEqual(phases, ['preflight', 'taxiOut', 'airborne', 'landed', 'parked']);
  assert.ok(tr.outcome?.ok, JSON.stringify(tr.outcome));
  assert.equal(tr.outcome.report.arrivalIcao, 'LFAQ');
  assert.ok(tr.outcome.report.distanceNm > 75 && tr.outcome.report.distanceNm < 90, `distance ${tr.outcome.report.distanceNm}`);
  assert.equal(tr.outcome.report.landingFpm, -180, 'the final landing rate, not the touch-and-go');
});

test('go-around: the approach that did not land is ignored', () => {
  const { tr, phases } = run(load('go-around-c172-lfpn-lfaq'));
  assert.deepEqual(phases, ['preflight', 'taxiOut', 'airborne', 'landed', 'parked']);
  assert.ok(tr.outcome?.ok, JSON.stringify(tr.outcome));
  assert.ok(tr.outcome.report.distanceNm > 80 && tr.outcome.report.distanceNm < 95, 'the missed approach adds a little distance, nothing else');
});

for (const [fixture, flag] of [
  ['cheat-slew-c172-lfpn-lfaq', 'slew_detected'],
  ['cheat-simrate4x-c172-lfpn-lfaq', 'time_acceleration_above_1x'],
  ['cheat-teleport-c172-lfpn-lfqq', 'teleport_jump_over_50nm'],
] as const) {
  test(`cheat fixture ${fixture} raises ${flag} and the report carries it`, () => {
    const { tr } = run(load(fixture));
    assert.deepEqual(tr.flags, [flag]);
    assert.ok(tr.outcome?.ok, 'a flagged flight is still reported: the server rejects it with a reason');
    assert.deepEqual(tr.outcome.report.flags, [flag]);
  });
}

test('a long sample gap or a long pause is flagged; a short pause is not', () => {
  const base = load('ga-c172-lfpn-lfaq');
  const airborne = base.findIndex((s) => !s.onGround) + 5;
  const paused = (minutes: number) => base.map((s, i) => (i >= airborne && i < airborne + 4 ? { ...s, paused: true, t: s.t + (i - airborne + 1) * minutes * 20_000 } : i >= airborne + 4 ? { ...s, t: s.t + 4 * minutes * 20_000 } : s));
  assert.deepEqual(run(paused(1)).tr.flags, []);
  assert.deepEqual(run(paused(20)).tr.flags.includes('long_pause'), true);
});

test('no flag is raised on the ground before the flight starts (loading screen, slew to the gate)', () => {
  const s = load('ga-c172-lfpn-lfaq');
  const pre = s.slice(0, 5).map((x) => ({ ...x, slew: true, simRate: 4 }));
  assert.deepEqual(run([...pre, ...s.slice(5)]).tr.flags, []);
});

test('unknown aircraft needs an override; missing empty weight cannot measure payload; off-airport is not reportable', () => {
  const ga = load('ga-c172-lfpn-lfaq');
  const odd = ga.map((s) => ({ ...s, atcModel: 'ATC MODEL 42', title: 'Some Addon' }));
  const a = run(odd).tr.outcome;
  assert.ok(a && !a.ok && /--aircraft/.test(a.reason));
  const b = run(odd, { aircraftIcao: 'c172' }).tr.outcome;
  assert.ok(b?.ok && b.report.aircraftIcao === 'C172');
  const noEmpty = ga.map(({ emptyWeightKg: _, ...s }) => s as SimSample);
  const c = run(noEmpty).tr.outcome;
  assert.ok(c && !c.ok && /empty weight/.test(c.reason));
  const field = ga.map((s) => ({ ...s, lon: s.lon - 40 })); // the same flight over the Atlantic
  const d = run(field).tr.outcome;
  assert.ok(d && !d.ok && /known airport/.test(d.reason));
});

test('out-of-order and post-parking samples are ignored; a stream that never flies has no outcome', () => {
  const ga = load('ga-c172-lfpn-lfaq');
  const tr = new FlightTracker();
  for (const s of ga) tr.feed(s);
  const done = tr.outcome;
  tr.feed({ ...ga[0]!, t: ga.at(-1)!.t + 1000, lat: 0, lon: 0 });
  assert.equal(tr.outcome, done);
  const idle = run(ga.slice(0, 10));
  assert.equal(idle.tr.outcome, null);
  assert.equal(idle.tr.phase, 'preflight');
});

test('designatorOf reads bare designators and the MSFS localisation token, rejects everything else', () => {
  assert.equal(designatorOf('C172'), 'C172');
  assert.equal(designatorOf('TT:ATCCOM.AC_MODEL_A20N.0.text'), 'A20N');
  assert.equal(designatorOf('TT:ATCCOM.AC_MODEL B748.0.text'), 'B748');
  for (const bad of ['', 'Cessna 172', 'TOOLONG', 'C', 'ATC MODEL 42']) assert.equal(designatorOf(bad), null, bad);
});

// ---- reloads and game crashes: allowed, unless the aircraft was crashed or diving just before
const ga = load('ga-c172-lfpn-lfaq');
const flownAt = (nm: number, stream = ga): number => { // index of the first airborne sample after `nm` flown
  let flown = 0;
  for (let i = 1; i < stream.length; i++) {
    flown += distanceNm(stream[i - 1]!.lat, stream[i - 1]!.lon, stream[i]!.lat, stream[i]!.lon);
    if (flown >= nm && !stream[i]!.onGround) return i;
  }
  throw new Error(`no sample after ${nm} nm`);
};
const patch = (from: number, to: number, p: Partial<SimSample>): SimSample[] => ga.map((s, i) => (i >= from && i <= to ? { ...s, ...p } : s));
/** The flight up to sample `k`, then `gapMs` later the sim shows the flight as it was at sample `j` and flies on from there. */
function breakAt(base: SimSample[], k: number, j: number, gapMs: number, over: Partial<SimSample> = {}): SimSample[] {
  const delta = base[k]!.t + gapMs - base[j]!.t;
  return [...base.slice(0, k + 1), ...base.slice(j).map((s, i) => ({ ...s, t: s.t + delta, ...(i === 0 ? over : {}) }))];
}
const c172 = deriveAircraft({ icao: 'C172', name: 'Cessna 172', category: 'piston-single', engines: 1, wtc: 'L' });
const jobNm = distanceNm(ga[0]!.lat, ga[0]!.lon, ga.at(-1)!.lat, ga.at(-1)!.lon);
const serverSays = (r: Telemetry) => checkTelemetry(r, {
  origin: 'LFPN', destination: 'LFAQ', distanceNm: jobNm, payloadKg: 300, aircraftIcao: 'C172', aircraft: c172,
  acceptedAt: ga[0]!.t - 3_600_000, now: ga.at(-1)!.t + 4 * 3_600_000, antiCheat: true,
});
const cruiseK = flownAt(51), cruiseJ = flownAt(21);
const MIN = 60_000;

for (const [how, over] of [['signalled by FlightLoaded', { resumed: 'reload' }], ['seen only as a position jump', {}]] as const) {
  test(`a reload 30 nm back along the track is accepted (${how}): no flag, the distance is rewound, the server verifies it`, () => {
    const clean = run(ga).tr.outcome;
    const { tr } = run(breakAt(ga, cruiseK, cruiseJ, 20_000, over));
    assert.deepEqual(tr.flags, []);
    assert.ok(tr.outcome?.ok && clean?.ok, JSON.stringify(tr.outcome));
    assert.ok(Math.abs(tr.outcome.report.distanceNm - clean.report.distanceNm) < 1.5, `rewound: ${tr.outcome.report.distanceNm} vs ${clean.report.distanceNm} nm`);
    assert.equal(tr.outcome.report.interruptions?.reloads, 1);
    assert.equal(serverSays(tr.outcome.report).ok, true);
  });
}

test('a jump forward 80 nm to near the destination is still a teleport, whether or not the sim says it loaded a flight', () => {
  const liner = load('airliner-a320-lfpg-egll');
  const [from, to] = [flownAt(30, liner), flownAt(110, liner)];
  for (const over of [{}, { resumed: 'reload' }] as const) {
    const { tr } = run([...liner.slice(0, from + 1), ...liner.slice(to).map((x) => ({ ...x, t: x.t - (liner[to]!.t - liner[from]!.t) + 20_000, ...(x === liner[to] ? over : {}) }))]);
    assert.deepEqual(tr.flags, ['teleport_jump_over_50nm']);
    assert.equal(tr.outcome?.ok && tr.outcome.report.interruptions?.reloads, over.resumed ? 1 : undefined);
  }
});

test('a reload right after a violent descent is reload_after_crash (-6000 fpm, or -2500 fpm under 1000 ft), and so is one after a crash', () => {
  const dive = (p: Partial<SimSample>) => run(breakAt(patch(cruiseK - 2, cruiseK, p), cruiseK, cruiseJ, 20_000, { resumed: 'reload' })).tr.flags;
  assert.deepEqual(dive({ verticalSpeedFpm: -7_000 }), ['reload_after_crash']);
  assert.deepEqual(dive({ verticalSpeedFpm: -3_000, aglFt: 800 }), ['reload_after_crash']);
  assert.deepEqual(dive({ crashed: true }), ['reload_after_crash']);
  assert.deepEqual(dive({ verticalSpeedFpm: -5_000 }), [], 'fast but not violent');
  assert.deepEqual(dive({ verticalSpeedFpm: -3_000, aglFt: 4_000 }), [], 'a steep descent high up is not violent');
  assert.deepEqual(dive({ verticalSpeedFpm: -3_000 }), [], 'no height above ground reported: only the -6000 fpm rule applies');
  const old = run(breakAt(patch(cruiseK - 3, cruiseK - 3, { verticalSpeedFpm: -7_000 }), cruiseK, cruiseJ, 20_000, { resumed: 'reload' })).tr; // the dive was 3 samples (3 min) before the reload
  assert.deepEqual(old.flags, []);
  assert.deepEqual(run(breakAt(patch(cruiseK - 2, cruiseK, { verticalSpeedFpm: -7_000 }), cruiseK, cruiseJ, 20_000)).tr.flags, ['reload_after_crash'], 'without the FlightLoaded event too');
  const flagged = run(breakAt(patch(cruiseK - 2, cruiseK, { crashed: true }), cruiseK, cruiseJ, 20_000, { resumed: 'reload' })).tr;
  assert.ok(flagged.outcome?.ok && flagged.outcome.report.flags?.includes('reload_after_crash'), 'reported, so the server rejects it');
  assert.equal(serverSays(flagged.outcome!.ok ? flagged.outcome.report : (undefined as never)).ok, false);
});

test('a sim quit and a 40 min reconnect mid-cruise, back at the last position: no flag, downtime reported, the server accepts', () => {
  const { tr } = run(breakAt(ga, cruiseK, cruiseK, 40 * MIN, { resumed: 'reconnect' }));
  assert.deepEqual(tr.flags, [], 'neither long_pause nor a reload');
  assert.ok(tr.outcome?.ok, JSON.stringify(tr.outcome));
  assert.deepEqual(tr.outcome.report.interruptions, { reloads: 0, simRestarts: 1, downtimeMs: 40 * MIN });
  assert.equal(serverSays(tr.outcome.report).ok, true);
  const gap = run(breakAt(ga, cruiseK, cruiseK, 40 * MIN)).tr; // the same silence while the link stayed up is still a long pause
  assert.deepEqual(gap.flags, ['long_pause']);
});

test('a sim quit during a violent descent, then a reconnect, is reload_after_crash (only the last state before the drop counts)', () => {
  const { tr } = run(breakAt(patch(cruiseK - 1, cruiseK, { verticalSpeedFpm: -7_000 }), cruiseK, cruiseK, 5 * MIN, { resumed: 'reconnect' }));
  assert.deepEqual(tr.flags, ['reload_after_crash']);
  const calm = run(breakAt(patch(cruiseK + 1, cruiseK + 3, { verticalSpeedFpm: -7_000 }), cruiseK, cruiseK, 5 * MIN, { resumed: 'reconnect' })).tr; // it dives only after the reconnect
  assert.deepEqual(calm.flags, []);
});

test('a reload to the departure gate before takeoff is accepted and the tracker is back in preflight', () => {
  const taxi = ga.findIndex((x) => x.groundSpeedKts >= 40 && x.onGround);
  const tr = new FlightTracker();
  for (const x of ga.slice(0, taxi + 1)) tr.feed(x);
  assert.equal(tr.phase, 'taxiOut');
  tr.feed({ ...ga[0]!, t: ga[taxi]!.t + 20_000, resumed: 'reload' });
  assert.equal(tr.phase, 'preflight');
  assert.deepEqual(tr.flags, []);
  const airborne = run(breakAt(ga, cruiseK, 0, 20_000, { resumed: 'reload' })); // from 50 nm out, back to the gate, then the whole flight again
  assert.ok(airborne.phases.indexOf('airborne') < airborne.phases.lastIndexOf('preflight'), `went back to preflight: ${airborne.phases}`);
  assert.deepEqual(airborne.tr.flags, []);
  assert.ok(airborne.tr.outcome?.ok && Math.abs(airborne.tr.outcome.report.distanceNm - jobNm) < 3, 'the abandoned leg is not flown distance');
  assert.equal(serverSays(airborne.tr.outcome.report).ok, true);
});
