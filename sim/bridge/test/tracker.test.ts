import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { telemetrySchema } from '@opc/shared';
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
