import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AOG, NOW, POLICIES, WAREHOUSE, WEAR } from './parts-fixtures.ts';
import {
  aogTimeline, chartBars, choicesOf, currentOption, defaultType, effectLines, itemsOf, kitFacts, kitTarget, leaveAll, optionOf, partCount, pickOf, policyBars, scenariosOf, stepChoice,
  stepPolicy, stockGroups, uncovered, wearTone, worksUntil, worstType,
} from './parts-view.ts';

test('the warehouse row stops at both ends of none / critical / full', () => {
  assert.equal(stepPolicy('none', -1), 'none');
  assert.equal(stepPolicy('none', 1), 'critical');
  assert.equal(stepPolicy('critical', 1), 'full');
  assert.equal(stepPolicy('full', 1), 'full');
});

test('the screen opens on the type with an aircraft down, else the first without its critical kit, else the first', () => {
  assert.equal(defaultType(WAREHOUSE), 'C208');
  assert.equal(defaultType({ aog: null, policies: POLICIES }), 'C208');
  assert.equal(defaultType({ aog: null, policies: POLICIES.map((p) => ({ ...p, covered: true })) }), 'AT76');
  assert.equal(defaultType({ aog: null, policies: [] }), null);
});

test('"order the critical kit" is for a type whose policy holds no stock: the one down first, else the selected one', () => {
  assert.equal(kitTarget(WAREHOUSE, 'AT76')?.icao, 'C208');
  assert.equal(kitTarget({ aog: null, policies: POLICIES }, 'C208')?.icao, 'C208');
  assert.equal(kitTarget({ aog: null, policies: POLICIES }, 'AT76'), null);
  assert.equal(kitTarget({ aog: null, policies: POLICIES }, null), null);
});

test('policy options are looked up by name, and an unknown one is empty rather than a crash', () => {
  assert.deepEqual(optionOf(POLICIES[0]!, 'full'), { policy: 'full', capital: 382_500, groundDays: 4 });
  assert.deepEqual(currentOption(POLICIES[3]!), { policy: 'none', capital: 0, groundDays: 11 });
  assert.deepEqual(optionOf({ options: [] }, 'critical'), { policy: 'critical', capital: 0, groundDays: 0 });
});

test('the Caravan kit: 18 400 tied up, 8 ground days a year avoided, worth 27 200 at 3 400 a day (the mockup)', () => {
  assert.deepEqual(kitFacts(POLICIES[3]!), { capital: 18_400, daysAvoided: 8, saved: 27_200 });
  assert.equal(kitFacts({ dayValue: 100, options: [{ policy: 'none', capital: 0, groundDays: 1 }, { policy: 'critical', capital: 5, groundDays: 4 }, { policy: 'full', capital: 9, groundDays: 2 }] }).daysAvoided, 0);
});

test('bars are scaled to the biggest full kit and the worst case, and follow the policy chosen', () => {
  const bars = policyBars(POLICIES);
  assert.equal(bars.get('AT76')!.capital, 1);
  assert.equal(bars.get('C208')!.capital, 0);
  assert.equal(bars.get('C208')!.ground, 11 / 14);
  assert.deepEqual(policyBars([]), new Map());
});

test('uncovered aircraft, parts and the worst type read straight off the answer', () => {
  assert.deepEqual(uncovered(WAREHOUSE), ['F-HAZF']);
  assert.equal(partCount(WAREHOUSE), 16);
  assert.deepEqual(worstType(WAREHOUSE), { name: 'Grand Caravan', days: 11 });
  assert.equal(worstType({ policies: [] }), null);
});

test('the shelf is grouped by class of parts in policy order, with its subtotal; a class with types and nothing on the shelf still has its group', () => {
  const g = stockGroups(WAREHOUSE);
  assert.deepEqual(g.map((x) => [x.cls, x.types.length, x.lines.length, x.subtotal]), [['regional', 1, 6, 382_500], ['jet', 2, 3, 65_000], ['turboprop', 1, 0, 0]]);
  assert.equal(g.reduce((s, x) => s + x.subtotal, 0), WAREHOUSE.capital);
  assert.equal(stockGroups({ policies: [], inventory: WAREHOUSE.inventory.slice(0, 1) })[0]!.cls, 'regional');
});

test('the AOG case on a ruler of whole UTC days: 3 days gone, the aircraft flying again after the delivery, the part-on-shelf track a few hours long', () => {
  const a = aogTimeline(AOG, NOW);
  assert.deepEqual(a.days.map((d) => new Date(d).getUTCDate()), [3, 4, 5, 6, 7]);
  assert.equal(a.elapsedDays, 3);
  assert.equal(a.plannedDays, 1);
  assert.equal(a.fixHours, 6);
  assert.equal(Math.round(a.lostDays * 10) / 10, 4.1);
  assert.ok(a.grounded.from < a.nowPct && a.grounded.to === a.nowPct);
  assert.ok(a.planned && a.planned.from === a.nowPct && a.planned.to > a.nowPct && a.planned.to <= 1);
  assert.ok(a.fixed.to - a.fixed.from < 0.06);
  assert.ok(a.etaPct > a.nowPct);
});

test('a part that is late keeps the ruler on and plans nothing', () => {
  const late = aogTimeline({ ...AOG, failedAt: NOW - 5 * 86_400_000, eta: NOW - 3_600_000, readyAt: NOW - 1_000, withPartBackAt: NOW - 5 * 86_400_000 + 6 * 3_600_000 }, NOW);
  assert.equal(late.planned, null);
  assert.equal(late.plannedDays, 0);
  assert.ok(late.grounded.to <= late.nowPct && late.nowPct > 0.9);
});

test('a breakdown with no day value still has its length in days', () => {
  assert.equal(aogTimeline({ ...AOG, dayValue: 0, lost: 0 }, NOW).lostDays, (AOG.readyAt - AOG.failedAt) / 86_400_000);
});

// ---------------------------------------------------------------- wear screen

test('amber from 75 % of wear: the mockup colours the engines (81) and the gear (76), not the propellers (64)', () => {
  assert.deepEqual([81, 76, 64, 70, 68, 58].map(wearTone), ['warn', 'warn', 'ok', 'ok', 'ok', 'ok']);
});

test('the player starts from the server\'s selection; leave-all and stepping stay inside leave / overhaul / replace', () => {
  assert.deepEqual(choicesOf(WEAR), { engines: 'leave', gear: 'overhaul', propellers: 'overhaul', avionics: 'overhaul', interior: 'overhaul', paint: 'leave' });
  assert.ok(Object.values(leaveAll(WEAR)).every((a) => a === 'leave'));
  assert.equal(stepChoice('leave', -1), 'leave');
  assert.equal(stepChoice('leave', 1), 'overhaul');
  assert.equal(stepChoice('replace', 1), 'replace');
});

test('the selection goes to the server as ?pick= and as the works to book; a component left is not a work', () => {
  assert.equal(pickOf(choicesOf(WEAR)), 'engines:leave,gear:overhaul,propellers:overhaul,avionics:overhaul,interior:overhaul,paint:leave');
  assert.deepEqual(itemsOf(choicesOf(WEAR)).map((i) => `${i.component}:${i.action}`), ['gear:overhaul', 'propellers:overhaul', 'avionics:overhaul', 'interior:overhaul']);
  assert.deepEqual(itemsOf(leaveAll(WEAR)), []);
  assert.equal(pickOf({}), '');
});

test('the mockup\'s scenarios: 151 100 handing back, 202 100 with the option, 261 600 earned before the return, 51 000 of parts left to the lessor', () => {
  assert.deepEqual(scenariosOf(WEAR.totals), { give: 151_100, buy: 202_100, gross: 261_600, kept: 51_000 });
});

test('a worn component\'s effect is told in the screen\'s words: the main loss, then fuel and passengers', () => {
  const [engines, gear, , , interior, paint] = WEAR.components;
  assert.deepEqual(effectLines(engines!.effects), { main: { kind: 'performance', value: 3 }, fuelPct: 3, loadPct: 0 });
  assert.deepEqual(effectLines(gear!.effects), { main: { kind: 'reliability', value: 2 }, fuelPct: 0, loadPct: 0 });
  assert.deepEqual(effectLines(interior!.effects), { main: { kind: 'satisfaction', value: 0.5 }, fuelPct: 0, loadPct: 4 });
  assert.deepEqual(effectLines(paint!.effects).main, { kind: 'satisfaction', value: 0.2 });
  assert.deepEqual(effectLines({ performance: 0, reliability: 0, satisfaction: 0, load: 0 }), { main: null, fuelPct: 0, loadPct: 0 });
});

test('the server\'s cash curve turns positive in month 11 and ends on the net', () => {
  assert.equal(WEAR.totals.cashCurve.length, 24);
  assert.equal(WEAR.totals.cashCurve.findIndex((x) => x >= 0) + 1, WEAR.totals.breakEvenMonth);
  assert.equal(WEAR.totals.cashCurve[23], WEAR.totals.give);
});

test('chart bars scale each side to its own extreme and leave a flat curve empty', () => {
  assert.deepEqual(chartBars([-10, -5, 0, 20]), [{ up: 0, down: 1 }, { up: 0, down: 0.5 }, { up: 0, down: 0 }, { up: 1, down: 0 }]);
  assert.deepEqual(chartBars([0, 0]), [{ up: 0, down: 0 }, { up: 0, down: 0 }]);
});

test('works under way end at the latest end among the components', () => {
  assert.equal(worksUntil(WEAR.components, NOW), null);
  const busy = WEAR.components.map((c, i) => (i < 2 ? { ...c, worksUntil: NOW + (i + 1) * 86_400_000 } : c));
  assert.equal(worksUntil(busy, NOW), NOW + 2 * 86_400_000);
  assert.equal(worksUntil(WEAR.components.map((c) => ({ ...c, worksUntil: NOW - 1 })), NOW), null);
});
