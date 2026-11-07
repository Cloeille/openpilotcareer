import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHOICES, NOW, POLICIES, WAREHOUSE, WEAR } from './parts-fixtures.ts';
import {
  aogTimeline, breakEven, cashCurve, chartBars, currentOption, defaultChoices, defaultType, gaugesOf, itemsOf, kitFacts, kitTarget, leaveAll, partCount, policyBars, stepAction,
  stepPolicy, stockGroups, totalsOf, uncovered, wearTone, worksUntil, worstType, type Choices,
} from './parts-view.ts';

test('the warehouse row stops at both ends of none / critical / full', () => {
  assert.equal(stepPolicy('none', -1), 'none');
  assert.equal(stepPolicy('none', 1), 'critical');
  assert.equal(stepPolicy('critical', 1), 'full');
  assert.equal(stepPolicy('full', 1), 'full');
});

test('the screen opens on the type with an aircraft down, else the first with no stock, else the first', () => {
  assert.equal(defaultType(WAREHOUSE), 'C208');
  assert.equal(defaultType({ aog: null, policies: POLICIES }), 'C208');
  assert.equal(defaultType({ aog: null, policies: POLICIES.map((p) => ({ ...p, policy: 'full' as const })) }), 'AT76');
  assert.equal(defaultType({ aog: null, policies: [] }), null);
});

test('"order the critical kit" is for a type that has no stock: the one down first, else the selected one', () => {
  assert.equal(kitTarget(WAREHOUSE, 'AT76')?.icao, 'C208');
  assert.equal(kitTarget({ aog: null, policies: POLICIES }, 'C208')?.icao, 'C208');
  assert.equal(kitTarget({ aog: null, policies: POLICIES }, 'AT76'), null);
  assert.equal(kitTarget({ aog: null, policies: POLICIES }, null), null);
});

test('the Caravan kit: 18 400 tied up, 8 ground days a year avoided, 27 200 of revenue kept (the mockup)', () => {
  assert.deepEqual(kitFacts(POLICIES[3]!), { capital: 18_400, daysAvoided: 8, saved: 27_200 });
  assert.deepEqual(kitFacts({ ...POLICIES[3]!, options: { ...POLICIES[3]!.options, critical: { capital: 5, groundDays: 20 } } }), { capital: 5, daysAvoided: 0, saved: 0 });
});

test('bars are scaled to the biggest kit and the worst case, and follow the chosen policy', () => {
  const bars = policyBars(POLICIES);
  assert.equal(bars.get('AT76')!.capital, 1);
  assert.equal(bars.get('C208')!.capital, 0);
  assert.equal(bars.get('C208')!.ground, 11 / 14);
  assert.equal(currentOption(POLICIES[0]!).groundDays, 4);
  assert.deepEqual(policyBars([]), new Map());
});

test('uncovered aircraft, parts and the worst type read straight off the answer', () => {
  assert.deepEqual(uncovered(WAREHOUSE), ['F-HAZF']);
  assert.equal(partCount(WAREHOUSE), 18);
  assert.deepEqual(worstType(WAREHOUSE), { typeName: 'Grand Caravan', days: 11 });
  assert.equal(worstType({ policies: [] }), null);
});

test('the inventory is grouped by type in policy order, with its subtotal, and a type with nothing still has a group', () => {
  const g = stockGroups(WAREHOUSE);
  assert.deepEqual(g.map((x) => [x.policy.icao, x.lines.length, x.subtotal]), [['AT76', 6, 382_500], ['BCS3', 3, 65_000], ['CRJ7', 2, 33_900], ['C208', 0, 0]]);
  assert.equal(g.reduce((s, x) => s + x.subtotal, 0), WAREHOUSE.capital);
});

test('the AOG case on a ruler of whole UTC days: 3 days gone, 1 planned, the part lands the 7th', () => {
  const a = aogTimeline(WAREHOUSE.aog!, NOW);
  assert.deepEqual(a.days.map((d) => new Date(d).getUTCDate()), [3, 4, 5, 6, 7]);
  assert.equal(a.elapsedDays, 3);
  assert.equal(a.plannedDays, 1);
  assert.equal(a.lostDays, 4);
  assert.equal(new Date(a.onlineAt).toISOString(), '2026-11-04T00:40:00.000Z');
  assert.ok(a.grounded.from < a.nowPct && a.grounded.to === a.nowPct);
  assert.ok(a.planned && a.planned.from === a.nowPct && a.planned.to < 1 && a.planned.to > a.nowPct);
  assert.ok(a.fixed.to < 0.25);
});

test('a late part keeps the ruler on and plans nothing', () => {
  const late = aogTimeline({ failedAt: NOW - 5 * 86_400_000, eta: NOW - 3_600_000 }, NOW);
  assert.equal(late.planned, null);
  assert.equal(late.plannedDays, 0);
  assert.equal(late.grounded.to, late.nowPct);
  assert.ok(late.nowPct > 0.9 && late.nowPct < 1);
});

// ---------------------------------------------------------------- lease wear

test('amber from 75 % of wear: the mockup colours the engines (81) and the gear (76), not the propellers (64)', () => {
  assert.deepEqual([81, 76, 64, 70, 68, 58].map(wearTone), ['warn', 'warn', 'ok', 'ok', 'ok', 'ok']);
});

test('the server suggests the choices; leave-all and stepping stay inside leave / overhaul / replace', () => {
  assert.deepEqual(defaultChoices(WEAR), { engines: 'leave', gear: 'overhaul', propellers: 'overhaul', avionics: 'overhaul', interior: 'overhaul', paint: 'leave' });
  assert.ok(Object.values(leaveAll(WEAR)).every((a) => a === 'leave'));
  assert.equal(stepAction('leave', -1), 'leave');
  assert.equal(stepAction('leave', 1), 'overhaul');
  assert.equal(stepAction('replace', 1), 'replace');
});

test('the mockup\'s choices add up: 110 500 spent, 151 100 net handing back, 202 100 with the option, 261 600 gross, 51 000 of parts left', () => {
  const t = totalsOf(WEAR, defaultChoices(WEAR));
  assert.deepEqual(t, { works: 4, cost: 110_500, monthlyGain: 10_900, netReturn: 151_100, netBuy: 202_100, gross: 261_600, residual: 51_000, downDays: 6 });
});

test('leaving everything invests nothing; replacing the engines is what the screen says it is', () => {
  assert.deepEqual(totalsOf(WEAR, leaveAll(WEAR)), { works: 0, cost: 0, monthlyGain: 0, netReturn: 0, netBuy: 0, gross: 0, residual: 0, downDays: 0 });
  const dear: Choices = { ...leaveAll(WEAR), engines: 'replace' };
  assert.equal(totalsOf(WEAR, dear).cost, 1_180_000);
  assert.equal(totalsOf(WEAR, dear).downDays, 30);
});

test('the header: performance and reliability and satisfaction now, and after the choices', () => {
  const g = gaugesOf(WEAR, defaultChoices(WEAR));
  assert.deepEqual(g.performance, { now: 4, after: 3 });
  assert.deepEqual(g.reliability, { now: 91, after: 96 });
  assert.equal(Math.round(g.satisfaction.after * 10) / 10, 3.9);
  assert.deepEqual(gaugesOf(WEAR, leaveAll(WEAR)).reliability, { now: 91, after: 91 });
});

test('the cash curve starts at the cost, turns positive in month 11 and ends on the gain minus the cost', () => {
  const t = totalsOf(WEAR, defaultChoices(WEAR));
  const curve = cashCurve(t, 24);
  assert.equal(curve.length, 24);
  assert.equal(curve[0], -110_500 + 10_900);
  assert.equal(curve[23], 151_100);
  assert.equal(breakEven(curve), 11);
  assert.equal(breakEven(cashCurve({ cost: 100, monthlyGain: 0 }, 12)), null);
  assert.deepEqual(cashCurve({ cost: 0, monthlyGain: 0 }, 0), []);
});

test('chart bars scale each side to its own extreme and leave a flat curve empty', () => {
  const bars = chartBars([-10, -5, 0, 20]);
  assert.deepEqual(bars, [{ up: 0, down: 1 }, { up: 0, down: 0.5 }, { up: 0, down: 0 }, { up: 1, down: 0 }]);
  assert.deepEqual(chartBars([0, 0]), [{ up: 0, down: 0 }, { up: 0, down: 0 }]);
});

test('only the components worked on go to the server', () => {
  assert.deepEqual(itemsOf(defaultChoices(WEAR)), [{ component: 'gear', action: 'overhaul' }, { component: 'propellers', action: 'overhaul' }, { component: 'avionics', action: 'overhaul' }, { component: 'interior', action: 'overhaul' }]);
  assert.deepEqual(itemsOf(leaveAll(WEAR)), []);
});

test('works under way end at the latest end among the components', () => {
  assert.equal(worksUntil(WEAR, NOW), null);
  const busy = { components: WEAR.components.map((c, i) => (i < 2 ? { ...c, refurbUntil: NOW + (i + 1) * 86_400_000 } : c)) };
  assert.equal(worksUntil(busy, NOW), NOW + 2 * 86_400_000);
  assert.equal(worksUntil({ components: WEAR.components.map((c) => ({ ...c, refurbUntil: NOW - 1 })) }, NOW), null);
});

test('the fixture table has every component and every action', () => {
  assert.equal(Object.keys(CHOICES).length, 6);
  for (const c of Object.values(CHOICES)) assert.deepEqual(Object.keys(c), ['leave', 'overhaul', 'replace']);
});
