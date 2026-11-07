import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absentCooks, canPickCaterer, capacityCut, changeOf, headline, isLate, missingAt, noPending, selection, servedBy, stepQuality, tierTable } from './kitchen-view.ts';
import { CATERER, KITCHEN, TIERS } from './service-fixtures.ts';

const cellOf = (rows: ReturnType<typeof tierTable>, metric: string, quality: string) => rows.flat().find((c) => c.metric === metric && c.quality === quality)!;

test('the tier table has six rows of three levels, in the mockup order whatever order the server sent', () => {
  const rows = tierTable([...TIERS].reverse(), 'soigne', KITCHEN);
  assert.deepEqual(rows.map((r) => r[0]!.metric), ['prep', 'team', 'output', 'cost', 'margin', 'sat']);
  assert.ok(rows.every((r) => r.map((c) => c.quality).join() === 'economy,soigne,gastronomique'));
});

test('a bar is the value against the largest level (the mockup draws 4, 6 and 9 cooks as 80, 120 and 180 of 180)', () => {
  const rows = tierTable(TIERS, 'soigne', KITCHEN);
  assert.deepEqual(['economy', 'soigne', 'gastronomique'].map((q) => Math.round(cellOf(rows, 'team', q).bar * 180)), [80, 120, 180]);
  assert.equal(cellOf(rows, 'output', 'economy').bar, 1);
});

test('the other levels carry a delta against the current one; the current one and an equal value carry none', () => {
  const rows = tierTable(TIERS, 'soigne', KITCHEN);
  assert.equal(cellOf(rows, 'prep', 'economy').delta, -5);
  assert.equal(cellOf(rows, 'prep', 'gastronomique').delta, 9);
  assert.equal(cellOf(rows, 'team', 'economy').delta, -2);
  assert.equal(cellOf(rows, 'cost', 'gastronomique')!.delta! > 8.3, true);
  assert.equal(cellOf(rows, 'prep', 'soigne').delta, null);
  const same = tierTable([TIERS[0]!, { ...TIERS[1]!, prepMinutes: 4 }, TIERS[2]!], 'soigne', KITCHEN);
  assert.equal(cellOf(same, 'prep', 'economy').delta, null);
});

test('a level needing more cooks than are employed says how many to recruit; one that cannot make the day\'s meals says the demand', () => {
  const rows = tierTable(TIERS, 'soigne', KITCHEN);
  assert.deepEqual(cellOf(rows, 'team', 'gastronomique').problem, { kind: 'recruit', n: 3 });
  assert.equal(cellOf(rows, 'team', 'soigne').problem, null);
  assert.deepEqual(cellOf(rows, 'output', 'gastronomique').problem, { kind: 'demand', n: 548 });
  assert.equal(cellOf(rows, 'output', 'soigne').problem, null);
});

test('the margin of a level is price against cost (C14), not the mockup\'s labels', () => {
  assert.deepEqual(TIERS.map((x) => Math.round(x.margin * 100)), [66, 54, 36]);
});

test('the own kitchen serves every level; the caterer only the ones it quotes, and none before it is quoted', () => {
  assert.deepEqual(servedBy('own', null), ['economy', 'soigne', 'gastronomique']);
  assert.deepEqual(servedBy('caterer', CATERER), ['economy', 'soigne']);
  assert.deepEqual(servedBy('caterer', null), []);
  assert.deepEqual(missingAt(CATERER), ['gastronomique']);
  assert.equal(canPickCaterer(KITCHEN), true);
  assert.equal(canPickCaterer({ caterer: null }), false);
});

test('the selection is what is pending, else what is current; a level the chosen provider cannot make falls to the nearest it can', () => {
  assert.deepEqual(selection(KITCHEN, noPending('LFMN')), { quality: 'soigne', provider: 'own' });
  assert.deepEqual(selection(KITCHEN, { quality: 'gastronomique', provider: null }), { quality: 'gastronomique', provider: 'own' });
  assert.deepEqual(selection(KITCHEN, { quality: 'gastronomique', provider: 'caterer' }), { quality: 'soigne', provider: 'caterer' });
  assert.deepEqual(selection({ ...KITCHEN, caterer: null }, { quality: null, provider: 'caterer' }), { quality: 'soigne', provider: 'caterer' });
});

test('arrows step the quality ladder and stop at its ends, inside what the provider serves', () => {
  const none = noPending('LFMN');
  assert.equal(stepQuality(KITCHEN, none, 1), 'gastronomique');
  assert.equal(stepQuality(KITCHEN, none, -1), 'economy');
  assert.equal(stepQuality(KITCHEN, { ...none, quality: 'economy' }, -1), 'economy');
  assert.equal(stepQuality(KITCHEN, { ...none, quality: 'gastronomique' }, 1), 'gastronomique');
  assert.equal(stepQuality(KITCHEN, { ...none, provider: 'caterer', quality: 'soigne' }, 1), 'soigne');
});

test('applying sends only what differs from the current setting, and nothing when nothing does', () => {
  assert.equal(changeOf(KITCHEN, noPending('LFMN')), null);
  assert.deepEqual(changeOf(KITCHEN, { hub: 'LFMN', quality: 'economy', provider: null }), { quality: 'economy' });
  assert.deepEqual(changeOf(KITCHEN, { hub: 'LFMN', quality: null, provider: 'caterer' }), { provider: 'caterer' });
  assert.deepEqual(changeOf(KITCHEN, { hub: 'LFMN', quality: 'gastronomique', provider: 'caterer' }), { provider: 'caterer' });
  assert.equal(changeOf(KITCHEN, { hub: 'LFMN', quality: 'soigne', provider: 'own' }), null);
});

test('the status line: the latest meals first, then a day the kitchen cannot make, else on schedule', () => {
  const h = headline(KITCHEN);
  assert.equal(h.kind, 'late');
  assert.equal(h.kind === 'late' && h.departure.flightNo, 'AZR 4131');
  const calm = { ...KITCHEN, departures: KITCHEN.departures.map((d) => ({ ...d, lateMin: 0 })) };
  assert.deepEqual(headline(calm), { kind: 'short', demand: 548, capacity: 515, tone: 'warn' });
  assert.deepEqual(headline({ ...calm, capacityNow: 620 }), { kind: 'ok', tone: 'ok' });
  assert.deepEqual(headline({ ...calm, capacity: null, capacityNow: null }), { kind: 'ok', tone: 'ok' });
  assert.deepEqual(headline({ ...calm, demand: { snacks: 0, hot: 0 }, departures: [] }), { kind: 'idle', tone: 'ok' });
  assert.equal(isLate({ lateMin: 12 }), true);
  assert.equal(isLate({ lateMin: 0 }), false);
});

test('an absent cook cuts the capacity of the day (620 -> 515) and is counted against the people employed', () => {
  assert.equal(absentCooks(KITCHEN), 1);
  assert.equal(capacityCut(KITCHEN), true);
  assert.equal(capacityCut({ capacity: 620, capacityNow: 620 }), false);
  assert.equal(capacityCut({ capacity: null, capacityNow: null }), false);
  assert.equal(absentCooks({ cooks: { onDuty: 7, headcount: 6, needed: 6 } }), 0);
});
