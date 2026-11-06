import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBridgeLost, liveProgress, liveSampleSchema, LIVE_BRIDGE_LOST_MS, type LiveSample } from './index.ts';

const s = (over: Partial<LiveSample> = {}): LiveSample => ({
  t: 1, lat: 49.0097, lon: 2.5479, altFt: 30_000, gsKts: 400, vsFpm: 0, headingDeg: 300, fuelKg: 5_000, phase: 'airborne', paused: false, simRate: 1, flags: [], engines: [], ...over,
});
const EGLL = { lat: 51.47, lon: -0.4543 };

test('liveProgress: LFPG to EGLL is about 195 nm and the ETA follows the ground speed', () => {
  const p = liveProgress(s(), 1_000_000, EGLL);
  assert.ok(p.remainingNm! > 185 && p.remainingNm! < 205, String(p.remainingNm));
  assert.ok(Math.abs((p.etaAt! - 1_000_000) / 3_600_000 - p.remainingNm! / 400) < 0.001);
});

test('liveProgress: no destination, on the ground, paused or crawling gives no ETA', () => {
  assert.deepEqual(liveProgress(s(), 0, null), { remainingNm: null, etaAt: null });
  for (const over of [{ phase: 'taxiOut' as const }, { phase: 'landed' as const }, { paused: true }, { gsKts: 29 }]) {
    const p = liveProgress(s(over), 0, EGLL);
    assert.equal(p.etaAt, null, JSON.stringify(over));
    assert.ok(p.remainingNm! > 0);
  }
});

test('isBridgeLost: needs a first sample, then strictly more than 30 s of silence', () => {
  assert.equal(isBridgeLost(null, 1e12), false);
  assert.equal(isBridgeLost(1_000, 1_000 + LIVE_BRIDGE_LOST_MS), false);
  assert.equal(isBridgeLost(1_000, 1_001 + LIVE_BRIDGE_LOST_MS), true);
});

test('liveSampleSchema: accepts a full sample, drops unknown keys, refuses NaN and out-of-range values', () => {
  assert.deepEqual(liveSampleSchema.parse({ ...s({ engines: [{ torquePct: 80 }, {}] }), extra: 1 }), s({ engines: [{ torquePct: 80 }, {}] }));
  assert.equal(liveSampleSchema.safeParse(s({ lat: Number.NaN })).success, false);
  assert.equal(liveSampleSchema.safeParse(s({ vsFpm: 1e6 })).success, false);
  assert.equal(liveSampleSchema.safeParse(s({ engines: [{ oilPsi: -1 }] })).success, false);
});
