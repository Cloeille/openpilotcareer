import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CashMonth, ForecastPoint, ProfitRow, ScenarioSummary } from '@opc/shared';
import {
  PLOT, bandOf, barScale, breakdownRows, chartMonths, compact, defaultMonth, factorPct, monthName, overdraftHeadline, pathOf, periodRange, positiveStreak, profitGroups, profitMonth, profitName, scaleOf, sideOf, stepMonth, stepScenario,
} from './reports-view.ts';

const month = (m: string, o: Partial<CashMonth> = {}): CashMonth => ({ month: m, closed: true, revenue: 100, spend: 60, other: 0, net: 40, netVsPrevious: null, endBalance: 40, byCategory: [], ...o });
const row = (o: Partial<ProfitRow> = {}): ProfitRow => ({ by: 'line', id: 1, a: 'LFLL', b: 'LFMN', aircraft: ['F-HAZB'], flights: 10, revenue: 100, costs: 60, margin: 40, marginPct: 0.4, breakdown: { crew: 20, fuel: 25, fees: 10, maintenance: 5, service: 0, fixed: 0 }, ...o } as ProfitRow);

test('the cash screen opens on the last closed month, else the one in progress, and steps without leaving the list', () => {
  const ms = [month('2026-09'), month('2026-10'), month('2026-11', { closed: false })];
  assert.equal(defaultMonth(ms), '2026-10');
  assert.equal(defaultMonth([month('2026-11', { closed: false })]), '2026-11');
  assert.equal(defaultMonth([]), null);
  assert.equal(stepMonth(ms, '2026-10', 1), '2026-11');
  assert.equal(stepMonth(ms, '2026-11', 1), '2026-11', 'stops at the newest');
  assert.equal(stepMonth(ms, '2026-09', -1), '2026-09', 'stops at the oldest');
  assert.equal(stepMonth(ms, null, -1), '2026-10', 'from nothing, the newest is the start');
  assert.equal(stepMonth([], null, 1), null);
});

test('the chart draws the last twelve months; bars scale to the tallest and never leave 0..1', () => {
  const many = Array.from({ length: 20 }, (_, i) => month(`2026-${String(i + 1).padStart(2, '0')}`));
  assert.equal(chartMonths(many).length, 12);
  assert.equal(chartMonths(many)[0]!.month, '2026-09');
  const scale = barScale([month('a', { revenue: 200, spend: 50 }), month('b', { revenue: 100, spend: 400 })]);
  assert.deepEqual([scale(400), scale(200), scale(100), scale(-5), scale(900)], [1, 0.5, 0.25, 0, 1]);
  assert.equal(barScale([])(10), 0, 'an empty chart has no height to divide by');
});

test('"positive for N months" counts the closed months in the black, newest first, and stops at the first loss', () => {
  const ms = [month('2026-06', { net: -5 }), month('2026-07'), month('2026-08'), month('2026-09'), month('2026-10', { closed: false, net: -999 })];
  assert.equal(positiveStreak(ms), 3, 'the month in progress does not count');
  assert.equal(positiveStreak([month('2026-06'), month('2026-07', { net: -1 })]), 0);
  assert.equal(positiveStreak([]), 0);
});

test('a month side lists its categories biggest first with shares that add up to one', () => {
  const m = month('2026-10', { byCategory: [{ category: 'jobs', in: 20, out: 0 }, { category: 'tickets', in: 80, out: 0 }, { category: 'fuel', in: 0, out: 30 }, { category: 'service', in: 5, out: 5 }] });
  const ins = sideOf(m, 'in');
  assert.deepEqual(ins.map((r) => r.category), ['tickets', 'jobs', 'service']);
  assert.ok(Math.abs(ins.reduce((t, r) => t + r.share, 0) - 1) < 1e-9);
  assert.deepEqual(sideOf(m, 'out').map((r) => [r.category, r.amount]), [['fuel', 30], ['service', 5]]);
  assert.deepEqual(sideOf(null, 'in'), []);
});

test('month names are the language\'s own, in UTC', () => {
  assert.equal(monthName('2026-10', 'fr-FR'), 'octobre 2026');
  assert.equal(monthName('2026-10', 'en-GB', false), 'October');
  assert.equal(compact(-541_000, 'en-GB'), '\u2212541k');
});

test('profitability steps month by month, never past the current month nor more than a year back', () => {
  assert.equal(profitMonth('2026-10', 1, '2026-11'), '2026-11');
  assert.equal(profitMonth('2026-11', 1, '2026-11'), '2026-11');
  assert.equal(profitMonth('2026-01', -1, '2026-11'), '2025-12');
  assert.equal(profitMonth('2025-11', -1, '2026-11'), '2025-11', 'a year back is the floor');
  assert.equal(profitMonth('2026-01', -1, '2026-01'), '2025-12');
});

test('profitability splits winners and losers in the server\'s order and names rows by what they are', () => {
  const rows = [row({ id: 1, margin: 40 }), row({ id: 2, margin: 0 }), row({ id: 3, margin: -5 }), row({ id: 4, margin: -90 })];
  assert.deepEqual(profitGroups(rows).profitable.map((r) => r.id), [1, 2], 'break-even is not a loss');
  assert.deepEqual(profitGroups(rows).losing.map((r) => r.id), [3, 4]);
  assert.equal(profitName(row()), 'LFLL – LFMN');
  assert.equal(profitName({ by: 'aircraft', id: 7, registration: 'F-HAZB', icao: 'AT76', lines: [], flights: 0, revenue: 0, costs: 0, margin: 0, marginPct: null, breakdown: row().breakdown }), 'F-HAZB');
});

test('a cost breakdown shows only what costs something, biggest first, with shares of the costs', () => {
  const rows = breakdownRows(row().breakdown);
  assert.deepEqual(rows.map((r) => r.part), ['fuel', 'crew', 'fees', 'maintenance']);
  assert.ok(Math.abs(rows.reduce((t, r) => t + r.share, 0) - 1) < 1e-9);
  assert.deepEqual(breakdownRows({ crew: 0, fuel: 0, fees: 0, maintenance: 0, service: 0, fixed: 0 }), []);
});

test('the statement periods are UTC days, both ends included', () => {
  const now = Date.UTC(2026, 10, 6, 17, 52);
  assert.deepEqual(periodRange('week', now), { from: '2026-10-31', to: '2026-11-06' });
  assert.deepEqual(periodRange('month', now), { from: '2026-11-01', to: '2026-11-06' });
  assert.deepEqual(periodRange('previous', now), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(periodRange('previous', Date.UTC(2026, 0, 15)), { from: '2025-12-01', to: '2025-12-31' });
});

const pts = (v: number[][]): ForecastPoint[] => v.map(([prudent, central, optimistic], i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, prudent: prudent!, central: central!, optimistic: optimistic! }));

test('the forecast chart keeps zero in view, maps higher balances higher and months evenly', () => {
  const p = pts([[100, 200, 300], [-50, 100, 400], [0, 300, 500]]);
  const s = scaleOf(p);
  assert.ok(s.ticks.includes(0) && s.ticks[0]! <= -50 && s.ticks.at(-1)! >= 500);
  assert.ok(s.y(500) < s.y(0) && s.y(0) < s.y(-50), 'SVG y grows downwards');
  assert.equal(s.zero, s.y(0));
  assert.ok(Math.abs(s.x(1) - (s.x(0) + s.x(2)) / 2) < 1e-9);
  assert.ok(s.x(0) >= PLOT.left && s.x(2) <= PLOT.width - PLOT.right);
  assert.ok(scaleOf(pts([[5, 5, 5]])).x(0) > PLOT.left, 'one month sits in the middle');
  const flat = scaleOf(pts([[0, 0, 0], [0, 0, 0]]));
  assert.ok(Number.isFinite(flat.y(0)), 'an all-zero forecast does not divide by zero');
  const withTrial = scaleOf(p, [-900]);
  assert.ok(withTrial.ticks[0]! <= -900, 'a tried decision that goes lower still fits');
});

test('curves are polylines through the points and the band is a closed shape between two scenarios', () => {
  const p = pts([[1, 2, 3], [4, 5, 6]]);
  const s = { x: (i: number) => i * 10, y: (v: number) => 100 - v };
  assert.equal(pathOf(p, (x) => x.central, s), 'M0.0 98.0 L10.0 95.0');
  assert.equal(bandOf(p, (x) => x.prudent, (x) => x.optimistic, s), 'M0.0 97.0 L10.0 94.0 L10.0 96.0 L0.0 99.0 Z');
  assert.equal(bandOf([], (x) => x.prudent, (x) => x.optimistic, s), '');
});

test('the forecast headline names the worst scenario that goes below zero, or nothing', () => {
  const s = (days: number): ScenarioSummary => ({ lowest: { balance: 0, at: 0 }, end: 0, overdraft: { days, from: days ? 10 : null, to: days ? 20 : null } });
  assert.deepEqual(overdraftHeadline({ prudent: s(44), central: s(0), optimistic: s(0) }), { scenario: 'prudent', days: 44, from: 10, to: 20 });
  assert.equal(overdraftHeadline({ prudent: s(0), central: s(3), optimistic: s(0) })!.scenario, 'central');
  assert.equal(overdraftHeadline({ prudent: s(0), central: s(0), optimistic: s(0) }), null);
});

test('scenarios step prudent, central, optimistic and stop at the ends; factors read as signed percents', () => {
  assert.equal(stepScenario('central', -1), 'prudent');
  assert.equal(stepScenario('prudent', -1), 'prudent');
  assert.equal(stepScenario('central', 1), 'optimistic');
  assert.equal(stepScenario('optimistic', 1), 'optimistic');
  assert.deepEqual([factorPct(0.92), factorPct(1.12), factorPct(1)], ['\u22128\u00a0%', '+12\u00a0%', '0\u00a0%']);
});
