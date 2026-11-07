import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPONENTS, DELIVERY_DAYS, REFURB_DAYS, isHeavyCheck, FAILURE_WEAR_PCT, FERRY_DAYS, FIX_HOURS_WITH_PART, HANGAR_FIX_HOURS, HEAVY_CHECK_DAYS, HOURS_PER_MONTH, KEEP_VALUE_SHARE, NEVER_PAYBACK_MONTHS, OVERHAUL_WEAR_PCT, PARTS, PART_CLASSES,
  RENEWED_WEAR_PCT, SEED_WEAR_MAX_PCT, addEffects, bestChoice, choiceView, componentRate, componentWearAfter, componentsOf, deliveryDays, failedPart, failuresPerYear, fixHours, groundDayValue,
  groundDaysPerYear, kitCapital, kitCovers, kitOf, kpiOf, moneyFactors, monthlyLoss, orderBodySchema, partClassOf, policyBodySchema, refurbCost, refurbTotals, refurbishBodySchema, reliabilityRiskFactor,
  seedWear, wearEffects, wearQuerySchema, worksDays, type Choice, type Economics,
} from './index.ts';

const econ: Economics = { revenuePerHour: 2_000, costPerHour: 400 };

test('components: propellers exist on turboprops and helicopters only; every component wears with the category, its weight and the hours', () => {
  assert.deepEqual(componentsOf('turboprop-multi'), [...COMPONENTS]);
  assert.deepEqual(componentsOf('jet-airliner'), COMPONENTS.filter((c) => c !== 'propellers'));
  assert.ok(componentsOf('helicopter').includes('propellers') && !componentsOf('piston-single').includes('propellers'));
  assert.ok(componentRate('engines', 'jet-airliner') > componentRate('paint', 'jet-airliner'), 'the engines wear more than the paint');
  assert.ok(componentRate('gear', 'piston-single') > componentRate('gear', 'jet-widebody'), 'a light aircraft wears faster');
  assert.equal(componentWearAfter(10, 'gear', 'jet-airliner', 100), Math.round((10 + componentRate('gear', 'jet-airliner') * 100) * 100) / 100);
  assert.equal(componentWearAfter(99.9, 'gear', 'jet-airliner', 10_000), 100, 'wear stops at 100');
});

test('seeded wear: deterministic from the airframe hours, zero for a new aircraft, never above the cap, and an older airframe is not always more worn (parts were replaced)', () => {
  for (const c of COMPONENTS) assert.equal(seedWear(c, 'turboprop-multi', 0), 0);
  for (const hours of [500, 6_840, 38_400, 123_456]) for (const c of COMPONENTS) {
    const w = seedWear(c, 'turboprop-airliner', hours);
    assert.ok(w >= RENEWED_WEAR_PCT && w <= SEED_WEAR_MAX_PCT, `${c} ${hours} h -> ${w}`);
    assert.equal(w, seedWear(c, 'turboprop-airliner', hours), 'the same airframe always gives the same wear');
  }
  assert.ok(SEED_WEAR_MAX_PCT < FAILURE_WEAR_PCT, 'an aircraft never arrives already broken');
});

test('effects of wear (B.6): the stated effect at 80 %, linear in the wear, additive over components', () => {
  assert.deepEqual([wearEffects('engines', 80).performance, wearEffects('gear', 80).reliability, wearEffects('avionics', 80).reliability], [0.03, 2, 3]);
  assert.deepEqual([wearEffects('interior', 80).load, wearEffects('interior', 80).satisfaction > 0, wearEffects('paint', 80).satisfaction > 0], [0.04, true, true]);
  assert.equal(wearEffects('gear', 40).reliability, 1);
  assert.equal(wearEffects('gear', 0).reliability, 0);
  const e = addEffects([wearEffects('gear', 80), wearEffects('avionics', 80)]);
  assert.equal(e.reliability, 5);
  assert.equal(kpiOf(e).reliability, kpiOf(addEffects([])).reliability - 5);
  assert.ok(kpiOf(addEffects([])).reliability <= 100 && kpiOf(addEffects([])).satisfaction <= 5);
});

test('money of wear: nothing worn costs nothing; a lost passenger share is the same share of revenue; lost speed raises fuel and maintenance; the loss a month is what the screen says', () => {
  assert.deepEqual(moneyFactors(addEffects([])), { revenue: 1, cost: 1 });
  assert.equal(monthlyLoss(addEffects([]), econ), 0);
  assert.ok(Math.abs(moneyFactors({ performance: 0, reliability: 0, satisfaction: 0, load: 0.04 }).revenue - 0.96) < 1e-12);
  assert.ok(moneyFactors({ performance: 0.03, reliability: 0, satisfaction: 0, load: 0 }).cost > 1.03 - 1e-9);
  const worn = wearEffects('interior', 80);
  assert.equal(monthlyLoss(worn, econ), Math.round(HOURS_PER_MONTH * econ.revenuePerHour * (1 - moneyFactors(worn).revenue)));
  assert.ok(monthlyLoss(wearEffects('engines', 80), econ) > 0 && monthlyLoss(wearEffects('engines', 80), econ) < monthlyLoss(wearEffects('engines', 100), econ));
  assert.equal(reliabilityRiskFactor(0), 1);
  assert.ok(reliabilityRiskFactor(5) > reliabilityRiskFactor(2));
});

test('refurbish and replace: cost by the aircraft value, wear after, payback = cost / monthly gain rounded up, net = gain x months - cost, never when it does not pay', () => {
  const value = 200_000;
  assert.ok(refurbCost('replace', 'engines', value) > refurbCost('overhaul', 'engines', value));
  const leave = choiceView('leave', 'gear', 76, value, econ, 24, true);
  assert.deepEqual([leave.cost, leave.net, leave.netIfBought, leave.days, leave.paybackMonths, leave.wearAfter], [0, 0, 0, 0, null, 76]);
  const over = choiceView('overhaul', 'gear', 76, value, econ, 24, false);
  const gain = leave.monthlyLoss - over.monthlyLoss;
  assert.equal(over.cost, refurbCost('overhaul', 'gear', value));
  assert.equal(over.wearAfter, OVERHAUL_WEAR_PCT);
  assert.equal(over.paybackMonths, Math.ceil(over.cost / gain));
  assert.equal(over.net, gain * 24 - over.cost);
  assert.equal(over.netIfBought, over.net, 'off a lease the new parts are not "kept": there is nothing to buy');
  const rep = choiceView('replace', 'gear', 76, value, econ, 24, true);
  assert.equal(rep.wearAfter, 0);
  assert.equal(rep.netIfBought, rep.net + Math.round(rep.cost * KEEP_VALUE_SHARE), 'on a lease, buying the aircraft keeps the new parts');
  // a component with no wear gains nothing: never pays; one that pays back too late says never
  const fresh = choiceView('overhaul', 'gear', 0, value, econ, 24, false);
  assert.deepEqual([fresh.paybackMonths, fresh.net < 0], [null, true]);
  const slow = choiceView('replace', 'engines', 90, 5_000_000, { revenuePerHour: 100, costPerHour: 10 }, 24, false);
  assert.equal(slow.paybackMonths, null);
  assert.ok(NEVER_PAYBACK_MONTHS > 24);
});

test('the best choice of a component is the one with the best positive net; "leave" when nothing pays', () => {
  const pays = Object.fromEntries((['leave', 'overhaul', 'replace'] as const).map((a) => [a, choiceView(a, 'avionics', 80, 200_000, econ, 24, false)])) as Record<Choice, ReturnType<typeof choiceView>>;
  assert.equal(bestChoice(pays), pays.overhaul.net > pays.replace.net ? 'overhaul' : 'replace');
  assert.ok(pays[bestChoice(pays)].net > 0);
  const nothing = Object.fromEntries((['leave', 'overhaul', 'replace'] as const).map((a) => [a, choiceView(a, 'paint', 0, 200_000, econ, 24, false)])) as Record<Choice, ReturnType<typeof choiceView>>;
  assert.equal(bestChoice(nothing), 'leave');
});

test('totals of a selection: the cost, the longest item, the net handed back and bought, and the cash curve crosses zero at the break-even month', () => {
  const value = 200_000;
  const rows = (['gear', 'avionics', 'interior'] as const).map((component, i) => ({ component, choices: Object.fromEntries((['leave', 'overhaul', 'replace'] as const).map((a) => [a, choiceView(a, component, [76, 70, 68][i]!, value, econ, 24, true)])) as Record<Choice, ReturnType<typeof choiceView>> }));
  const t = refurbTotals(rows, [{ component: 'gear', action: 'overhaul' }, { component: 'avionics', action: 'overhaul' }, { component: 'interior', action: 'leave' }], 24);
  const a = rows[0]!.choices.overhaul, b = rows[1]!.choices.overhaul;
  assert.equal(t.cost, a.cost + b.cost);
  assert.equal(t.itemDays, Math.max(a.days, b.days));
  assert.equal(t.give, a.net + b.net);
  assert.equal(t.buy, a.netIfBought + b.netIfBought);
  assert.equal(t.cashCurve.length, 24);
  assert.equal(t.cashCurve[0], (rows[0]!.choices.leave.monthlyLoss - a.monthlyLoss) + (rows[1]!.choices.leave.monthlyLoss - b.monthlyLoss) - t.cost);
  assert.equal(t.cashCurve.at(-1), t.give, 'after the last month the curve is the net of handing the aircraft back');
  assert.equal(t.cashCurve.findIndex((v) => v >= 0) + 1, t.breakEvenMonth);
  assert.ok(t.cashCurve.every((v, i) => i === 0 || v > t.cashCurve[i - 1]!), 'the curve rises every month');
  const none = refurbTotals(rows, [{ component: 'gear', action: 'leave' }], 24);
  assert.deepEqual([none.cost, none.give, none.breakEvenMonth, none.cashCurve.every((v) => v === 0)], [0, 0, null, true]);
});

test('the catalogue anchors the mockup: the ATR full kit is 382 500, the jet critical kit 65 000, the turboprop critical kit is the 18 400 fuel regulator; every kit part exists once per class', () => {
  assert.equal(kitCapital('regional', 'full'), 382_500);
  assert.equal(kitCapital('jet', 'critical'), 65_000);
  assert.equal(kitCapital('turboprop', 'critical'), 18_400);
  assert.equal(kitCapital('regional', 'none'), 0);
  for (const cls of PART_CLASSES) assert.ok(kitCapital(cls, 'full') > kitCapital(cls, 'critical') && kitCapital(cls, 'critical') > 0, cls);
  assert.equal(new Set(PARTS.map((p) => p.id)).size, PARTS.length);
  assert.deepEqual(kitOf('regional', 'none'), []);
  assert.ok(kitOf('regional', 'critical').every((l) => l.qty === l.part.critical));
  assert.deepEqual([partClassOf('turboprop-airliner'), partClassOf('jet-widebody'), partClassOf('turboprop-single'), partClassOf('piston-multi'), partClassOf('helicopter')], ['regional', 'jet', 'turboprop', 'piston', 'turboprop']);
});

test('expected ground days (B.6): failures a year x the downtime, which is six hours with the part and days of delivery without; more stock never means more days', () => {
  for (const [category, cls] of [['turboprop-airliner', 'regional'], ['jet-airliner', 'jet'], ['turboprop-single', 'turboprop'], ['piston-single', 'piston']] as const) {
    const days = (['none', 'critical', 'full'] as const).map((p) => groundDaysPerYear(category, kitCovers(cls, p)));
    assert.ok(days[0]! > days[1]! && days[1]! > days[2]!, `${category}: ${days.join(' > ')}`);
    assert.ok(failuresPerYear(category) > 0);
    assert.ok(Math.abs(groundDaysPerYear(category, () => true) - (failuresPerYear(category) * FIX_HOURS_WITH_PART) / 24) < 1e-9, 'with everything on the shelf each failure is the six-hour repair');
  }
  assert.ok(groundDaysPerYear('turboprop-airliner', () => false, 2_000) > groundDaysPerYear('turboprop-airliner', () => false, 1_000), 'flying more breaks more');
  assert.ok(groundDayValue(econ) > 0);
  assert.equal(groundDayValue({ revenuePerHour: 0, costPerHour: 5 }), 0);
});

test('a breakdown picks the failed part of its component from a draw, and a delivery takes 2 to 5 days', () => {
  assert.deepEqual([failedPart('regional', 'engines', 0).kind, failedPart('regional', 'engines', 0.99).kind], ['engine', 'starter']);
  assert.equal(failedPart('regional', 'propellers', 0.5).kind, 'propeller');
  assert.ok(PARTS.some((p) => p.id === failedPart('jet', 'gear', 0.7).id));
  assert.deepEqual([0, 0.26, 0.51, 0.76, 0.999].map(deliveryDays), [2, 3, 4, 5, 5]);
  assert.ok((DELIVERY_DAYS as readonly number[]).every((d) => d >= 2 && d <= 5));
  assert.deepEqual([fixHours(false), fixHours(true)], [FIX_HOURS_WITH_PART, HANGAR_FIX_HOURS]);
  assert.ok(HANGAR_FIX_HOURS < FIX_HOURS_WITH_PART);
});

test('workshop days: a hangar halves them (B.4), a heavy check without a staffed level-2 hangar adds the ferry, a short visit never does', () => {
  assert.equal(worksDays(0, 0.5, false), 0);
  assert.equal(worksDays(6, 1, false), 6, 'six days is not a heavy check: no ferry');
  assert.equal(worksDays(HEAVY_CHECK_DAYS, 1, false), HEAVY_CHECK_DAYS, 'the limit itself is not heavy');
  assert.equal(worksDays(6, 0.5, false), 3);
  const heavy = HEAVY_CHECK_DAYS + 3;
  assert.equal(REFURB_DAYS.replace.engines, 21);
  assert.deepEqual(COMPONENTS.flatMap((c) => (['overhaul', 'replace'] as const).filter((a) => isHeavyCheck(REFURB_DAYS[a][c])).map((a) => `${c}:${a}`)), ['engines:replace'], 'only an engine replacement is a heavy check');
  assert.equal(worksDays(heavy, 1, false), heavy + FERRY_DAYS);
  assert.equal(worksDays(heavy, 0.5, false), Math.ceil(heavy / 2) + FERRY_DAYS);
  assert.equal(worksDays(heavy, 0.5, true), Math.ceil(heavy / 2), 'a level-2 hangar: heavy checks without ferry');
});

test('request schemas: a policy needs a type and a known policy, an order a catalogue-shaped id and 1 to 20, a refurbishment one action per component, ?pick= a component:action list', () => {
  assert.equal(policyBodySchema.safeParse({ icao: 'AT76', policy: 'full' }).success, true);
  assert.equal(policyBodySchema.safeParse({ icao: 'AT76', policy: 'lots' }).success, false);
  assert.equal(orderBodySchema.safeParse({ partId: 'regional.engine', qty: 1 }).success, true);
  assert.deepEqual([0, 21, 1.5].map((qty) => orderBodySchema.safeParse({ partId: 'regional.engine', qty }).success), [false, false, false]);
  assert.equal(orderBodySchema.safeParse({ partId: 'DROP TABLE', qty: 1 }).success, false);
  assert.equal(refurbishBodySchema.safeParse({ items: [{ component: 'gear', action: 'overhaul' }, { component: 'avionics', action: 'replace' }] }).success, true);
  assert.equal(refurbishBodySchema.safeParse({ items: [] }).success, false);
  assert.equal(refurbishBodySchema.safeParse({ items: [{ component: 'gear', action: 'overhaul' }, { component: 'gear', action: 'replace' }] }).success, false);
  assert.equal(refurbishBodySchema.safeParse({ items: [{ component: 'gear', action: 'leave' }] }).success, false, '"leave" is not a work order');
  assert.deepEqual(wearQuerySchema.parse({ pick: 'gear:overhaul,paint:leave' }).pick, [{ component: 'gear', action: 'overhaul' }, { component: 'paint', action: 'leave' }]);
  assert.equal(wearQuerySchema.parse({}).pick, undefined);
  for (const pick of ['wings:overhaul', 'gear:polish', 'gear:overhaul,gear:replace', 'gear']) assert.equal(wearQuerySchema.safeParse({ pick }).success, false, pick);
});
