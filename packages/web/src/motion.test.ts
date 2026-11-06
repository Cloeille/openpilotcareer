import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNT_MS, countValue, slideDirection } from './motion.ts';

const TABS = ['dashboard', 'jobs', 'fleet', 'history', 'leaderboard'];

test('E slides the next tab in from the right, Q the previous from the left', () => {
  assert.equal(slideDirection('dashboard', 'jobs', TABS), 1);
  assert.equal(slideDirection('fleet', 'jobs', TABS), -1);
});

test('the tab cycle wraps: the last tab to the first is still "next"', () => {
  assert.equal(slideDirection('leaderboard', 'dashboard', TABS), 1);
  assert.equal(slideDirection('dashboard', 'leaderboard', TABS), -1);
});

test('a jump of several tabs follows the tab order', () => {
  assert.equal(slideDirection('dashboard', 'fleet', TABS), 1);
  assert.equal(slideDirection('history', 'jobs', TABS), -1);
});

test('screens outside the tab cycle, or no move, just rise', () => {
  assert.equal(slideDirection('jobs', 'settings', TABS), 0);
  assert.equal(slideDirection(null, 'jobs', TABS), 0);
  assert.equal(slideDirection('jobs', 'jobs', TABS), 0);
});

test('a count starts at the old figure, ends exactly on the new one and never overshoots', () => {
  assert.equal(countValue(100, 500, 0), 100);
  assert.equal(countValue(100, 500, COUNT_MS), 500);
  assert.equal(countValue(100, 500, COUNT_MS * 3), 500);
  let last = 100;
  for (let ms = 0; ms <= COUNT_MS; ms += 20) {
    const v = countValue(100, 500, ms);
    assert.ok(v >= last && v <= 500, `monotonic at ${ms} ms`);
    last = v;
  }
  assert.ok(countValue(100, 500, COUNT_MS / 2) > 300, 'eased out: more than half way at half time');
});

test('a count works downwards too', () => {
  assert.equal(countValue(500, 100, COUNT_MS), 100);
  assert.ok(countValue(500, 100, COUNT_MS / 2) < 300);
});
