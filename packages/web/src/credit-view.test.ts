import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREDIT_BANK_IDS, CREDIT_MIN, CREDIT_MONTHS, CREDIT_STEP, type CreditsView } from '@opc/shared';
import { BANK_KEY, REFUSAL_KEY, barShares, clampAmount, clampPrepay, cycle, firstDraft, percent1, repaidShare, stepAmount, stepScheduleMonth } from './credit-view.ts';
import { en, fr } from './messages.ts';

const schedule = (...rows: [string, number, number, number][]): CreditsView['schedule'] => rows.map(([month, capital, interest, insurance]) => ({ month, capital, interest, insurance }));

test('the slider moves by the step and stays between the smallest credit and what the ceiling leaves; with no room it stays on the smallest', () => {
  assert.equal(clampAmount(123_456, 600_000), 100_000);
  assert.equal(clampAmount(1, 600_000), CREDIT_MIN);
  assert.equal(clampAmount(9_000_000, 600_000), 600_000);
  assert.equal(clampAmount(300_000, 0), CREDIT_MIN, 'nothing to borrow: the screen asks the server, which says why');
  assert.equal(stepAmount(300_000, 1, 600_000), 300_000 + CREDIT_STEP);
  assert.equal(stepAmount(600_000, 1, 600_000), 600_000);
  assert.equal(stepAmount(CREDIT_MIN, -1, 600_000), CREDIT_MIN);
  assert.deepEqual(firstDraft(600_000), { amount: 300_000, months: 24, bank: 'alpes' });
  assert.ok(CREDIT_MONTHS.includes(firstDraft(0).months as 24));
});

test('cycling the banks wraps around both ways', () => {
  assert.equal(cycle(CREDIT_BANK_IDS, 'aerofinance', 1), 'alpes');
  assert.equal(cycle(CREDIT_BANK_IDS, 'alpes', -1), 'aerofinance');
  assert.equal(cycle(CREDIT_BANK_IDS, 'alpes', 1), 'meridional');
});

test('the schedule is read month by month, stopping at both ends, and each bar is a share of the tallest', () => {
  const s = schedule(['2026-12', 80, 20, 0], ['2027-01', 40, 10, 0], ['2027-02', 20, 5, 5]);
  assert.equal(stepScheduleMonth(s, '2026-12', -1), '2026-12');
  assert.equal(stepScheduleMonth(s, '2026-12', 1), '2027-01');
  assert.equal(stepScheduleMonth(s, '2027-02', 1), '2027-02');
  assert.equal(stepScheduleMonth(s, null, 1), '2027-01');
  assert.equal(stepScheduleMonth([], null, 1), null);
  const bars = barShares(s);
  assert.deepEqual([bars[0]!.capital + bars[0]!.interest, bars[1]!.capital + bars[1]!.interest, bars[2]!.capital + bars[2]!.interest + bars[2]!.insurance], [1, 0.5, 0.3]);
  assert.deepEqual(barShares([]), []);
});

test('what is repaid, the partial amount of the simulator and the percent are kept sane', () => {
  assert.equal(repaidShare(600_000, 318_000), 0.47);
  assert.equal(repaidShare(0, 0), 0);
  assert.equal(repaidShare(100, 150), 0);
  assert.equal(clampPrepay(0, 50_000), 1);
  assert.equal(clampPrepay(70_000.4, 50_000), 50_000);
  assert.equal(clampPrepay(12_345.6, 50_000), 12_346);
  assert.equal(percent1(0.061, 'en-GB'), '6.1\u00a0%');
  assert.equal(percent1(0.115, 'fr-FR'), '11,5\u00a0%');
});

test('every bank and every refusal has its words in both languages', () => {
  for (const key of [...Object.values(BANK_KEY), ...Object.values(REFUSAL_KEY)]) for (const lang of [en, fr]) assert.notEqual(lang[key].trim(), '', key);
  assert.deepEqual(Object.keys(BANK_KEY).sort(), [...CREDIT_BANK_IDS].sort());
});
