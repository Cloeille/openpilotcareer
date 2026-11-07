import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absentCooks, catererOffer, changeOf, configured, hallState, headline, mealEconomics, noPending, quoteFor, selection, servedBy, stepQuality, tierTable } from './kitchen-view.ts';
import { KITCHEN, QUALITIES, QUOTE } from './service-fixtures.ts';
import type { KitchenView } from './api-service.ts';

const cellAt = (rows: ReturnType<typeof tierTable>, metric: string, quality: string) => rows.flat().find((c) => c.metric === metric && c.quality === quality)!;
const ctx = { employed: KITCHEN.cooks.employed, demand: KITCHEN.day.demand };
const kitchen = (o: Partial<KitchenView> = {}): KitchenView => ({ ...KITCHEN, ...o });

test('the tier table has six rows of three levels, in the mockup order whatever order the server sent', () => {
  const rows = tierTable(kitchen().qualities.toReversed(), 'soigne', ctx);
  assert.deepEqual(rows.map((r) => r[0]!.metric), ['prep', 'team', 'output', 'cost', 'margin', 'sat']);
  assert.ok(rows.every((r) => r.map((c) => c.quality).join() === 'economy,soigne,gastronomique'));
});

test('a bar is the value against the largest level (the mockup draws 4, 6 and 9 cooks as 80, 120 and 180 of 180)', () => {
  const rows = tierTable(KITCHEN.qualities, 'soigne', ctx);
  assert.deepEqual(['economy', 'soigne', 'gastronomique'].map((q) => Math.round(cellAt(rows, 'team', q).bar * 180)), [80, 120, 180]);
  assert.equal(cellAt(rows, 'output', 'economy').bar, 1);
});

test('the other levels carry a delta against the current one; the current one and an equal value carry none', () => {
  const rows = tierTable(KITCHEN.qualities, 'soigne', ctx);
  assert.equal(cellAt(rows, 'prep', 'economy').delta, -5);
  assert.equal(cellAt(rows, 'prep', 'gastronomique').delta, 9);
  assert.equal(cellAt(rows, 'team', 'economy').delta, -2);
  assert.ok(cellAt(rows, 'cost', 'gastronomique').delta! > 8.3);
  assert.equal(cellAt(rows, 'prep', 'soigne').delta, null);
  const same = tierTable([QUALITIES[0]!, { ...QUALITIES[1]!, prepMin: 4 }, QUALITIES[2]!].map((q) => ({ ...q, cooksForDemand: 0, fitsDemand: true })), 'soigne', ctx);
  assert.equal(cellAt(same, 'prep', 'economy').delta, null);
});

test('a level needing more cooks than are employed says how many to recruit; one the server says cannot make the day\'s meals says the demand', () => {
  const rows = tierTable(KITCHEN.qualities, 'soigne', ctx);
  assert.deepEqual(cellAt(rows, 'team', 'gastronomique').problem, { kind: 'recruit', n: 3 });
  assert.equal(cellAt(rows, 'team', 'soigne').problem, null);
  assert.deepEqual(cellAt(rows, 'output', 'gastronomique').problem, { kind: 'demand', n: 548 });
  assert.equal(cellAt(rows, 'output', 'soigne').problem, null);
});

test('with a caterer there is no team to recruit, so no level is flagged for it', () => {
  const rows = tierTable(KITCHEN.qualities, 'soigne', { ...ctx, employed: null });
  assert.equal(cellAt(rows, 'team', 'gastronomique').problem, null);
});

test('the margin of a level is price against cost (C14), not the mockup\'s labels', () => {
  assert.deepEqual(QUALITIES.map((x) => Math.round(x.margin * 100)), [66, 54, 36]);
});

test('the own kitchen makes every level; a caterer only those the server says it can (no chef\'s menu)', () => {
  assert.deepEqual(servedBy('own', KITCHEN.qualities), ['economy', 'soigne', 'gastronomique']);
  assert.deepEqual(servedBy('caterer', KITCHEN.qualities), ['economy', 'soigne']);
  assert.deepEqual(servedBy('caterer', []), []);
});

test('the setting is what is decided for tomorrow when something is pending, else what runs today', () => {
  assert.deepEqual(configured(KITCHEN), { quality: 'soigne', provider: 'own' });
  assert.deepEqual(configured(kitchen({ quality: { current: 'soigne', next: 'economy' }, nextProvider: 'caterer' })), { quality: 'economy', provider: 'caterer' });
});

test('the selection is what is chosen, else what is set; a level the chosen provider cannot make falls to the nearest it can', () => {
  assert.deepEqual(selection(KITCHEN, noPending('LFMN')), { quality: 'soigne', provider: 'own' });
  assert.deepEqual(selection(KITCHEN, { quality: 'gastronomique', provider: null }), { quality: 'gastronomique', provider: 'own' });
  assert.deepEqual(selection(KITCHEN, { quality: 'gastronomique', provider: 'caterer' }), { quality: 'soigne', provider: 'caterer' });
});

test('arrows step the quality ladder and stop at its ends, inside what the provider makes', () => {
  const none = noPending('LFMN');
  assert.equal(stepQuality(KITCHEN, none, 1), 'gastronomique');
  assert.equal(stepQuality(KITCHEN, none, -1), 'economy');
  assert.equal(stepQuality(KITCHEN, { ...none, quality: 'economy' }, -1), 'economy');
  assert.equal(stepQuality(KITCHEN, { ...none, quality: 'gastronomique' }, 1), 'gastronomique');
  assert.equal(stepQuality(KITCHEN, { ...none, provider: 'caterer', quality: 'soigne' }, 1), 'soigne');
});

test('applying sends only what was picked and differs from the setting; looking at the screen alone sends nothing', () => {
  assert.equal(changeOf(KITCHEN, noPending('LFMN')), null);
  assert.deepEqual(changeOf(KITCHEN, { hub: 'LFMN', quality: 'economy', provider: null }), { quality: 'economy' });
  assert.deepEqual(changeOf(KITCHEN, { hub: 'LFMN', quality: null, provider: 'caterer' }), { provider: 'caterer' });
  assert.deepEqual(changeOf(KITCHEN, { hub: 'LFMN', quality: 'soigne', provider: 'own' }), null);
  const caterer = kitchen({ provider: 'caterer', quality: { current: 'gastronomique', next: null } });
  assert.equal(changeOf(caterer, noPending('LFMN')), null);
});

test('a change already pending is the baseline: picking what is pending again sends nothing', () => {
  const pend = kitchen({ quality: { current: 'soigne', next: 'economy' } });
  assert.equal(changeOf(pend, { hub: 'LFMN', quality: 'economy', provider: null }), null);
  assert.deepEqual(changeOf(pend, { hub: 'LFMN', quality: 'soigne', provider: null }), { quality: 'soigne' });
});

test('the hall is held, to rent or absent; a caterer serves an airport with none', () => {
  assert.equal(hallState(KITCHEN), 'held');
  assert.equal(hallState(kitchen({ hall: { facilityId: 11, held: false, rent: 8_500 } })), 'rentable');
  assert.equal(hallState(kitchen({ hall: null })), 'none');
});

test('a caterer makes the nearest level it can, at its unit price, and its margin is against the menu price of that level', () => {
  assert.deepEqual(catererOffer(KITCHEN, 'gastronomique'), { quality: 'soigne', perMeal: 8.1, margin: 1 - 8.1 / 14 });
  assert.deepEqual(catererOffer(KITCHEN, 'economy'), { quality: 'economy', perMeal: 5.45, margin: 1 - 5.45 / 9 });
  assert.equal(mealEconomics(KITCHEN, 'own', 'soigne').cost, 6.4);
  assert.deepEqual(mealEconomics(KITCHEN, 'caterer', 'soigne'), { quality: 'soigne', cost: 8.1, price: 14, margin: 1 - 8.1 / 14 });
});

test('a quote is shown only for the base and the level it was asked for', () => {
  const q = { hub: 'LFMN', quote: QUOTE };
  assert.equal(quoteFor(q, 'LFMN', 'soigne'), QUOTE);
  assert.equal(quoteFor(q, 'LFMN', 'economy'), null);
  assert.equal(quoteFor(q, 'LFLL', 'soigne'), null);
  assert.equal(quoteFor(null, 'LFMN', 'soigne'), null);
});

test('the status line: meals left unmade first, then a day the kitchen cannot make, then no meal at all, else on schedule', () => {
  const day = KITCHEN.day;
  assert.deepEqual(headline({ day: { ...day, unserved: 12 } }), { kind: 'unserved', n: 12, tone: 'warn' });
  assert.deepEqual(headline({ day }), { kind: 'short', demand: 548, capacity: 515, tone: 'warn' });
  assert.deepEqual(headline({ day: { ...day, capacity: 620 } }), { kind: 'ok', tone: 'ok' });
  assert.deepEqual(headline({ day: { ...day, capacity: null } }), { kind: 'ok', tone: 'ok' });
  assert.deepEqual(headline({ day: { ...day, demand: 0, snacks: 0, hot: 0, capacity: 620 } }), { kind: 'idle', tone: 'ok' });
});

test('an absent cook is the difference between those employed and those at work today', () => {
  assert.equal(absentCooks(KITCHEN), 1);
  assert.equal(absentCooks({ cooks: { employed: 6, onDuty: 6, needed: 6 } }), 0);
  assert.equal(absentCooks({ cooks: { employed: 6, onDuty: 7, needed: 6 } }), 0);
});
