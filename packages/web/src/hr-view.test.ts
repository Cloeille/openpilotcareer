import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAY_LEVELS, type HrView, type PayLevel } from '@opc/shared';
import { LEVEL_KEY, deltaClass, isPending, moraleFraction, moraleTone, optionOf, payLabel, stepLevel } from './hr-view.ts';
import { translate } from './i18n.ts';

/** The server's shape, by hand: a company at market pay that has just set +5 % (pending), five levels priced against it. */
const view = (o: Partial<HrView> = {}): HrView => ({
  now: Date.UTC(2026, 10, 7, 10), applyFrom: Date.UTC(2026, 10, 8), pay: { current: 0, next: 5 }, rest: 'standard', people: 70, leaving: 2, payroll: 345_500,
  morale: { average: 61.4, target: 72.5, families: [{ family: 'cabin', people: 30, morale: 44 }, { family: 'pilot', people: 40, morale: 75 }] },
  rule: { below: 50, chance: 0.05, drift: 0.25, atRisk: 9 },
  options: PAY_LEVELS.map((payPct) => ({ payPct, payroll: Math.round(329_000 * (1 + payPct / 100)), payrollDelta: Math.round(329_000 * (payPct - 5) / 100), target: 60 + payPct * 2.5, leaves: payPct < 0 })),
  ...o,
});

test('a pay level reads with its sign, a true minus for a cut and nothing for the market', () => {
  assert.deepEqual(PAY_LEVELS.map(payLabel), ['\u221210 %', '\u22125 %', '0 %', '+5 %', '+10 %']);
});

test('← → steps through the five levels and stops at the two ends', () => {
  assert.equal(stepLevel(0, 1), 5); assert.equal(stepLevel(0, -1), -5);
  assert.equal(stepLevel(10, 1), 10); assert.equal(stepLevel(-10, -1), -10);
  let l: PayLevel = -10; const seen: number[] = [l];
  for (let i = 0; i < 4; i++) { l = stepLevel(l, 1); seen.push(l); }
  assert.deepEqual(seen, [...PAY_LEVELS]);
});

test('the preview row of a level is the server\'s, and a level the list lacks falls back to the first row instead of throwing', () => {
  const v = view();
  assert.equal(optionOf(v, 10).payPct, 10);
  assert.equal(optionOf({ options: [v.options[0]!] }, 5).payPct, -10);
});

test('a level is pending while the one set is not yet the one in force', () => {
  assert.equal(isPending(view()), true);
  assert.equal(isPending(view({ pay: { current: 5, next: 5 } })), false);
});

test('only morale under the server\'s line is red; the untouched company\'s 60 is no warning, and the bar never leaves its track', () => {
  assert.equal(moraleTone(44, 50), 'bad'); assert.equal(moraleTone(50, 50), 'ok'); assert.equal(moraleTone(60, 50), 'ok');
  assert.equal(moraleFraction(61.4), 0.614); assert.equal(moraleFraction(140), 1); assert.equal(moraleFraction(-3), 0);
});

test('a payroll that grows is a cost, one that shrinks is a saving, no change is plain', () => {
  assert.deepEqual([deltaClass(16_450), deltaClass(-16_450), deltaClass(0)], ['st-warn', 'ln-ok', '']);
});

test('the messages the screen builds read in both languages, and the five levels have their own', () => {
  assert.equal(translate('en', 'hr.title'), 'HR policy');
  assert.equal(translate('fr', 'hr.title'), 'Politique RH');
  assert.equal(translate('fr', 'hr.pay.pending', { date: '8 nov.', level: '+5 %' }), 'Réglé, en vigueur dès le 8 nov. : +5 %.');
  assert.equal(translate('en', 'hr.rule.quit', { below: 50, chance: 5 }), 'Under 50 % morale, a person gives notice with 5 chance in 100 each month; the notice period runs, there is no severance.');
  assert.deepEqual(PAY_LEVELS.map((l) => translate('fr', LEVEL_KEY[l])), ['Bien sous le marché', 'Sous le marché', 'Au prix du marché', 'Au-dessus du marché', 'Bien au-dessus du marché']);
  assert.match(translate('en', 'hr.rule.none'), /no strike, no inspection, no fine/);
});
