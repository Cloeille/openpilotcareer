import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUARD_FIELDS, SampleMapper, TrackSignals, decode, decodeGuard, watchSim } from '../src/simconnect.ts';
import { FlightTracker } from '../src/tracker.ts';

// A reading as decode() returns it: SimConnect units already converted by the data definition (knots, fpm, kg, degrees).
const reading = (over: Partial<Parameters<SampleMapper['map']>[0]> = {}): Parameters<SampleMapper['map']>[0] => ({
  atcModel: 'C172', title: 'Cessna 172 Skyhawk', category: 'Airplane', engineType: 0, onGround: 1, slew: 0,
  lat: 49.0097, lon: 2.5479, groundSpeedKts: 0, verticalSpeedFpm: 0, touchdownFpm: 0,
  fuelKg: 100, totalWeightKg: 1000, emptyWeightKg: 770, simRate: 1, ...over,
});

test('decode reads the values in the order of the data definition', () => {
  const doubles = [1, 2, 3, 4, 5, 6, 7, 8, 9];   // lat lon groundSpeed verticalSpeed touchdown fuel total empty simRate
  const ints = [5, 1, 0];                         // engineType onGround slew
  const r = decode({
    readString64: () => 'TT:ATCCOM.AC_MODEL_A20N.0.text', readString256: () => 'Airbus A320neo', readString32: () => 'Airplane',
    readInt32: () => ints.shift()!, readFloat64: () => doubles.shift()!,
  });
  assert.deepEqual(r, {
    atcModel: 'TT:ATCCOM.AC_MODEL_A20N.0.text', title: 'Airbus A320neo', category: 'Airplane', engineType: 5, onGround: 1, slew: 0,
    lat: 1, lon: 2, groundSpeedKts: 3, verticalSpeedFpm: 4, touchdownFpm: 5, fuelKg: 6, totalWeightKg: 7, emptyWeightKg: 8, simRate: 9,
  });
  assert.equal(doubles.length + ints.length, 0, 'every field consumed exactly once');
});

test('mapper: engine kinds, unknown empty weight, flags and the pause state', () => {
  const m = new SampleMapper();
  const kind = (over: Parameters<typeof reading>[0]) => { const r = m.map(reading(over), 1_000, false); return 'sample' in r ? r.sample.engineKind : r.why; };
  assert.equal(kind({ engineType: 0 }), 'piston');
  assert.equal(kind({ engineType: 1 }), 'jet');
  assert.equal(kind({ engineType: 5 }), 'turboprop');
  assert.equal(kind({ engineType: 3, category: 'Helicopter' }), 'helicopter');
  assert.equal(kind({ category: 'Helicopter', engineType: 0 }), 'helicopter');
  assert.equal(kind({ engineType: 6 }), 'other');
  const noEmpty = m.map(reading({ emptyWeightKg: 0 }), 2_000, true);
  assert.ok('sample' in noEmpty && noEmpty.sample.emptyWeightKg === undefined && noEmpty.sample.paused);
  const cheat = m.map(reading({ slew: 1, simRate: 4 }), 3_000, false);
  assert.ok('sample' in cheat && cheat.sample.slew && cheat.sample.simRate === 4);
});

test('mapper: garbage from the sim is rejected with the field name, not passed on', () => {
  const m = new SampleMapper();
  for (const [field, bad] of [['lat', 95], ['lon', NaN], ['fuelKg', -1], ['simRate', 0]] as const) {
    const r = m.map(reading({ [field]: bad }), 1_000, false);
    assert.ok('why' in r && r.why.startsWith(field), `${field}: ${JSON.stringify(r)}`);
  }
});

test('mapper: a touchdown rate is reported once, on the first ground reading after the latched value changed', () => {
  const m = new SampleMapper();
  const td = (over: Parameters<typeof reading>[0], t: number) => { const r = m.map(reading(over), t, false); assert.ok('sample' in r); return r.sample.touchdownFpm; };
  assert.equal(td({ onGround: 1, touchdownFpm: -312 }, 1_000), undefined, 'first reading: the latch belongs to an earlier landing');
  assert.equal(td({ onGround: 0, touchdownFpm: -312 }, 2_000), undefined);
  assert.equal(td({ onGround: 0, touchdownFpm: -180 }, 3_000), undefined, 'latch changed while the wheels are not down yet: held back');
  assert.equal(td({ onGround: 1, touchdownFpm: -180 }, 4_000), -180);
  assert.equal(td({ onGround: 1, touchdownFpm: -180 }, 5_000), undefined, 'reported once');
});

test('mapped readings walk the tracker through a whole flight', () => {
  const m = new SampleMapper();
  const tr = new FlightTracker();
  let t = Date.UTC(2026, 10, 4, 9);
  const feed = (over: Parameters<typeof reading>[0], n = 1) => { for (let i = 0; i < n; i++) { const r = m.map(reading(over), (t += 1_000), false); assert.ok('sample' in r); tr.feed(r.sample); } };
  const LFPN = { lat: 48.7516, lon: 2.1062 }, LFAQ = { lat: 49.9715, lon: 2.6977 };
  feed({ ...LFPN, groundSpeedKts: 0 }, 5);
  feed({ ...LFPN, groundSpeedKts: 12 }, 5);
  feed({ ...LFPN, onGround: 0, groundSpeedKts: 70, verticalSpeedFpm: 700 }, 5);
  assert.equal(tr.phase, 'airborne');
  feed({ ...LFAQ, onGround: 0, groundSpeedKts: 65, verticalSpeedFpm: -500 });
  feed({ ...LFAQ, onGround: 1, groundSpeedKts: 60, touchdownFpm: -200 });
  feed({ ...LFAQ, onGround: 1, groundSpeedKts: 0, touchdownFpm: -200 }, 40);
  assert.equal(tr.phase, 'parked');
  assert.ok(tr.outcome?.ok && tr.outcome.report.landingFpm === -200 && tr.outcome.report.departureIcao === 'LFPN' && tr.outcome.report.arrivalIcao === 'LFAQ', JSON.stringify(tr.outcome));
});

test('watchSim without a simulator: node-simconnect loads lazily, says it is waiting, and stops cleanly', async () => {
  const lines: string[] = [];
  const stop = await watchSim(() => assert.fail('no sample without a simulator'), {
    log: (l) => lines.push(l), retryMs: 10_000, connection: { remote: { host: '127.0.0.1', port: 1 } },
  });
  await new Promise((r) => setTimeout(r, 300));
  stop();
  assert.equal(lines.length, 1, lines.join('|'));
  assert.match(lines[0]!, /waiting for the simulator.*trying again in 10 s/);
});

test('guard readings: the SimVars are decoded in order and become the sample\'s height and crash marks', () => {
  assert.deepEqual(GUARD_FIELDS.map((f) => f[0]), ['PLANE ALT ABOVE GROUND', 'CRASH FLAG', 'CRASH SEQUENCE']);
  const ints = [4, 0];
  assert.deepEqual(decodeGuard({ readFloat64: () => 812.5, readInt32: () => ints.shift()! }), { aglFt: 812.5, crashFlag: 4, crashSequence: 0 });
  const sig = new TrackSignals();
  assert.deepEqual(sig.marks(), {}, 'before the first guard reading nothing is claimed');
  sig.guard({ aglFt: 812.5, crashFlag: 0, crashSequence: 0 });
  assert.deepEqual(sig.marks(), { aglFt: 812.5 });
  sig.guard({ aglFt: Number.NaN, crashFlag: 0, crashSequence: 0 });
  assert.deepEqual(sig.marks(), {}, 'a garbage height is left out, not repaired');
  for (const g of [{ crashFlag: 4, crashSequence: 0 }, { crashFlag: 0, crashSequence: 11 }]) { sig.guard({ aglFt: 10, ...g }); assert.equal(sig.marks().crashed, true); }
  const m = new SampleMapper().map(reading(), 1_000, false, undefined, { aglFt: 10, crashed: true, resumed: 'reload' });
  assert.ok('sample' in m && m.sample.aglFt === 10 && m.sample.crashed === true && m.sample.resumed === 'reload');
});

test('track signals: Crashed is latched, a reload or a lost link is reported once on the next sample, and the lost link wins', () => {
  const sig = new TrackSignals();
  sig.crashed();
  assert.equal(sig.marks().crashed, true);
  sig.sent();
  assert.equal(sig.marks().crashed, true, 'still crashed until a flight is loaded');
  sig.flightLoaded();
  assert.deepEqual(sig.marks(), { resumed: 'reload', crashed: true }, 'on the first sample after the load, `crashed` speaks for the time before it');
  assert.deepEqual(sig.marks(), { resumed: 'reload', crashed: true }, 'asking twice changes nothing until the sample is sent');
  sig.sent();
  assert.deepEqual(sig.marks(), {}, 'one break, one mark; the crash is forgotten with the flight');
  sig.guard({ aglFt: 10, crashFlag: 4, crashSequence: 11 });
  sig.flightLoaded();
  assert.deepEqual(sig.marks(), { aglFt: 10, resumed: 'reload' }, 'the SimVars describe the state after the break, so they never make a reload a crash');
  sig.flightLoaded(); sig.linkLost(); sig.flightLoaded();
  assert.equal(sig.marks().resumed, 'reconnect');
  sig.sent();
  sig.linkLost();
  assert.equal(sig.marks().resumed, 'reconnect');
});

test('mapped marks reach the tracker: a dive, then the host reporting a reload, flags the reload', () => {
  const m = new SampleMapper(), tr = new FlightTracker(), sig = new TrackSignals();
  let t = Date.UTC(2026, 10, 4, 9);
  const feed = (over: Parameters<typeof reading>[0]) => { const r = m.map(reading(over), (t += 1_000), false, undefined, sig.marks()); assert.ok('sample' in r); sig.sent(); tr.feed(r.sample); };
  const LFPN = { lat: 48.7516, lon: 2.1062 };
  feed({ ...LFPN }); feed({ ...LFPN, groundSpeedKts: 12 });
  for (let i = 0; i < 5; i++) feed({ ...LFPN, onGround: 0, groundSpeedKts: 70, verticalSpeedFpm: 700 });
  feed({ ...LFPN, onGround: 0, groundSpeedKts: 150, verticalSpeedFpm: -7_000 });
  sig.flightLoaded();
  feed({ ...LFPN, onGround: 0, groundSpeedKts: 70, verticalSpeedFpm: 700 });
  assert.deepEqual(tr.flags, ['reload_after_crash']);
});
