import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankProgress } from './pilot.ts';
import { fitScale } from './fit.ts';

test('a new pilot is rank 1 with no progress', () => {
  assert.deepEqual(rankProgress({ hours: 0, flights: 0 }), { index: 0, fraction: 0, hasNext: true });
});

test('progress is the slower of hours and flights toward the next rank', () => {
  // Private Pilot needs 5 h and 3 flights: 2.5 h = 50 %, 3 flights = 100 %.
  const p = rankProgress({ hours: 2.5, flights: 3 });
  assert.equal(p.index, 0);
  assert.equal(p.fraction, 0.5);
});

test('both thresholds are needed to rank up', () => {
  assert.equal(rankProgress({ hours: 200, flights: 2 }).index, 0);
  assert.equal(rankProgress({ hours: 5, flights: 3 }).index, 1);
});

test('the top rank is full and has no next', () => {
  assert.deepEqual(rankProgress({ hours: 5000, flights: 5000 }), { index: 5, fraction: 1, hasNext: false });
});

test('the 1600x900 stage scales to fit and never crops', () => {
  assert.equal(fitScale(1600, 900), 1);
  assert.equal(fitScale(1280, 720), 0.8);
  assert.equal(fitScale(800, 900), 0.5);
  assert.equal(fitScale(3200, 1200), 1200 / 900);
});
