import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cabinRows, candidateOf, cellFacts, comfortOf, defaultHaul, effectsOf, GROUPS, nextMode, operated } from './service-view.ts';
import { PREVIEW_GASTRO, SERVICE, TIERS } from './service-fixtures.ts';

const type = (icao: string, name: string, seats: number) => ({ type: { icao, name, seats } });

test('Enter steps a cell not offered -> paid -> free -> not offered; an item the aircraft cannot carry never moves', () => {
  assert.equal(nextMode('none'), 'paid');
  assert.equal(nextMode('paid'), 'free');
  assert.equal(nextMode('free'), 'none');
  assert.equal(nextMode('unavailable'), null);
});

test('the three groups list every item once, in the mockup order', () => {
  const flat: string[] = GROUPS.flatMap((g) => [...g.items]);
  assert.deepEqual(flat, ['drinks', 'snack', 'hotMeal', 'alcohol', 'films', 'wifi', 'comfort', 'dutyFree']);
  assert.equal(new Set(flat).size, 8);
});

test('the comfort bar is the satisfaction rounded to 1..5 steps and the word follows the steps', () => {
  assert.deepEqual(comfortOf(2.4), { steps: 2, level: 'basic' });
  assert.deepEqual(comfortOf(3.9), { steps: 4, level: 'comfort' });
  assert.deepEqual(comfortOf(4.8), { steps: 5, level: 'premium' });
  assert.deepEqual(comfortOf(0), { steps: 1, level: 'basic' });
  assert.deepEqual(comfortOf(9), { steps: 5, level: 'premium' });
});

test('a class with no flight is not operated; the cursor starts on the busiest class, else the short one', () => {
  assert.equal(operated(SERVICE.hauls[2]!), false);
  assert.equal(operated(SERVICE.hauls[0]!), true);
  assert.equal(defaultHaul(SERVICE.hauls), 'short');
  assert.equal(defaultHaul([{ haul: 'short', flightsPerDay: 2 }, { haul: 'medium', flightsPerDay: 9 }, { haul: 'long', flightsPerDay: 9 }]), 'medium');
  assert.equal(defaultHaul([{ haul: 'short', flightsPerDay: 0 }, { haul: 'medium', flightsPerDay: 0 }, { haul: 'long', flightsPerDay: 0 }]), 'short');
});

test('a cell shows a price only when paid and priced; Wi-Fi is per flight; a served hot meal names the quality', () => {
  const medium = SERVICE.hauls[1]!.cells;
  assert.deepEqual(cellFacts('hotMeal', medium.hotMeal, 'soigne'), { mode: 'paid', price: 14, perFlight: false, quality: 'soigne' });
  assert.deepEqual(cellFacts('wifi', medium.wifi, 'soigne'), { mode: 'paid', price: 8, perFlight: true, quality: null });
  assert.deepEqual(cellFacts('dutyFree', medium.dutyFree, 'soigne'), { mode: 'paid', price: null, perFlight: false, quality: null });
  assert.equal(cellFacts('hotMeal', { mode: 'none', price: null }, 'soigne').quality, null);
  assert.equal(cellFacts('snack', { mode: 'free', price: 4 }, 'soigne').price, null);
});

test('the trade-off compares with the next level up, or the one below at the top', () => {
  assert.equal(candidateOf(TIERS, 'economy'), 'soigne');
  assert.equal(candidateOf(TIERS, 'soigne'), 'gastronomique');
  assert.equal(candidateOf(TIERS, 'gastronomique'), 'soigne');
  assert.equal(candidateOf([], 'soigne'), null);
});

test('the four effects of a switch to gastronomique: +0.5 good, -18 pts bad, 620 -> 310 meals a warning, 6 -> 9 cooks plain', () => {
  const [sat, margin, meals, cooks] = effectsOf(PREVIEW_GASTRO);
  assert.deepEqual(sat, { label: 'sat', tone: 'ok', value: { kind: 'delta', n: 0.5, unit: 'sat' } });
  assert.deepEqual(margin, { label: 'margin', tone: 'bad', value: { kind: 'delta', n: -18, unit: 'pts' } });
  assert.deepEqual(meals, { label: 'meals', tone: 'warn', value: { kind: 'move', from: 620, to: 310 } });
  assert.deepEqual(cooks, { label: 'cooks', tone: 'plain', value: { kind: 'move', from: 6, to: 9 } });
  assert.equal(effectsOf({ ...PREVIEW_GASTRO, mealsPerDay: { from: 310, to: 620 } })[2]!.tone, 'plain');
});

test('cabin crew per type follow the crew rule the line engine checks (1 per 40 seats from 20 seats), smallest aircraft first, none for a cabin-less one', () => {
  const rows = cabinRows([type('BCS3', 'A220-300', 130), type('AT76', 'ATR 72-600', 70), type('AT76', 'ATR 72-600', 70), type('C172', 'Cessna 172', 4)]);
  assert.deepEqual(rows, [{ icao: 'AT76', name: 'ATR 72-600', crew: 2 }, { icao: 'BCS3', name: 'A220-300', crew: 4 }]);
  assert.deepEqual(cabinRows([]), []);
});
