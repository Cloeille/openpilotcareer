import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENCY_MAX_COUNT } from '@opc/shared';
import { barWidths, canSign, requestFor, stepCount, toggle } from './agency-view.ts';
import type { MissionView } from './api-agency.ts';
import { translate, translatePlural } from './i18n.ts';

const quote = (picked: string[], balanceAfter: number): NonNullable<MissionView['quote']> => ({ picked, commission: 34_080, surchargeMonthly: 1_400, balanceAfter });

test('the bars share one axis in days: the longest option fills it, the others are drawn to scale', () => {
  const w = barWidths([{ id: 'agency', phases: [2, 2] }, { id: 'train', phases: [21, 0] }, { id: 'classic', phases: [0, 7] }]);
  assert.deepEqual(w.train, [100, 0]);
  assert.deepEqual(w.classic.map(Math.round), [0, 33]);
  assert.deepEqual(w.agency.map(Math.round), [10, 10]);
  assert.deepEqual(barWidths([]).agency, [0, 0], 'no option, no bar, no division by zero');
});

test('the mission to propose for a gap asks for every open post, up to what one mission can hold', () => {
  assert.deepEqual(requestFor({ base: 'LFLL', qual: 'CRJ7', open: 2 }), { base: 'LFLL', qual: 'CRJ7', count: 2 });
  assert.equal(requestFor({ base: 'LFLL', qual: 'CRJ7', open: 40 }).count, AGENCY_MAX_COUNT);
});

test('the number of people wanted stays between one and what one mission can hold', () => {
  assert.equal(stepCount(1, -1), 1);
  assert.equal(stepCount(2, 1), 3);
  assert.equal(stepCount(AGENCY_MAX_COUNT, 1), AGENCY_MAX_COUNT);
});

test('holding a candidate: toggles, and never holds more than the mission is for', () => {
  assert.deepEqual(toggle(['a'], 'b', 2), ['a', 'b']);
  assert.deepEqual(toggle(['a', 'b'], 'c', 2), ['a', 'b'], 'a full mission holds no third person');
  assert.deepEqual(toggle(['a', 'b'], 'a', 2), ['b']);
  assert.deepEqual(toggle([], 'a', 1), ['a']);
});

test('the mission can be signed once the search is over, with someone held and a balance that covers the commission', () => {
  assert.equal(canSign({ ready: true, quote: quote(['a'], 100) }), true);
  assert.equal(canSign({ ready: true, quote: quote(['a'], 0) }), true, 'a balance of zero after is enough');
  assert.equal(canSign({ ready: true, quote: quote(['a'], -1) }), false, 'one euro short');
  assert.equal(canSign({ ready: true, quote: quote([], 100) }), false, 'nobody held');
  assert.equal(canSign({ ready: false, quote: null }), false, 'still searching');
});

test('plural messages of the agency read in the singular for one, in both languages', () => {
  assert.equal(translatePlural('en', 'ag.sign', 1), 'Sign 1 pilot');
  assert.equal(translatePlural('fr', 'ag.sign', 2), 'Signer 2 pilotes');
  assert.equal(translatePlural('fr', 'ag.opts.title', 1, { qual: 'CRJ7', count: 1 }), 'Trois façons d’avoir ton pilote CRJ7');
  assert.equal(translatePlural('fr', 'ag.opts.title', 2, { qual: 'CRJ7', count: 2 }), 'Trois façons d’avoir tes 2 pilotes CRJ7');
  assert.equal(translatePlural('en', 'ag.saved.days', 1), '1 day');
  assert.equal(translate('fr', 'ag.fee.surchargeVal', { amount: '1 400 €' }), '+1 400 € / mois');
});
