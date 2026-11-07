import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basesOf, canAfford, convertibleAt, defaultPlace, gapTone, keepOffer, nextMode, offerKey, offersAt, seatFraction, seatTone, stepBase } from './training-view.ts';
import type { PilotRef, TrainOffer } from './api-training.ts';
import { translate, translatePlural } from './i18n.ts';

const course = (cost: number, days: number) => ({ cost, days });
const offer = (staffId: number, name: string, type: string, base: string, ownWhy: TrainOffer['ownWhy'] = null): TrainOffer =>
  ({ staffId, name, base, type, typeName: type, outside: course(24_000, 21), own: course(14_400, 16), saved: 9_600, ownWhy });
const ref = (staffId: number, base: string, retiresAt: number | null = null): PilotRef => ({ staffId, name: `P${staffId}`, base, role: 'captain', age: 60, retiresAt, inWindow: false, types: ['AT76'] });

test('the offers of a base: the ones the centre can take come first, then by pilot and type, so the list does not jump when seats fill', () => {
  const list = [offer(3, 'Zoé', 'A320', 'LFMN', 'centre_full'), offer(2, 'Hugo', 'AT76', 'LFPG'), offer(1, 'Hugo', 'A320', 'LFMN'), offer(4, 'Alice', 'A320', 'LFMN', 'no_instructor')];
  assert.deepEqual(offersAt(list, null).map((o) => o.staffId), [1, 2, 4, 3]);
  assert.deepEqual(offersAt(list, 'LFMN').map((o) => o.staffId), [1, 4, 3]);
  assert.deepEqual(offersAt(list, 'LFXX'), []);
  assert.equal(list[0]!.staffId, 3, 'the input is not reordered');
});

test('the offer in focus is kept while it is listed, else the first; none for an empty list', () => {
  const list = [offer(1, 'A', 'A320', 'LFMN'), offer(2, 'B', 'A320', 'LFMN')];
  assert.equal(keepOffer(list, offerKey(list[1]!)), '2.A320');
  assert.equal(keepOffer(list, '9.A320'), '1.A320');
  assert.equal(keepOffer(list, null), '1.A320');
  assert.equal(keepOffer([], '1.A320'), null);
});

test('the centre is the default place whenever it can take the pilot, outside otherwise (the server decides which)', () => {
  assert.equal(defaultPlace(offer(1, 'A', 'A320', 'LFMN')), 'own');
  for (const why of ['no_training_centre', 'no_instructor', 'centre_full'] as const) assert.equal(defaultPlace(offer(1, 'A', 'A320', 'LFMN', why)), 'outside');
});

test('a course can be paid when the balance covers it, to the euro', () => {
  assert.equal(canAfford(14_400, 14_400), true);
  assert.equal(canAfford(14_400, 14_399), false);
});

test('the base filter steps through [all, ...bases] and stops at the ends; the bases are those with a centre, a pilot, an instructor or a candidate', () => {
  assert.deepEqual(basesOf({ centres: [{ hub: 'LFPG', instructors: 0, seats: 0, used: 0, monthly: 0 }], offers: [offer(1, 'A', 'A320', 'LFMN')], instructors: [ref(2, 'LFLL')], convertible: [ref(3, 'LFMN')] }), ['LFLL', 'LFMN', 'LFPG']);
  assert.equal(stepBase(['A', 'B'], null, 1), 'A');
  assert.equal(stepBase(['A', 'B'], 'A', 1), 'B');
  assert.equal(stepBase(['A', 'B'], 'B', 1), 'B', 'stops at the last');
  assert.equal(stepBase(['A', 'B'], 'A', -1), null, 'back to all');
  assert.equal(stepBase(['A', 'B'], null, -1), null, 'stops at all');
  assert.equal(stepBase([], null, 1), null);
  assert.equal(nextMode('trainees'), 'instructors');
  assert.equal(nextMode('instructors'), 'trainees');
});

test('seats: none is a warning in red, full in amber; the bar never passes full', () => {
  assert.equal(seatTone({ seats: 0, used: 0 }), 'bad');
  assert.equal(seatTone({ seats: 4, used: 4 }), 'warn');
  assert.equal(seatTone({ seats: 4, used: 1 }), 'ok');
  assert.equal(seatFraction({ seats: 0, used: 0 }), 0);
  assert.equal(seatFraction({ seats: 4, used: 6 }), 1);
  assert.equal(seatFraction({ seats: 4, used: 1 }), 0.25);
});

test('the pilots who could teach at a base keep the order the server gave (soonest retirement first)', () => {
  const list = [ref(1, 'LFMN', 5), ref(2, 'LFPG', 6), ref(3, 'LFMN', 7)];
  assert.deepEqual(convertibleAt(list, 'LFMN').map((p) => p.staffId), [1, 3]);
  assert.equal(convertibleAt(list, null).length, 3);
});

test('the gap on the line once he teaches: red when the timetable lacks pilots, amber when none is to spare', () => {
  assert.equal(gapTone({ type: 'AT76', have: 2, need: 4 }), 'bad');
  assert.equal(gapTone({ type: 'AT76', have: 4, need: 4 }), 'bad', 'he is one of the four: three are left');
  assert.equal(gapTone({ type: 'AT76', have: 5, need: 4 }), 'warn');
  assert.equal(gapTone({ type: 'AT76', have: 6, need: 4 }), 'ok');
  assert.equal(gapTone({ type: 'AT76', have: 1, need: 0 }), 'warn', 'no need, none to spare either');
  assert.equal(gapTone({ type: 'AT76', have: 3, need: 0 }), 'ok');
});

test('the messages the screens build read in both languages, in the singular for one', () => {
  assert.equal(translatePlural('en', 'tr.days', 1), '1 day');
  assert.equal(translatePlural('fr', 'tr.days', 16), '16 jours');
  assert.equal(translatePlural('fr', 'tr.centre.teachers', 1), '1 formateur');
  assert.equal(translate('fr', 'tr.centre.seats', { used: 2, seats: 4 }), '2 places sur 4 occupées');
  assert.equal(translate('fr', 'err.centre_full'), 'Toutes les places du centre de formation sont prises : attends la fin d’un stage, ou forme dehors.');
  assert.equal(translate('en', 'rt.gap.left', { have: 3, need: 4 }), '3 left of the 4 the timetable needs');
});
