import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOAN_RATE, formatRegistration, loanOption, loanPayment, registrationPrefix, wearAfter } from './index.ts';

test('loan maths: annuity at 6.9 %, literal values', () => {
  assert.equal(LOAN_RATE, 0.069);
  assert.equal(loanPayment(3_360_000, 84), 50_547);
  assert.equal(loanPayment(2_400_000, 36), 73_995);
  assert.equal(loanPayment(40_000, 60), 790);
  const o = loanOption(4_200_000, 12_500, 20, 84);
  assert.deepEqual(o, { downPct: 20, months: 84, monthly: 50_547, total: 840_000 + 50_547 * 84 + 12_500, down: 840_000, dueToday: 852_500 });
});

test('registrations: country prefix, deterministic sequence, ICAO fallback', () => {
  assert.equal(registrationPrefix('FR', 'LFPG'), 'F-');
  assert.equal(registrationPrefix('DE', 'EDDF'), 'D-');
  assert.equal(registrationPrefix('GB', 'EGLL'), 'G-');
  assert.equal(registrationPrefix('US', 'KJFK'), 'N');
  assert.equal(registrationPrefix('ZZ', 'LFXX'), 'F-', 'unknown country: ICAO two-letter prefix');
  assert.equal(registrationPrefix(undefined, 'KABC'), 'N', 'ICAO one-letter prefix');
  assert.deepEqual([0, 1, 25, 26].map((n) => formatRegistration('F-', n)), ['F-HAZA', 'F-HAZB', 'F-HAZZ', 'F-HBAA']);
  assert.deepEqual([0, 1, 26].map((n) => formatRegistration('N', n)), ['N100AA', 'N100AB', 'N100BA']);
  assert.equal(formatRegistration('JA', 0), 'JA0001');
});

test('wear accrues per block hour by category and caps at 100', () => {
  assert.equal(wearAfter(0, 'piston-single', 10), 8);
  assert.equal(wearAfter(79.5, 'jet-airliner', 2), 80.1);
  assert.equal(wearAfter(99, 'piston-single', 10), 100);
});
