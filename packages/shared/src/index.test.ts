import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aircraftPrice, aircraftValue, blockHours, cannotFly, checkTelemetry, customAircraftSchema, deriveAircraft, distanceNm,
  fallbackAircraft, fuelBurnKg, jobPayout, minFlightHours, landingFee, rankFor, resolveCatalogEntry, seasonOf, settle, telemetrySchema,
  MANUAL_PAY_FACTOR, registerSchema,
  type AircraftType, type Telemetry,
} from './index.ts';

const a320 = deriveAircraft({ icao: 'A320', name: 'Airbus A-320', category: 'jet-airliner', engines: 2, wtc: 'M' });
const c172 = deriveAircraft({ icao: 'C172', name: 'Cessna 172', category: 'piston-single', engines: 1, wtc: 'L' });

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

test('settle: measured values override estimates and hard landings cost maintenance + reputation', () => {
  const base = { payout: 10_000, distanceNm: 300, aircraft: c172, destSize: 'small' as const, destIsHub: false, status: 'verified' as const };
  const est = settle(base);
  const hard = settle({ ...base, landingFpm: -900, fuelUsedKg: 100, blockHours: 3 });
  assert.equal(hard.fuelCost, 90);
  assert.ok(hard.maintenance > est.maintenance);
  assert.ok(hard.reputationDelta < 0);
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
  acceptedAt: Date.UTC(2026, 10, 4, 10), now: Date.UTC(2026, 10, 4, 14),
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
    [{ landedAt: '2026-11-04T13:59:00Z' }, /too long/],
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

test('register schema bounds username and password', () => {
  assert.ok(registerSchema.safeParse({ username: 'abc', password: '12345678' }).success);
  assert.ok(!registerSchema.safeParse({ username: 'a b', password: '12345678' }).success);
  assert.ok(!registerSchema.safeParse({ username: 'abc', password: 'short' }).success);
});
