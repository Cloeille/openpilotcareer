import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveSampleSchema, type LiveSample } from '@opc/shared';
import { ApiError, type ServerClient } from '../src/client.ts';
import { bearingDeg, LiveReporter, LIVE_INTERVAL_MS, toLiveSample, TrackEstimator } from '../src/live.ts';
import { Session } from '../src/session.ts';
import { Outbox } from '../src/outbox.ts';
import { readSamples } from '../src/fixture.ts';
import { decodeExtras, EXTRA_FIELDS, liveFields, MAX_ENGINES, SampleMapper, watchSim } from '../src/simconnect.ts';
import type { SimSample } from '../src/types.ts';
import { fileURLToPath } from 'node:url';

const T0 = Date.UTC(2026, 10, 4, 9);
const sim = (over: Partial<SimSample> = {}): SimSample => ({
  t: T0, onGround: false, lat: 48.75, lon: 2.1, groundSpeedKts: 110, verticalSpeedFpm: 0, fuelKg: 100.04, totalWeightKg: 1100, emptyWeightKg: 770,
  simRate: 1, slew: false, paused: false, atcModel: 'C172', title: 'C172', engineKind: 'piston', ...over,
});
type PostLive = ServerClient['postLive'];
const fakeClient = (postLive: PostLive) => ({ postLive }) as Pick<ServerClient, 'postLive'>;
const flush = () => new Promise((r) => setImmediate(r));

test('toLiveSample: carries the SimSample over, rounds, keeps flags and phase, and passes the shared schema', () => {
  const s = toLiveSample(sim({ altFt: 3_521.7, headingDeg: 359.96, verticalSpeedFpm: -503.4, engines: [{ oilPsi: 62.5 }] }), 'airborne', ['slew_detected'], { altFt: 0, headingDeg: 0 })!;
  assert.deepEqual(s, {
    t: T0, lat: 48.75, lon: 2.1, altFt: 3_522, gsKts: 110, vsFpm: -503, headingDeg: 360, fuelKg: 100, phase: 'airborne', paused: false, simRate: 1,
    flags: ['slew_detected'], engines: [{ oilPsi: 62.5 }],
  });
  assert.ok(liveSampleSchema.safeParse(s).success);
});

test('toLiveSample: a reading outside the contract is skipped, not repaired; a missing SimVar falls back to the track estimate', () => {
  assert.equal(toLiveSample(sim({ altFt: 1e9 }), 'airborne', [], { altFt: 0, headingDeg: 0 }), null);
  const est = toLiveSample(sim(), 'taxiOut', [], { altFt: 40, headingDeg: 271.3 })!;
  assert.deepEqual([est.altFt, est.headingDeg, est.engines], [40, 271.3, []]);
});

test('TrackEstimator: heading from the track, altitude from vertical speed, ground resets it, no jump on a long gap', () => {
  const e = new TrackEstimator();
  e.at(sim({ onGround: true, t: T0 }));
  const north = e.at(sim({ onGround: false, t: T0 + 1_000, lat: 48.76, verticalSpeedFpm: 600 }));
  assert.ok(Math.abs(north.headingDeg) < 1 || Math.abs(north.headingDeg - 360) < 1, String(north.headingDeg));
  assert.equal(north.altFt, 10);
  const east = e.at(sim({ t: T0 + 2_000, lat: 48.76, lon: 2.11, verticalSpeedFpm: 600 }));
  assert.ok(Math.abs(east.headingDeg - 90) < 1, String(east.headingDeg));
  const gap = e.at(sim({ t: T0 + 3_600_000, lat: 48.76, lon: 2.11, verticalSpeedFpm: 6_000 }));
  assert.equal(gap.altFt, 20 + 1_000, 'a gap is integrated for 10 s at most');
  assert.equal(e.at(sim({ t: T0 + 3_601_000, onGround: true })).altFt, 0);
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 1e-6);
});

test('LiveReporter: one post per interval of flight time, an immediate one on a phase change, never overlapping', async () => {
  const sent: LiveSample[] = [];
  let release: (() => void) | null = null;
  const r = new LiveReporter({ flightId: 7, client: fakeClient(async (_id, s) => { sent.push(s); await new Promise<void>((res) => { release = res; }); return null; }) });
  r.push(sim({ t: T0 }), 'airborne', []);
  r.push(sim({ t: T0 + 2_000 }), 'airborne', []);
  assert.equal(sent.length, 1, 'the first request is still in flight: no second one, the sample is dropped');
  release!(); await r.idle;
  r.push(sim({ t: T0 + 1_000 }), 'airborne', []);
  assert.equal(sent.length, 1, 'inside the interval');
  r.push(sim({ t: T0 + LIVE_INTERVAL_MS }), 'airborne', []);
  assert.equal(sent.length, 2);
  release!(); await r.idle;
  r.push(sim({ t: T0 + LIVE_INTERVAL_MS + 100 }), 'landed', []);
  assert.equal(sent.length, 3, 'phase change goes out at once');
  release!(); await r.idle;
  assert.equal(r.sent, 3);
});

test('LiveReporter: network errors, timeouts and server errors are logged once, never thrown, and a later success is noted', async () => {
  const log: string[] = [];
  let fail: Error | null = new ApiError('network', 'cannot reach http://x');
  const r = new LiveReporter({ flightId: 7, log: (l) => log.push(l), client: fakeClient(async () => { if (fail) throw fail; return null; }) });
  for (let i = 0; i < 4; i++) { r.push(sim({ t: T0 + i * 2_000 }), 'airborne', []); await r.idle; }
  assert.equal(log.filter((l) => /not reaching the server/.test(l)).length, 1, log.join('|'));
  assert.equal(r.stopped, false, 'keeps trying');
  fail = new ApiError('server', 'HTTP 500', 500);
  r.push(sim({ t: T0 + 10_000 }), 'airborne', []); await r.idle;
  fail = null;
  r.push(sim({ t: T0 + 12_000 }), 'airborne', []); await r.idle;
  assert.equal(r.sent, 1);
  assert.ok(log.some((l) => /reachable again/.test(l)));
  fail = new Error('boom'); // not even an ApiError
  r.push(sim({ t: T0 + 14_000 }), 'airborne', []); await r.idle;
});

test('LiveReporter: 429 drops the sample quietly; 404/401/409 stop live reporting for good; 400 is logged once', async () => {
  const log: string[] = [];
  const run = async (status: number) => {
    const rep = new LiveReporter({ flightId: 7, log: (l) => log.push(l), client: fakeClient(async () => { throw new ApiError(status >= 500 ? 'server' : 'refused', `HTTP ${status}`, status); }) });
    rep.push(sim({ t: T0 }), 'airborne', []); await rep.idle;
    rep.push(sim({ t: T0 + 2_000 }), 'airborne', []); await rep.idle;
    return rep;
  };
  log.length = 0;
  assert.deepEqual([(await run(429)).stopped, log.length], [false, 0]);
  for (const status of [404, 401, 403, 409]) { log.length = 0; const r = await run(status); assert.deepEqual([status, r.stopped, log.length], [status, true, 1], log.join('|')); }
  log.length = 0;
  assert.equal((await run(400)).stopped, false);
  assert.equal(log.length, 1);
});

test('Session.feed never waits for the network: a server that never answers does not slow or change the flight tracker', async () => {
  let posts = 0;
  const hang = fakeClient(() => { posts++; return new Promise(() => {}); });
  const live = new LiveReporter({ flightId: 7, client: hang });
  const noLive = new Session({ flight: { id: 7, from: 'LFPN', to: 'LFAQ', aircraftIcao: 'C172' }, serverUrl: 'http://x', client: {} as ServerClient, outbox: new Outbox('/nonexistent'), });
  const withLive = new Session({ flight: { id: 7, from: 'LFPN', to: 'LFAQ', aircraftIcao: 'C172' }, serverUrl: 'http://x', client: {} as ServerClient, outbox: new Outbox('/nonexistent'), live });
  const samples = readSamples(fileURLToPath(new URL('../fixtures/ga-c172-lfpn-lfaq.json', import.meta.url))).slice(0, 120);
  for (const s of samples) { noLive.feed(s); withLive.feed(s); assert.deepEqual(withLive.status, noLive.status); }
  assert.equal(posts, 1, 'one request in flight, the others are dropped, none waited for');
  assert.equal(withLive.status.phase, noLive.status.phase);
});

test('simconnect extras: decode reads altitude, heading, engine count and the per-engine gauges in definition order', () => {
  const d: number[] = [3_000, 271, ...Array.from({ length: MAX_ENGINES * 4 }, (_, i) => i + 1)];
  const r = decodeExtras({ readFloat64: () => d.shift()!, readInt32: () => 2 });
  assert.equal(d.length, 0, 'every double consumed');
  assert.deepEqual([r.altFt, r.headingDeg, r.engineCount], [3_000, 271, 2]);
  assert.deepEqual(r.engines[0], { torquePct: 1, n1Pct: 2, ittC: 3, oilPsi: 4 });
  assert.deepEqual(r.engines[3], { torquePct: 13, n1Pct: 14, ittC: 15, oilPsi: 16 });
  assert.equal(EXTRA_FIELDS.length, 3 + MAX_ENGINES * 4);
  assert.deepEqual(EXTRA_FIELDS.slice(0, 3).map((f) => f[0]), ['PLANE ALTITUDE', 'PLANE HEADING DEGREES TRUE', 'NUMBER OF ENGINES']);
});

test('simconnect extras: gauges follow the engine kind and the engine count; unavailable gauges are omitted, never zero', () => {
  const gauges = { torquePct: 55, n1Pct: 90, ittC: 700, oilPsi: 60 };
  const r = { altFt: 5_000, headingDeg: 10, engineCount: 2, engines: [gauges, { ...gauges, ittC: Number.NaN }, gauges, gauges] };
  assert.deepEqual(liveFields(r, 'piston').engines, [{ oilPsi: 60 }, { oilPsi: 60 }]);
  assert.deepEqual(liveFields(r, 'jet').engines, [{ n1Pct: 90, ittC: 700, oilPsi: 60 }, { n1Pct: 90, oilPsi: 60 }]);
  assert.deepEqual(liveFields(r, 'turboprop').engines![0], gauges);
  assert.equal(liveFields(r, 'other').engines, undefined);
  assert.equal(liveFields({ ...r, engineCount: 0 }, 'jet').engines, undefined, 'no engines reported: no list');
  assert.equal(liveFields({ ...r, engineCount: 99 }, 'jet').engines!.length, MAX_ENGINES);
  assert.deepEqual(liveFields({ ...r, altFt: Number.NaN, headingDeg: Number.NaN }, 'piston').altFt, undefined);
});

test('mapper: extras ride on the sample; garbage extras never invalidate the sample the tracker depends on', () => {
  const reading = { atcModel: 'C172', title: 'C172', category: 'Airplane', engineType: 0, onGround: 0, slew: 0, lat: 48.75, lon: 2.1, groundSpeedKts: 100, verticalSpeedFpm: 0, touchdownFpm: 0, fuelKg: 50, totalWeightKg: 900, emptyWeightKg: 770, simRate: 1 };
  const m = new SampleMapper();
  const withExtras = m.map(reading, 1_000, false, { altFt: 4_500, headingDeg: 123, engineCount: 1, engines: [{ torquePct: 0, n1Pct: 0, ittC: 0, oilPsi: 55 }] });
  assert.ok('sample' in withExtras);
  assert.deepEqual([withExtras.sample.altFt, withExtras.sample.headingDeg, withExtras.sample.engines], [4_500, 123, [{ oilPsi: 55 }]]);
  const without = new SampleMapper().map(reading, 1_000, false);
  assert.ok('sample' in without && without.sample.altFt === undefined && without.sample.engines === undefined);
  const bad = new SampleMapper().map(reading, 1_000, false, { altFt: Number.NaN, headingDeg: Number.POSITIVE_INFINITY, engineCount: Number.NaN, engines: [] });
  assert.ok('sample' in bad && bad.sample.altFt === undefined && bad.sample.headingDeg === undefined && bad.sample.engines === undefined);
});

test('watchSim: reports the link as waiting while no simulator answers', async () => {
  const states: string[] = [];
  const stop = await watchSim(() => assert.fail('no sample without a simulator'), {
    log: () => {}, retryMs: 10_000, connection: { remote: { host: '127.0.0.1', port: 1 } }, onState: (s) => states.push(s),
  });
  await new Promise((r) => setTimeout(r, 300));
  stop();
  assert.deepEqual([...new Set(states)], ['waiting']);
});
