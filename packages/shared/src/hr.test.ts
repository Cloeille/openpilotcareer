import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MORALE_DRIFT, PAY_LEVELS, QUIT_BELOW, QUIT_CHANCE, REST_MORALE, driftMorale, hrPolicySchema, moraleTarget, paidSalary, paidStaff, quits } from './hr.ts';
import { REST_POLICY_NAMES } from './staff.ts';

test('the pay level moves the grid salary by its percentage, to the euro; market pay changes nothing', () => {
  assert.equal(paidSalary(8_300, 0), 8_300);
  assert.equal(paidSalary(8_300, 5), 8_715);
  assert.equal(paidSalary(8_300, -5), 7_885);
  assert.equal(paidSalary(8_300, -10), 7_470);
  assert.equal(paidSalary(2_901, 5), 3_046);
});

test('the target stays inside 0 to 100 for every pay level and rest policy, and a company that never opened the HR screen is at 60, above the leaving line', () => {
  for (const p of PAY_LEVELS) for (const r of REST_POLICY_NAMES) { const t = moraleTarget(p, r); assert.ok(t > 0 && t < 100, `${p} ${r}: ${t}`); }
  assert.equal(moraleTarget(0, 'standard'), 60);
  for (const r of REST_POLICY_NAMES) assert.ok(moraleTarget(0, r) >= QUIT_BELOW, `market pay keeps the team under ${r} rest`);
});

test('what the target is made of: 2.5 points per percent of pay, and the rest policy on top; generous rest holds a 5 % pay cut, the legal minimum does not', () => {
  assert.equal(moraleTarget(5, 'standard') - moraleTarget(0, 'standard'), 12.5);
  assert.deepEqual(REST_POLICY_NAMES.map((r) => REST_MORALE[r]), [-5, 0, 5]);
  assert.ok(moraleTarget(-5, 'generous') >= QUIT_BELOW);
  assert.ok(moraleTarget(-5, 'standard') < QUIT_BELOW);
  assert.ok(moraleTarget(-5, 'legal') < QUIT_BELOW);
  assert.ok(moraleTarget(-10, 'generous') < QUIT_BELOW, 'a 10 % cut is too much for any rest policy');
});

test('a month moves morale a quarter of the way to the target, from either side, and never past it', () => {
  assert.equal(MORALE_DRIFT, 0.25);
  assert.equal(driftMorale(80, 60), 75);
  assert.equal(driftMorale(40, 60), 45);
  assert.equal(driftMorale(60, 60), 60);
  let m = 95;
  for (let i = 0; i < 40; i++) { const n = driftMorale(m, 47.5); assert.ok(n <= m && n >= 47.5); m = n; }
  assert.ok(Math.abs(m - 47.5) < 0.03, 'it settles at the target (within the hundredth it is rounded to)');
  assert.equal(driftMorale(33.333, 60), Math.round((33.333 + 26.667 * 0.25) * 100) / 100, 'kept to a hundredth');
});

test('only a person under the line can leave, and only on a roll under the chance', () => {
  assert.equal(quits(QUIT_BELOW, 0), false, 'at the line they stay');
  assert.equal(quits(QUIT_BELOW - 0.01, 0), true);
  assert.equal(quits(QUIT_BELOW - 0.01, QUIT_CHANCE - 1e-9), true);
  assert.equal(quits(QUIT_BELOW - 0.01, QUIT_CHANCE), false);
  assert.equal(quits(90, 0), false, 'a happy person never leaves, whatever the roll');
});

test('the policy body takes the five levels and nothing else: no free number, no compliance axis', () => {
  for (const payPct of PAY_LEVELS) assert.equal(hrPolicySchema.safeParse({ payPct }).success, true);
  for (const bad of [{ payPct: 7 }, { payPct: '5' }, { payPct: 5.5 }, { payPct: null }, {}, { style: 'warm' }]) assert.equal(hrPolicySchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(hrPolicySchema.safeParse({ payPct: 5, law: 'illegal' }).success, false, 'a law axis is refused, not ignored (C27)');
});

test('the payroll inputs move by the level without touching the grid they came from', () => {
  const grid = [{ salary: 8_300, since: 0 }, { salary: 2_901, since: 1 }];
  assert.deepEqual(paidStaff(grid, 5), [{ salary: 8_715, since: 0 }, { salary: 3_046, since: 1 }]);
  assert.deepEqual(paidStaff(grid, 0), grid);
  assert.notEqual(paidStaff(grid, 0), grid, 'always a copy');
  assert.equal(grid[0]!.salary, 8_300);
});
