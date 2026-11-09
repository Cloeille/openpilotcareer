import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENCY_MAX_COUNT, STAFF_FAMILIES, HIRED_ROLES, isPost, requestForGap } from '@opc/shared';
import { barWidths, canSign, retarget, stepCount, toggle } from './agency-view.ts';
import type { AgencyRequest, MissionView } from './api-agency.ts';
import { translate, translatePlural } from './i18n.ts';
import { messageFor } from './messages.ts';

const quote = (picked: string[], balanceAfter: number): NonNullable<MissionView['quote']> => ({ picked, commission: 12_800, balanceAfter });

test('the bars share one axis in days: the longest option fills it, the others are drawn to scale', () => {
  const w = barWidths([{ id: 'agency', phases: [2, 2] }, { id: 'train', phases: [21, 0] }, { id: 'classic', phases: [0, 7] }]);
  assert.deepEqual(w.train, [100, 0]);
  assert.deepEqual(w.classic.map(Math.round), [0, 33]);
  assert.deepEqual(w.agency.map(Math.round), [10, 10]);
  assert.deepEqual(barWidths([]).agency, [0, 0], 'no option, no bar, no division by zero');
});

test('the mission to propose for a gap asks for every open post, up to what one mission can hold, for any family', () => {
  assert.deepEqual(requestForGap({ family: 'pilot', base: 'LFLL', qual: 'CRJ7', open: 2 }), { family: 'pilot', role: 'captain', base: 'LFLL', qual: 'CRJ7', count: 2 });
  assert.equal(requestForGap({ family: 'cabin', base: 'LFLL', qual: null, open: 41 }).count, AGENCY_MAX_COUNT);
});

const request = (over: Partial<AgencyRequest> = {}): AgencyRequest => ({ family: 'cabin', role: 'attendant', base: 'LFLL', qual: null, count: 3, ...over });

test('choosing a family in the form always lands on a post that exists: its first role, and a rating for pilots only', () => {
  for (const from of STAFF_FAMILIES) {
    for (const to of STAFF_FAMILIES) {
      const r = retarget(request({ family: from, role: HIRED_ROLES[from][0]!, qual: from === 'pilot' ? 'AT76' : null }), { family: to }, ['A319', 'AT76']);
      assert.ok(isPost(r), `${from} to ${to}: ${JSON.stringify(r)}`);
      assert.equal(r.count, 3, 'the count and the base are kept');
    }
  }
  assert.equal(retarget(request(), { family: 'pilot' }, ['A319', 'AT76']).qual, 'A319', 'the first type she flies');
  assert.equal(retarget(request(), { family: 'pilot' }, []).qual, null, 'no type to fly: the server will say why');
  assert.deepEqual(retarget(request({ family: 'pilot', role: 'captain', qual: 'AT76' }), { role: 'fo' }, ['AT76']), request({ family: 'pilot', role: 'fo', qual: 'AT76' }), 'a role of the same family keeps the rating');
  assert.equal(retarget(request(), { base: 'LFPG' }, []).base, 'LFPG');
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
  assert.equal(translatePlural('en', 'ag.sign', 1), 'Sign 1 person');
  assert.equal(translatePlural('fr', 'ag.sign', 2), 'Signer 2 personnes');
  assert.equal(translate('fr', 'ag.opts.title', { count: 10, post: 'Personnel navigant commercial' }), 'Façons d’avoir tes 10 × Personnel navigant commercial');
  assert.equal(translatePlural('en', 'ag.saved.days', 1), '1 day');
  assert.equal(translatePlural('en', 'ag.fee.commission', 1), 'Commission · 1 month of salary each');
  assert.equal(translatePlural('fr', 'ag.fee.commission', 1), 'Commission · 1 mois de salaire chacun');
});

test('open posts of any family are counted, in both languages; the cabin-only wording is gone', () => {
  assert.equal(translatePlural('fr', 'ag.status.open', 41), '41 postes sont ouverts');
  assert.equal(translatePlural('en', 'ag.status.open', 1), '1 post is open');
  assert.equal(translate('fr', 'ag.status.short', { lines: 'KSFO ⇄ KLAX', post: 'Pilotes A319', have: 2, need: 8 }), 'KSFO ⇄ KLAX manque de Pilotes A319 (2 sur 8)');
  assert.equal(translate('fr', 'ag.stat.staff.notice', { n: 8 }), '8 en préavis');
  for (const gone of ['ag.status.cabin', 'ag.empty.cabin.title', 'ag.empty.cabin.body.one', 'ag.fee.surcharge', 'ag.cand.grid']) assert.equal(messageFor(gone), null, gone);
});
