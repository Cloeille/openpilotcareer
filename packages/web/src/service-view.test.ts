import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateOf, cellFacts, cellOf, comfortOf, defaultHaul, effectsOf, GROUPS, HAULS, MEAL_QUALITIES, nextMode, operated } from './service-view.ts';
import { PREVIEW_GASTRO, QUALITIES, SERVICE } from './service-fixtures.ts';
import { messageFor } from './messages.ts';
import { METRICS } from './kitchen-view.ts';

const short = SERVICE.hauls[0]!, medium = SERVICE.hauls[1]!, long = SERVICE.hauls[2]!;
const cell = (haul: typeof short, item: Parameters<typeof cellOf>[2]) => cellOf([haul], haul.haul, item)!;

test('Enter steps a cell not offered -> paid -> free -> not offered; an item the aircraft cannot carry never moves', () => {
  const c = { mode: 'none', next: null, allowed: ['none', 'free', 'paid'], unavailable: false } as const;
  assert.equal(nextMode(c), 'paid');
  assert.equal(nextMode({ ...c, mode: 'paid' }), 'free');
  assert.equal(nextMode({ ...c, mode: 'free' }), 'none');
  assert.equal(nextMode({ ...c, unavailable: true }), null);
});

test('a second press goes on from what is already decided for tomorrow, not from what runs today', () => {
  const c = { mode: 'none', next: 'paid', allowed: ['none', 'free', 'paid'], unavailable: false } as const;
  assert.equal(nextMode(c), 'free');
});

test('a duty-free basket is never given: it only flips between not offered and paid; an item with one way cannot change', () => {
  const duty = { mode: 'paid', next: null, allowed: ['none', 'paid'], unavailable: false } as const;
  assert.equal(nextMode(duty), 'none');
  assert.equal(nextMode({ ...duty, mode: 'none' }), 'paid');
  assert.equal(nextMode({ ...duty, allowed: ['paid'] }), null);
});

test('the three groups list every item once, in the mockup order', () => {
  const flat: string[] = GROUPS.flatMap((g) => [...g.items]);
  assert.deepEqual(flat, ['drinks', 'snack', 'hot_meal', 'alcohol', 'films', 'wifi', 'comfort', 'duty_free']);
  assert.equal(new Set(flat).size, 8);
});

test('the comfort bar is the satisfaction rounded to 1..5 steps and the word follows the steps', () => {
  assert.deepEqual(comfortOf(2.4), { steps: 2, level: 'basic' });
  assert.deepEqual(comfortOf(3.9), { steps: 4, level: 'comfort' });
  assert.deepEqual(comfortOf(4.8), { steps: 5, level: 'premium' });
  assert.deepEqual(comfortOf(0), { steps: 1, level: 'basic' });
  assert.deepEqual(comfortOf(9), { steps: 5, level: 'premium' });
});

test('a class no line flies is not operated; the cursor starts on the first class flown, else the short one', () => {
  assert.equal(operated(long), false);
  assert.equal(operated(short), true);
  assert.equal(defaultHaul(SERVICE.hauls), 'short');
  assert.equal(defaultHaul([{ haul: 'short', operated: [] }, { haul: 'medium', operated: [{ icao: 'BCS3', name: 'A220' }] }, { haul: 'long', operated: [] }]), 'medium');
  assert.equal(defaultHaul([{ haul: 'short', operated: [] }, { haul: 'medium', operated: [] }, { haul: 'long', operated: [] }]), 'short');
});

test('a cell shows a price only when paid and priced; Wi-Fi is per flight; a served hot meal names the quality; unavailable beats the mode', () => {
  assert.deepEqual(cellFacts('hot_meal', 'medium', cell(medium, 'hot_meal'), 'soigne'), { state: 'paid', price: 14, perFlight: false, quality: 'soigne', catalogue: null, next: null });
  assert.deepEqual(cellFacts('wifi', 'medium', cell(medium, 'wifi'), 'soigne'), { state: 'paid', price: 8, perFlight: true, quality: null, catalogue: null, next: null });
  assert.equal(cellFacts('wifi', 'short', cell(short, 'wifi'), 'soigne').state, 'unavailable');
  assert.equal(cellFacts('snack', 'medium', cell(medium, 'snack'), 'soigne').price, null);
  assert.equal(cellFacts('hot_meal', 'short', cell(short, 'hot_meal'), 'soigne').quality, null);
});

test('the duty-free shop shows its catalogue (reduced up to medium, full on long) and no unit price', () => {
  assert.deepEqual([cellFacts('duty_free', 'medium', cell(medium, 'duty_free'), 'soigne'), cellFacts('duty_free', 'long', cell(long, 'duty_free'), 'soigne')].map((f) => [f.price, f.catalogue]), [[null, 'reduced'], [null, 'full']]);
});

test('what is decided for tomorrow shows on the cell only when it differs from today', () => {
  const pending = { ...cell(medium, 'snack'), next: 'paid' as const };
  assert.equal(cellFacts('snack', 'medium', pending, 'soigne').next, 'paid');
  assert.equal(cellFacts('snack', 'medium', { ...pending, next: 'free' }, 'soigne').next, null);
  assert.equal(cellFacts('snack', 'medium', { ...pending, next: null }, 'soigne').next, null);
});

test('the trade-off compares with the next level up, or the one below at the top', () => {
  assert.equal(candidateOf(QUALITIES, 'economy'), 'soigne');
  assert.equal(candidateOf(QUALITIES, 'soigne'), 'gastronomique');
  assert.equal(candidateOf(QUALITIES, 'gastronomique'), 'soigne');
  assert.equal(candidateOf([], 'soigne'), null);
});

test('the four effects of a switch to gastronomique: +0.5 good, -18 pts bad, 548 -> 310 meals a warning, 6 -> 9 cooks plain', () => {
  const [sat, margin, meals, cooks] = effectsOf(PREVIEW_GASTRO);
  assert.deepEqual(sat, { label: 'sat', tone: 'ok', value: { kind: 'delta', n: 0.5, unit: 'sat' } });
  assert.deepEqual(margin, { label: 'margin', tone: 'bad', value: { kind: 'delta', n: -18, unit: 'pts' } });
  assert.deepEqual(meals, { label: 'meals', tone: 'warn', value: { kind: 'move', from: 548, to: 310 } });
  assert.deepEqual(cooks, { label: 'cooks', tone: 'plain', value: { kind: 'move', from: 6, to: 9 } });
  assert.equal(effectsOf({ ...PREVIEW_GASTRO, meals: { demand: 548, from: 310, to: 548 } })[2]!.tone, 'plain');
});

test('with no cabin flying the server has no satisfaction figure, so that effect is not drawn', () => {
  const effects = effectsOf({ ...PREVIEW_GASTRO, satisfaction: { from: null, to: null } });
  assert.deepEqual(effects.map((e) => e.label), ['margin', 'meals', 'cooks']);
});

test('every message key the screens build from data exists in both languages', () => {
  const keys = [
    ...HAULS.flatMap((h) => [`sv.haul.${h}`, `sv.haul.on.${h}`, `sv.haul.sub.${h}`]),
    ...GROUPS.flatMap((g) => [`sv.group.${g.id}`, ...g.items.map((i) => `sv.item.${i}`)]),
    ...['free', 'paid', 'none', 'unavailable'].map((m) => `sv.mode.${m}`),
    ...['basic', 'comfort', 'premium'].map((l) => `sv.comfort.${l}`),
    ...['reduced', 'full'].map((c) => `sv.cell.catalogue.${c}`),
    ...MEAL_QUALITIES.flatMap((q) => [`sv.q.${q}`, `kt.q.${q}.desc`]),
    ...['sat', 'margin', 'meals', 'cooks'].map((e) => `sv.trade.${e}`),
    ...METRICS.flatMap((m) => [`kt.m.${m.id}`, `kt.m.${m.id}.sub`]),
    ...['done', 'scheduled'].map((s) => `kt.dep.${s}`),
  ];
  assert.deepEqual(keys.filter((k) => messageFor(k) === null), []);
});
