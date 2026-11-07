import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY, ITEMS, MEALS, MEAL_QUALITIES, SAT_BASE, SATISFACTION_STREAK_DAYS, HAULS, SERVICE_ITEMS, catererPrice, catererQuality, haulOf, hasCabin, cabinMinimum, cooksFor, kitchenCapacity,
  foodCost, itemAvailable, legSatisfaction, legService, mealCost, mealIngredients, mealMargin, mealsAsked, modeAllowed, offerFor, servicePolicyBodySchema, satisfactionFactor, withSatisfaction,
  kitchenBodySchema, LOAD_FACTOR_MAX, LOAD_FACTOR_MIN, BASE_SALARY,
} from './index.ts';

// ---------------------------------------------------------------- haul classes and aircraft

test('haul class follows block time: short under 1 h 30, medium to 4 h, long above', () => {
  assert.deepEqual([60, 89, 90, 240, 241, 600].map(haulOf), ['short', 'short', 'medium', 'medium', 'long', 'long']);
});

test('a cabin exists from 20 seats (the crew check\'s own rule), the legal minimum is one per 50 seats', () => {
  assert.deepEqual([4, 19, 20, 72, 130].map(hasCabin), [false, false, true, true, true]);
  assert.deepEqual([4, 72, 130].map(cabinMinimum), [0, 2, 3]);
});

test('an ATR has no screens and no Wi-Fi, a jet has: the aircraft decides what can be offered', () => {
  assert.deepEqual(SERVICE_ITEMS.filter((i) => !itemAvailable(i, 'turboprop-airliner')), ['films', 'wifi']);
  assert.deepEqual(SERVICE_ITEMS.filter((i) => !itemAvailable(i, 'jet-airliner')), []);
  const atr = offerFor(DEFAULT_POLICY.medium, 'medium', 'turboprop-airliner', 'soigne');
  assert.ok(!atr.lines.some((l) => l.item === 'films' || l.item === 'wifi'));
  assert.ok(offerFor(DEFAULT_POLICY.medium, 'medium', 'jet-airliner', 'soigne').lines.some((l) => l.item === 'wifi'));
});

// ---------------------------------------------------------------- meals: costs derived from the economy, not the mockup's two contradicting screens

test('meal costs come from the cook\'s pay and a food share: the margin is 1 - cost / price, so the two mockup tables are not reproduced', () => {
  assert.deepEqual(MEAL_QUALITIES.map((q) => mealCost(q)), [3.09, 6.4, 14.77]);
  assert.deepEqual(MEAL_QUALITIES.map((q) => mealMargin(q)), [0.66, 0.54, 0.36]);
  assert.deepEqual(MEAL_QUALITIES.map((q) => MEALS[q].price), [9, 14, 23], 'the prices are the Service screen\'s');
  // labour of a soigne meal: one cook (BASE_SALARY.kitchen a month) makes 620 / 6 meals a day
  const labour = BASE_SALARY.kitchen / 30 / (620 / 6);
  assert.equal(mealCost('soigne'), Math.round((mealIngredients('soigne') + labour) * 100) / 100);
  for (const q of MEAL_QUALITIES) assert.ok(mealCost(q) < MEALS[q].price, `${q} makes a profit on the menu price`);
});

test('the kitchen: the cooks of the day set the capacity (620 meals need exactly 6 cooks), gastronomique cannot feed 548 meals', () => {
  assert.equal(cooksFor('soigne', 620), 6);
  assert.equal(cooksFor('soigne', 548), 6);
  assert.equal(kitchenCapacity('soigne', 6), 620);
  assert.equal(kitchenCapacity('soigne', 5), 516, 'one cook of six away: about the mockup\'s 515');
  assert.equal(kitchenCapacity('soigne', 12), 620, 'never more than the hall\'s maximum');
  assert.equal(kitchenCapacity('soigne', 0), 0);
  assert.ok(kitchenCapacity('gastronomique', 100) < 548 && MEALS.gastronomique.maxOutput < 548);
  assert.equal(cooksFor('gastronomique', 548), 16, 'more cooks than the 9 of a full team: two shifts');
  assert.ok(cooksFor('gastronomique', 548) > cooksFor('soigne', 548) && cooksFor('economy', 548) < cooksFor('soigne', 548));
});

test('a caterer has no cap but no chef\'s menu, costs more than an own kitchen\'s ingredients, and a small airport costs more', () => {
  assert.equal(catererQuality('gastronomique'), 'soigne');
  assert.equal(catererQuality('economy'), 'economy');
  for (const q of MEAL_QUALITIES) assert.ok(catererPrice(q, 'large') > mealCost(q), `${q}: its margin is on top of the cost`);
  assert.ok(catererPrice('soigne', 'small') > catererPrice('soigne', 'large'));
  assert.equal(foodCost('own', 'soigne', 'large').hot, mealIngredients('soigne'), 'an own kitchen\'s cooks are on the payroll already');
  assert.equal(foodCost('caterer', 'gastronomique', 'large').hot, catererPrice('soigne', 'large'));
});

// ---------------------------------------------------------------- the policy table and satisfaction

test('the default policy reproduces the mockup\'s columns and about its 4.2 satisfaction on a jet, medium-haul', () => {
  const med = offerFor(DEFAULT_POLICY.medium, 'medium', 'jet-airliner', 'soigne');
  assert.ok(Math.abs(med.satisfaction - 4.2) < 0.05, `${med.satisfaction}`);
  assert.equal(offerFor(DEFAULT_POLICY.short, 'short', 'turboprop-airliner', 'soigne').satisfaction, 3);
  assert.ok(offerFor(DEFAULT_POLICY.long, 'long', 'jet-airliner', 'soigne').satisfaction > med.satisfaction);
  assert.equal(offerFor(DEFAULT_POLICY.long, 'long', 'jet-airliner', 'soigne').lines.find((l) => l.item === 'hot_meal')!.mode, 'free');
  const none = offerFor({ ...DEFAULT_POLICY.short, drinks: 'none', snack: 'none' }, 'short', 'jet-airliner', 'soigne');
  assert.deepEqual({ s: none.satisfaction, n: none.lines.length }, { s: SAT_BASE, n: 0 });
});

test('free pleases more than paid, a better meal pleases more, and giving more never lowers satisfaction', () => {
  const sat = (mode: 'free' | 'paid', q: 'economy' | 'soigne' | 'gastronomique' = 'soigne') => offerFor({ ...DEFAULT_POLICY.short, hot_meal: mode }, 'short', 'jet-airliner', q).satisfaction;
  assert.ok(sat('free') > sat('paid'));
  assert.ok(sat('free', 'gastronomique') > sat('free', 'soigne') && sat('free', 'soigne') > sat('free', 'economy'));
  for (const haul of HAULS) for (const item of SERVICE_ITEMS) {
    if (!modeAllowed(item, 'free')) continue;
    const base = { ...DEFAULT_POLICY[haul], [item]: 'none' as const };
    assert.ok(offerFor({ ...base, [item]: 'free' }, haul, 'jet-airliner', 'soigne').satisfaction >= offerFor(base, haul, 'jet-airliner', 'soigne').satisfaction, `${haul} ${item}`);
  }
});

test('duty-free is sold, never given; the policy body refuses a mode the item cannot have', () => {
  assert.equal(modeAllowed('duty_free', 'free'), false);
  assert.equal(servicePolicyBodySchema.safeParse({ haul: 'short', item: 'duty_free', mode: 'free' }).success, false);
  assert.equal(servicePolicyBodySchema.safeParse({ haul: 'short', item: 'duty_free', mode: 'paid' }).success, true);
  assert.equal(servicePolicyBodySchema.safeParse({ haul: 'weekly', item: 'snack', mode: 'paid' }).success, false);
  assert.equal(kitchenBodySchema.safeParse({}).success, false);
  assert.equal(kitchenBodySchema.safeParse({ provider: 'caterer' }).success, true);
});

test('satisfaction moves the load factor by 1 + 0.04 x (s - 3.5), never more than 6 %, and the result stays in the engine\'s bounds', () => {
  assert.equal(satisfactionFactor(3.5), 1);
  assert.equal(Math.round(satisfactionFactor(4.2) * 1000) / 1000, 1.028);
  assert.equal(satisfactionFactor(5), 1.06);
  assert.equal(satisfactionFactor(1), 0.94, 'the cap: 1 would give -10 %');
  assert.equal(withSatisfaction(0, 5), 0, 'no seats stay no seats');
  assert.equal(withSatisfaction(0.5, 5), 0.53);
  assert.equal(withSatisfaction(LOAD_FACTOR_MAX, 5), LOAD_FACTOR_MAX);
  assert.equal(withSatisfaction(LOAD_FACTOR_MIN, 1), LOAD_FACTOR_MIN);
});

// ---------------------------------------------------------------- one leg

test('a leg sells what its paid items sell and costs what it gives away, the crew gets 5 % of the sales', () => {
  const o = offerFor({ ...DEFAULT_POLICY.short, drinks: 'free', snack: 'paid', hot_meal: 'none' }, 'short', 'turboprop-airliner', 'soigne');
  const food = foodCost('own', 'soigne', 'large');
  const pax = 60;
  const s = legService(o, pax, { share: 1, food });
  const snacks = Math.round(pax * ITEMS.snack.paidTake), drinks = Math.round(pax * ITEMS.drinks.take);
  assert.equal(s.sales, snacks * 4);
  assert.equal(s.cost, Math.round(drinks * ITEMS.drinks.cost.short + snacks * food.snack + s.sales * 0.05));
  assert.deepEqual({ snacks: s.snacks, hot: s.hot }, { snacks, hot: 0 });
  assert.deepEqual(mealsAsked(o, pax), { snacks, hot: 0 });
});

test('meals the kitchen cannot make are neither sold nor paid for, and they cost the leg its satisfaction', () => {
  const o = offerFor(DEFAULT_POLICY.medium, 'medium', 'jet-airliner', 'soigne');
  const food = foodCost('own', 'soigne', 'large');
  const full = legService(o, 100, { share: 1, food }), half = legService(o, 100, { share: 0.5, food }), none = legService(o, 100, { share: 0, food });
  assert.ok(half.hot < full.hot && half.hot > none.hot && none.hot === 0 && none.snacks === 0);
  assert.ok(legSatisfaction(o, 1) === o.satisfaction && legSatisfaction(o, 0.5) < o.satisfaction && legSatisfaction(o, 0) < legSatisfaction(o, 0.5));
  assert.ok(o.satisfaction - legSatisfaction(o, 0) >= 1, 'at least the point of B.7');
});
