import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aircraftPrice, aircraftValue, blockHours, cannotFly, checkTelemetry, customAircraftSchema, infoSchema, deriveAircraft, distanceNm,
  fallbackAircraft, fuelBurnKg, hardLandingFpm, interruptionsSchema, isHardLanding, jobPayout, minFlightHours, landingFee, rankFor, resolveCatalogEntry, seasonOf, settle, telemetrySchema,
  MANUAL_PAY_FACTOR, REJECT_REPUTATION_PENALTY, registerSchema,
  type AircraftType, type Telemetry,
} from './index.ts';

const a320 = deriveAircraft({ icao: 'A320', name: 'Airbus A-320', category: 'jet-airliner', engines: 2, wtc: 'M' });
const c172 = deriveAircraft({ icao: 'C172', name: 'Cessna 172', category: 'piston-single', engines: 1, wtc: 'L' });
const qasr = resolveCatalogEntry({ icao: 'QASR', name: 'Flying Fries Quasar', category: 'spaceplane', engines: 4, wtc: 'H', perf: { seats: 0, cargoKg: 2000, cruiseKts: 5000, rangeNm: 9999 } });
const a20n = resolveCatalogEntry({ icao: 'A20N', name: 'Airbus A320neo', category: 'jet-airliner', engines: 2, wtc: 'M', perf: { seats: 180, cargoKg: 4000, cruiseKts: 447, rangeNm: 3400 } });

test('distanceNm: LFPG-EGLL is about 195 nm', () => {
  const d = distanceNm(49.0097, 2.5479, 51.47, -0.4543);
  assert.ok(d > 185 && d < 205, String(d));
  assert.equal(distanceNm(10, 10, 10, 10), 0);
});

test('derived aircraft come from category defaults and are flagged', () => {
  assert.equal(c172.derived, true);
  assert.equal(c172.seats, 4);
  assert.equal(a320.cruiseKts, 450);
  const twin = deriveAircraft({ icao: 'XXXX', name: 'x', category: 'piston-single', engines: 2, wtc: 'L' });
  assert.ok(twin.seats > c172.seats, 'more engines -> larger');
});

test('curated catalog entry keeps real values and is not derived', () => {
  const t = resolveCatalogEntry({ icao: 'B738', name: 'Boeing 737-800', category: 'jet-airliner', engines: 2, wtc: 'M', perf: { seats: 189, cargoKg: 4000, cruiseKts: 453, rangeNm: 2935 } });
  assert.equal(t.derived, false);
  assert.equal(t.seats, 189);
});

test('unknown ICAO falls back to a flyable category aircraft', () => {
  const f = fallbackAircraft('ZZZZ');
  assert.equal(f.icao, 'ZZZZ');
  assert.equal(f.category, 'other');
  assert.ok(f.seats > 0 && f.cruiseKts > 0 && f.rangeNm > 0);
  assert.ok(aircraftPrice(f) > 0);
});

test('custom aircraft schema validates and rejects zero capacity', () => {
  const ok = { icao: 'MYAC', name: 'My plane', category: 'piston-single', engines: 1, wtc: 'L', seats: 2, cargoKg: 0, cruiseKts: 100, rangeNm: 300 };
  assert.ok(customAircraftSchema.safeParse(ok).success);
  assert.ok(!customAircraftSchema.safeParse({ ...ok, seats: 0 }).success);
  assert.ok(!customAircraftSchema.safeParse({ ...ok, icao: 'lower' }).success);
  assert.ok(!customAircraftSchema.safeParse({ ...ok, cruiseKts: 5000 }).success);
});

test('payout = distance x payload x rate; light loads earn a higher rate per kg', () => {
  assert.ok(jobPayout('pax', 200, 300) < jobPayout('pax', 400, 300));
  assert.ok(jobPayout('pax', 200, 300) < jobPayout('pax', 200, 600));
  assert.ok(jobPayout('cargo', 500, 1000) < jobPayout('pax', 500, 1000));
  assert.ok(jobPayout('pax', 500, 100) / 100 > jobPayout('pax', 500, 10000) / 10000);
  assert.equal(jobPayout('pax', 0, 500), 0);
});

test('cannotFly uses only the aircraft record', () => {
  const job = { kind: 'pax' as const, pax: 100, payloadKg: 10_000, distanceNm: 500 };
  assert.equal(cannotFly(a320, job), null);
  assert.match(cannotFly(c172, job) ?? '', /seats/);
  assert.match(cannotFly(c172, { ...job, pax: 2, distanceNm: 5000 }) ?? '', /range/);
  assert.match(cannotFly(a320, { kind: 'cargo', pax: 0, payloadKg: 99_000, distanceNm: 10 }) ?? '', /cargo/);
  assert.match(cannotFly(a320, { ...job, requiredAircraft: 'B738' }) ?? '', /requires a B738/);
});

test('settle: verified flight is profitable for a sensible job; unverified pays MANUAL_PAY_FACTOR', () => {
  const dist = 600, payout = jobPayout('pax', dist, 14_000);
  const base = { payout, distanceNm: dist, aircraft: a320, destSize: 'large' as const, destIsHub: false };
  const v = settle({ ...base, status: 'verified' });
  const u = settle({ ...base, status: 'unverified' });
  assert.equal(v.revenue, payout);
  assert.equal(u.revenue, Math.round(payout * MANUAL_PAY_FACTOR));
  assert.equal(v.net, v.revenue - v.fuelCost - v.landingFee - v.maintenance);
  assert.ok(v.net > 0);
  assert.ok(u.net < v.net);
  assert.ok(v.reputationDelta > u.reputationDelta);
});

test('settle: measured values override estimates and hard landings double the upkeep and cancel the reputation gain', () => {
  const base = { payout: 10_000, distanceNm: 300, aircraft: c172, destSize: 'small' as const, destIsHub: false, status: 'verified' as const };
  const est = settle(base);
  const hard = settle({ ...base, landingFpm: -900, fuelUsedKg: 100, blockHours: 3 });
  assert.equal(hard.fuelCost, 90);
  assert.ok(hard.maintenance > est.maintenance);
  assert.equal(hard.reputationDelta, 0);
  assert.ok(settle({ ...base, landingFpm: -200 }).reputationDelta > 0);
});

test('costs scale: hub landing is cheaper, heavier aircraft cost more, longer flights burn more', () => {
  assert.ok(landingFee(a320, 'large', true) < landingFee(a320, 'large', false));
  assert.ok(landingFee(a320, 'large', false) > landingFee(c172, 'large', false));
  assert.ok(fuelBurnKg(a320, 800) > fuelBurnKg(a320, 400));
  assert.ok(blockHours(a320, 800) > blockHours(a320, 400));
  assert.ok(minFlightHours(a320, 450) < 450 / a320.cruiseKts);
  assert.ok(aircraftValue(a320) < aircraftPrice(a320));
});

test('rankFor needs both hours and flights', () => {
  assert.equal(rankFor(0, 0), 'Student Pilot');
  assert.equal(rankFor(100, 0), 'Student Pilot');
  assert.equal(rankFor(5, 3), 'Private Pilot');
  assert.equal(rankFor(60, 30), 'Commercial Pilot');
  assert.equal(rankFor(60, 10), 'Private Pilot');
  assert.equal(rankFor(5000, 5000), 'Senior Captain');
});

test('seasonOf is the UTC month', () => {
  assert.equal(seasonOf(Date.UTC(2026, 10, 4, 12)), '2026-11');
  assert.equal(seasonOf(Date.UTC(2026, 11, 31, 23, 59)), '2026-12');
});

const flight = {
  origin: 'LFPG', destination: 'EGLL', distanceNm: 200, payloadKg: 8000, aircraftIcao: 'A320', aircraft: a320 as AircraftType,
  acceptedAt: Date.UTC(2026, 10, 4, 10), now: Date.UTC(2026, 10, 4, 14), antiCheat: true,
};
const report: Telemetry = {
  takeoffAt: '2026-11-04T10:30:00Z', landedAt: '2026-11-04T11:15:00Z', departureIcao: 'LFPG', arrivalIcao: 'EGLL', aircraftIcao: 'A320',
  payloadKg: 8000, fuelUsedKg: fuelBurnKg(a320, 200), landingFpm: -240, distanceNm: 205, source: 'simconnect',
};

test('telemetry schema rejects malformed payloads', () => {
  assert.ok(telemetrySchema.safeParse(report).success);
  assert.ok(!telemetrySchema.safeParse({ ...report, source: 'cheat' }).success);
  assert.ok(!telemetrySchema.safeParse({ ...report, takeoffAt: 'yesterday' }).success);
  assert.ok(!telemetrySchema.safeParse({ ...report, departureIcao: 'lfpg' }).success);
  assert.ok(!telemetrySchema.safeParse({ ...report, fuelUsedKg: -1 }).success);
});

test('checkTelemetry accepts a plausible flight and returns its block hours', () => {
  assert.deepEqual(checkTelemetry(report, flight), { ok: true, blockHours: 0.75 });
});

test('checkTelemetry rejects each implausible dimension with a reason', () => {
  const cases: [Partial<Telemetry>, RegExp][] = [
    [{ departureIcao: 'LFPO' }, /departure/],
    [{ arrivalIcao: 'EGKK' }, /arrival/],
    [{ aircraftIcao: 'C172' }, /aircraft/],
    [{ landedAt: '2026-11-04T10:00:00Z' }, /not after takeoff/],
    [{ landedAt: '2026-11-04T11:00:00Z', takeoffAt: '2026-11-04T10:59:00Z' }, /too short/],
    [{ landedAt: '2026-11-04T15:00:00Z', takeoffAt: '2026-11-04T14:30:00Z' }, /future/],
    [{ takeoffAt: '2026-11-04T08:00:00Z' }, /predates/],
    [{ distanceNm: 20 }, /distance/],
    [{ payloadKg: 100 }, /payload/],
    [{ fuelUsedKg: 5 }, /fuel/],
    [{ landingFpm: -4000 }, /structural/],
  ];
  for (const [patch, re] of cases) {
    const r = checkTelemetry({ ...report, ...patch }, flight);
    assert.equal(r.ok, false, JSON.stringify(patch));
    if (!r.ok) assert.match(r.reason, re, JSON.stringify(patch));
  }
});

test('client-raised anti-cheat flags fail the check; an empty list is fine; malformed flags are a schema error', () => {
  const r = checkTelemetry({ ...report, flags: ['slew_detected', 'time_acceleration_above_1x'] }, flight);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /flagged.*slew_detected, time_acceleration_above_1x/);
  assert.deepEqual(checkTelemetry({ ...report, flags: [] }, flight), { ok: true, blockHours: 0.75 });
  assert.ok(telemetrySchema.safeParse({ ...report, flags: ['slew_detected'] }).success);
  assert.ok(!telemetrySchema.safeParse({ ...report, flags: ['Not A Flag'] }).success);
  assert.ok(!telemetrySchema.safeParse({ ...report, flags: 'slew' }).success);
});

test('with anti-cheat off, flags and implausible numbers pass but the report must still match the job', () => {
  const off = { ...flight, antiCheat: false };
  const cheat: Telemetry = {
    ...report, flags: ['time_acceleration_above_1x'], landedAt: '2026-11-04T11:00:00Z', takeoffAt: '2026-11-04T10:59:00Z',
    distanceNm: 20, payloadKg: 100, fuelUsedKg: 5, landingFpm: -4000,
  };
  const on = checkTelemetry(cheat, flight);
  assert.equal(on.ok, false);
  assert.deepEqual(checkTelemetry(cheat, off), { ok: true, blockHours: 1 / 60 });
  for (const patch of [{ departureIcao: 'LFPO' }, { arrivalIcao: 'EGKK' }, { aircraftIcao: 'C172' }, { landedAt: '2026-11-04T10:00:00Z' },
    { landedAt: '2026-11-04T15:00:00Z', takeoffAt: '2026-11-04T14:30:00Z' }, { takeoffAt: '2026-11-04T08:00:00Z' }]) {
    for (const antiCheat of [true, false]) assert.equal(checkTelemetry({ ...cheat, ...patch }, { ...flight, antiCheat }).ok, false, `${JSON.stringify(patch)} antiCheat=${antiCheat}`);
  }
});

test('server info: antiCheat defaults to true for servers that predate the setting', () => {
  const base = { name: 'Old', version: '0.1.0', apiVersion: 1, registrationOpen: true };
  assert.equal(infoSchema.parse(base).antiCheat, true);
  assert.equal(infoSchema.parse({ ...base, antiCheat: false }).antiCheat, false);
  assert.ok(!infoSchema.safeParse({ ...base, antiCheat: 'off' }).success);
});

test('register schema bounds username and password', () => {
  assert.ok(registerSchema.safeParse({ username: 'abc', password: '12345678' }).success);
  assert.ok(!registerSchema.safeParse({ username: 'a b', password: '12345678' }).success);
  assert.ok(!registerSchema.safeParse({ username: 'abc', password: 'short' }).success);
});

test('interruptions: optional in the report, bounded, and they never change the verdict or the pay', () => {
  const interruptions = { reloads: 1, simRestarts: 1, downtimeMs: 90 * 60_000 };
  assert.ok(telemetrySchema.safeParse({ ...report, interruptions }).success);
  assert.ok(telemetrySchema.safeParse(report).success, 'old bridges omit it');
  for (const bad of [{ ...interruptions, downtimeMs: -1 }, { ...interruptions, reloads: 1.5 }, { ...interruptions, simRestarts: 1_001 }, { ...interruptions, downtimeMs: 8 * 24 * 3_600_000 }, { reloads: 1 }, 'crash']) {
    assert.ok(!telemetrySchema.safeParse({ ...report, interruptions: bad }).success, JSON.stringify(bad));
  }
  assert.ok(interruptionsSchema.safeParse({ reloads: 0, simRestarts: 0, downtimeMs: 0 }).success);
  assert.deepEqual(checkTelemetry({ ...report, interruptions }, flight), { ok: true, blockHours: 0.75 }, 'the paid block time is the real one');
  const fast = { landedAt: '2026-11-04T11:00:00Z', takeoffAt: '2026-11-04T10:59:00Z' };
  assert.equal(checkTelemetry({ ...report, ...fast, interruptions }, flight).ok, false, 'downtime never excuses a flight that is too short');
  const r = checkTelemetry({ ...report, flags: ['reload_after_crash'], interruptions }, flight);
  assert.ok(!r.ok && /flagged.*reload_after_crash/.test(r.reason), 'the interruptions never tolerate the flag');
});

test('a flight is never rejected for being too long: 5x, 50x the expected time is verified and paid for its real block time', () => {
  for (const factor of [5, 50]) {
    const takeoff = Date.parse(report.takeoffAt), hours = 0.75 * factor;
    const slow = { ...report, landedAt: new Date(takeoff + hours * 3_600_000).toISOString() };
    const r = checkTelemetry(slow, { ...flight, now: takeoff + 100 * 3_600_000 });
    assert.deepEqual(r, { ok: true, blockHours: hours }, `${factor}x`);
  }
  assert.equal(checkTelemetry({ ...report, landedAt: '2026-11-04T13:59:00Z' }, flight).ok, true, '3.5 h for 200 nm');
});

test('checkTelemetry: 5000 kts is a normal cruise for a QASR and too short a flight for an A20N', () => {
  const hours = 3000 / 5000 + 0.1, landedAt = new Date(Date.parse('2026-11-04T10:30:00Z') + hours * 3_600_000).toISOString();
  const fast = (aircraft: AircraftType, icao: string): ReturnType<typeof checkTelemetry> => checkTelemetry(
    { ...report, aircraftIcao: icao, landedAt, payloadKg: 2000, distanceNm: 3005, fuelUsedKg: fuelBurnKg(aircraft, 3000) },
    { ...flight, aircraftIcao: icao, aircraft, distanceNm: 3000, payloadKg: 2000 });
  assert.equal(fast(qasr, 'QASR').ok, true);
  const r = fast(a20n, 'A20N');
  assert.ok(!r.ok && /flight too short/.test(r.reason));
});


test('hard landing is a per-category threshold: 600 fpm, 900 for a spaceplane', () => {
  assert.deepEqual([hardLandingFpm(a20n), hardLandingFpm(c172), hardLandingFpm(qasr)], [600, 600, 900]);
  assert.equal(isHardLanding(qasr, -631), false);
  assert.equal(isHardLanding(qasr, -950), true);
  assert.equal(isHardLanding(a20n, -631), true);
  const base = { payout: 30_000, distanceNm: 1000, destSize: 'large' as const, destIsHub: false, status: 'verified' as const, blockHours: 1.5 };
  const soft = settle({ ...base, aircraft: qasr, landingFpm: -631 }), hard = settle({ ...base, aircraft: qasr, landingFpm: -950 });
  assert.equal(hard.maintenance, 2 * soft.maintenance, 'a hard landing doubles the upkeep');
  assert.equal(settle({ ...base, aircraft: a20n, landingFpm: -631 }).maintenance, 2 * settle({ ...base, aircraft: a20n, landingFpm: -200 }).maintenance);
});

test('a completed flight never lowers reputation: a hard landing cancels the gain, a normal one still earns it, a rejection is still -2', () => {
  const base = { payout: 5_000, distanceNm: 300, aircraft: a320, destSize: 'large' as const, destIsHub: false };
  assert.equal(settle({ ...base, status: 'verified', landingFpm: -900 }).reputationDelta, 0);
  assert.equal(settle({ ...base, status: 'unverified', landingFpm: -900 }).reputationDelta, 0);
  assert.equal(settle({ ...base, status: 'verified', landingFpm: -900, repModifierPct: 30 }).reputationDelta, 0);
  assert.equal(settle({ ...base, status: 'verified', landingFpm: -200 }).reputationDelta, 0.1);
  assert.equal(settle({ ...base, status: 'verified', landingFpm: -200, repModifierPct: 30 }).reputationDelta, 0.1 * 1.3);
  assert.equal(settle({ ...base, status: 'verified', repModifierPct: -50 }).reputationDelta, 0.05);
  assert.ok(settle({ ...base, status: 'verified', repModifierPct: -150 }).reputationDelta >= 0, 'a negative realism modifier cannot push it below zero');
  assert.equal(REJECT_REPUTATION_PENALTY, 2);
});

test('the Quasar regenerates its fuel: a settlement has no fuel cost whatever the report says, and no fuel check applies', () => {
  const base = { payout: 30_000, distanceNm: 1010, aircraft: qasr, destSize: 'large' as const, destIsHub: false, status: 'verified' as const };
  assert.equal(settle({ ...base, fuelUsedKg: 5005 }).fuelCost, 0);
  assert.equal(settle({ ...base, fuelUsedKg: 5005, fuelPriceFactor: 1.25 }).fuelCost, 0);
  assert.equal(settle(base).fuelCost, 0);
  assert.ok(settle({ ...base, aircraft: a20n, distanceNm: 600 }).fuelCost > 0, 'every other aircraft pays its fuel');
  const hours = 3000 / 5000 + 0.1, landedAt = new Date(Date.parse('2026-11-04T10:30:00Z') + hours * 3_600_000).toISOString();
  const weird = (fuelUsedKg: number): ReturnType<typeof checkTelemetry> => checkTelemetry(
    { ...report, aircraftIcao: 'QASR', landedAt, payloadKg: 2000, distanceNm: 3005, fuelUsedKg },
    { ...flight, aircraftIcao: 'QASR', aircraft: qasr, distanceNm: 3000, payloadKg: 2000 });
  for (const fuel of [0, 5, 5005, 90_000]) assert.equal(weird(fuel).ok, true, `${fuel} kg`);
  const a = checkTelemetry({ ...report, fuelUsedKg: 5 }, flight);
  assert.ok(!a.ok && /fuel/.test(a.reason), 'an airliner is still checked');
});

test('flight 138: a 29 291 express job on the Quasar, +30 %, 1.53 h, -631 fpm, nets about 31 k', () => {
  const s = settle({ payout: 29_291, distanceNm: 1010, aircraft: qasr, destSize: 'large', destIsHub: false, status: 'verified', blockHours: 1.53, landingFpm: -631, fuelUsedKg: 5449, payModifierPct: 30, repModifierPct: 30 });
  assert.deepEqual([s.revenue, s.fuelCost, s.landingFee, s.maintenance, s.net], [38_078, 0, 2_250, 4_284, 31_544]);
  assert.ok(s.reputationDelta > 0);
});
