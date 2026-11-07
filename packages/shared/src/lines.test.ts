import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS, LINE_TICK_MS, daysToMask, dayStart, hhmmToMin, inheritedDelayMin, isoDay, layoutDay, lineBodySchema, lineTickOf, maskToDays, minToHhmm, overlappingLegs,
  pairLoadFactor, programmeProblem, stoppageReputation, stoppageReputationTotal, weekdayOf, weeklyDemand, weeklySeats, wearDelayMin, type Programme,
} from './lines.ts';

const WED = Date.UTC(2026, 10, 4); // Wednesday 4 Nov 2026, 00:00Z

test('clock helpers: 15 minute ticks, UTC days, Monday-first weekday', () => {
  assert.equal(lineTickOf(WED), WED / LINE_TICK_MS);
  assert.equal(lineTickOf(WED + LINE_TICK_MS - 1), lineTickOf(WED));
  assert.equal(lineTickOf(WED + LINE_TICK_MS), lineTickOf(WED) + 1);
  assert.equal(isoDay(WED + 23 * 3_600_000), '2026-11-04');
  assert.equal(dayStart(WED + 5_000), WED);
  assert.equal(weekdayOf(WED), 2);
  assert.equal(weekdayOf(WED + 4 * DAY_MS), 6);
});

test('day masks and HH:MM round-trip', () => {
  const days = [true, true, false, true, false, false, true];
  assert.equal(daysToMask(days), 0b1001011);
  assert.deepEqual(maskToDays(daysToMask(days)), days);
  assert.equal(hhmmToMin('06:30'), 390);
  assert.equal(minToHhmm(390), '06:30');
});

const programme = (over: Partial<Programme> = {}): Programme => ({ a: 'LFLL', b: 'LFMN', flightBase: 1100, freqPerDay: 4, days: 0b1111111, windowStartMin: 6 * 60, windowEndMin: 18 * 60, turnaroundMin: 30, ...over });

test('layoutDay: evenly spaced departures, returns after block + turnaround, round-robin aircraft, numbers in pairs', () => {
  const legs = layoutDay(programme(), [{ id: 1, blockMin: 70, home: 'LFLL' }, { id: 2, blockMin: 70, home: 'LFLL' }], WED);
  assert.equal(legs.length, 8);
  const outs = legs.filter((l) => l.origin === 'LFLL');
  assert.deepEqual(outs.map((l) => (l.dep - WED) / 60_000), [360, 540, 720, 900]);
  assert.deepEqual(outs.map((l) => l.aircraftId), [1, 2, 1, 2]);
  assert.deepEqual(legs.map((l) => l.flightNo), [1100, 1101, 1102, 1103, 1104, 1105, 1106, 1107]);
  const back = legs[1]!;
  assert.equal(back.origin, 'LFMN');
  assert.equal(back.dep, legs[0]!.dep + 105 * 60_000, '70 + 30 min rounded up to the 15-minute grid');
  assert.ok(legs.every((l) => l.dep % 900_000 === 0), 'departures on the tick grid');
  assert.equal(back.arr, back.dep + 70 * 60_000);
});

test('layoutDay: an aircraft that starts at B flies B to A first, with the odd number', () => {
  const legs = layoutDay(programme({ freqPerDay: 1 }), [{ id: 7, blockMin: 60, home: 'LFMN' }], WED);
  assert.deepEqual(legs.map((l) => [l.origin, l.dest, l.flightNo]), [['LFMN', 'LFLL', 1101], ['LFLL', 'LFMN', 1100]]);
});

test('layoutDay: operating days only, nothing without aircraft', () => {
  const monToFri = daysToMask([true, true, true, true, true, false, false]);
  assert.equal(layoutDay(programme({ days: monToFri }), [{ id: 1, blockMin: 60, home: 'LFLL' }], WED).length, 8);
  assert.equal(layoutDay(programme({ days: monToFri }), [{ id: 1, blockMin: 60, home: 'LFLL' }], WED + 3 * DAY_MS).length, 0);
  assert.equal(layoutDay(programme(), [], WED).length, 0);
});

test('overlappingLegs flags an aircraft asked to leave before it has landed and turned around', () => {
  const tight = layoutDay(programme({ freqPerDay: 8, windowEndMin: 6 * 60 + 60 }), [{ id: 1, blockMin: 70, home: 'LFLL' }], WED);
  assert.ok(overlappingLegs(tight, 30).length > 0);
  const relaxed = layoutDay(programme({ freqPerDay: 2 }), [{ id: 1, blockMin: 70, home: 'LFLL' }], WED);
  assert.deepEqual(overlappingLegs(relaxed, 30), []);
});

test('weeklyDemand is calibrated: large to large at 262 nm is the mockup\'s 5 200 passengers a week', () => {
  assert.ok(Math.abs(weeklyDemand('large', 'large', 262) - 5200) <= 5);
  assert.ok(weeklyDemand('small', 'small', 100) < weeklyDemand('medium', 'large', 100));
  assert.ok(weeklyDemand('large', 'large', 600) < weeklyDemand('large', 'large', 200), 'farther pairs draw less');
});

test('pairLoadFactor: share of demand by seats, clamped to [0.35, 0.95]', () => {
  assert.equal(pairLoadFactor(1_000, 0, 0), 0);
  assert.equal(pairLoadFactor(10_000, 1_000, 0), 0.95);
  assert.equal(pairLoadFactor(100, 1_000, 0), 0.35);
  assert.equal(pairLoadFactor(800, 1_000, 0), 0.8);
  assert.equal(pairLoadFactor(800, 1_000, 1_000), 0.4, 'a rival with the same seats halves the demand');
});

test('weeklySeats counts both directions of every slot, each slot flown by its round-robin aircraft', () => {
  assert.equal(weeklySeats(4, 0b1111111, [72]), 4 * 2 * 72 * 7);
  assert.equal(weeklySeats(3, 0b0000011, [72, 30]), (2 * 72 + 2 * 30 + 2 * 72) * 2);
  assert.equal(weeklySeats(3, 0b1111111, []), 0);
});

test('delays: wear from 70 %, inherited minus the slack of the turnaround, no randomness', () => {
  assert.equal(wearDelayMin(69.9), 0);
  assert.equal(wearDelayMin(70), 10);
  assert.equal(wearDelayMin(80), 20);
  assert.equal(inheritedDelayMin(20, 30, 30), 20, 'planned turnaround: the delay carries over fully');
  assert.equal(inheritedDelayMin(20, 45, 30), 5, 'slack above the turnaround absorbs it');
  assert.equal(inheritedDelayMin(20, 600, 30), 0);
});

test('stoppage reputation: -2 at the first midnight, -1 after, nothing before it began', () => {
  const since = WED + 14 * 3_600_000;
  assert.equal(stoppageReputation(since, WED), 0);
  assert.equal(stoppageReputation(since, WED + DAY_MS), 2);
  assert.equal(stoppageReputation(since, WED + 2 * DAY_MS), 1);
  assert.equal(stoppageReputationTotal(since, WED + 3 * DAY_MS), 4);
  assert.equal(stoppageReputationTotal(since, WED + 20 * 3_600_000), 0);
});

test('programme validation: a window must have a length, a day and unique aircraft', () => {
  const ok = { a: 'LFLL', b: 'LFMN', freqPerDay: 4, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [1, 2] };
  assert.equal(lineBodySchema.safeParse(ok).success, true);
  assert.equal(lineBodySchema.safeParse({ ...ok, windowEnd: '06:00' }).success, false);
  assert.equal(lineBodySchema.safeParse({ ...ok, days: Array(7).fill(false) }).success, false);
  assert.equal(lineBodySchema.safeParse({ ...ok, aircraftIds: [1, 1] }).success, false);
  assert.equal(lineBodySchema.safeParse({ ...ok, windowStart: '6:00' }).success, false);
  assert.equal(lineBodySchema.safeParse({ ...ok, a: 'lfll' }).success, false);
  assert.equal(programmeProblem(ok), null);
});
