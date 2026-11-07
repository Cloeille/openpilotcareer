import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Incident, SafetyView, TodayFlight } from './api-safety.ts';
import {
  CHART, chartOf, headline, incidentFacts, leverHash, leversTotal, newestFirst, overDutyLimit, pathOf, pointsLost, recentSeasons, registrationOf, scoreFill, scoreTone, seasonTotals, stepSeason,
} from './safety-view.ts';

/** The mockup's numbers: 72 = 27 + 29 + 16, 1.8 % at 13 h 15 for a 4x factor, three levers worth 3 + 4 + 3. */
const flight1138: TodayFlight = { flightNo: 'AZR 1138', crew: 'Lefèvre', risk: 0.018, factor: 4, dutyHours: 13.25 };
const calm: TodayFlight = { flightNo: 'AZR 1140', crew: 'Perrin', risk: 0.0045, factor: 1, dutyHours: 6 };
const curve = [0, 2, 4, 6, 8, 10, 12, 14].map((dutyHours) => ({ dutyHours, risk: 0.0045 * (dutyHours <= 8 ? 1 : 1 + 3 * ((dutyHours - 8) / 5.25) ** 2) }));
const view = (o: Partial<SafetyView> = {}): SafetyView => ({
  index: 72, delta7d: -6,
  parts: { fatigue: { points: 27, max: 40 }, aircraft: { points: 29, max: 40 }, training: { points: 16, max: 20 } },
  riskCurve: curve, today: [flight1138, calm],
  levers: [
    { label: 'AZR 1138', detail: '', points: 3, action: 'crew', ref: '7' },
    { label: 'F-HAZC', detail: '', points: 4, action: 'maintenance', ref: '12' },
    { label: 'Congés', detail: '', points: 3, action: 'leave', ref: '' },
  ],
  season: { total: 157_100, covered: 17_400, borne: 139_700, insuranceFrom: '2026-12', insuranceDelta: 0.12 },
  ...o,
});
const incident = (o: Partial<Incident> = {}): Incident => ({
  id: 1, at: Date.UTC(2026, 10, 3, 14), flightId: 5, aircraftId: 12, severity: 'minor', kind: 'hard_landing', title: 'Atterrissage dur', detail: '', cost: 18_400, covered: 0, downtimeUntil: Date.UTC(2026, 10, 5, 14), reputationDelta: 0, ...o,
});

test('a part is amber under 70 % of its maximum (the mockup: fatigue 27/40 amber, aircraft 29/40 and training 16/20 not)', () => {
  const p = view().parts;
  assert.equal(scoreTone(p.fatigue), 'warn');
  assert.equal(scoreTone(p.aircraft), 'ok');
  assert.equal(scoreTone(p.training), 'ok');
  assert.equal(pointsLost(p.fatigue), 13);
  assert.equal(scoreFill(p.fatigue), 27 / 40);
  assert.equal(scoreFill({ points: 50, max: 40 }), 1);
  assert.equal(scoreFill({ points: 5, max: 0 }), 0);
});

test('the status line: risky flights tonight first, then the 7-day move, then steady', () => {
  assert.deepEqual(headline(view()), { kind: 'risky', n: 1, tone: 'warn' });
  assert.deepEqual(headline(view({ today: [calm] })), { kind: 'down', n: 6, tone: 'warn' });
  assert.deepEqual(headline(view({ today: [], delta7d: 2.4 })), { kind: 'up', n: 2, tone: 'ok' });
  assert.deepEqual(headline(view({ today: [], delta7d: 0.2 })), { kind: 'steady', n: 0, tone: 'ok' });
});

test('past 13 h of duty is over the limit; a flight without duty hours never is', () => {
  assert.equal(overDutyLimit({ dutyHours: 13.25 }), true);
  assert.equal(overDutyLimit({ dutyHours: 13 }), false);
  assert.equal(overDutyLimit({}), false);
});

test('the chart grows its axes to the data and keeps the mockup frame as the floor', () => {
  const c = chartOf(view());
  assert.equal(c.xMax, 14);
  assert.equal(c.yMaxPct, 4);
  assert.deepEqual(c.xTicks.map((x) => x.hours), [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.deepEqual(c.yTicks.map((y) => y.pct), [0, 1, 2, 3, 4]);
  assert.equal(c.xTicks[0]!.x, CHART.left);
  assert.equal(c.xTicks.at(-1)!.x, CHART.right);
  assert.equal(c.yTicks[0]!.y, CHART.bottom);
  assert.equal(c.yTicks.at(-1)!.y, CHART.top);
  // the curve rises with the hours and ends on the right edge
  assert.equal(c.curve.length, 8);
  assert.ok(c.curve.every((p, i) => i === 0 || p.y <= c.curve[i - 1]!.y));
  assert.equal(c.curve.at(-1)!.x, CHART.right);
  // the limit sits at 13 h of 14
  assert.ok(Math.abs(c.limitX - (CHART.left + (13 / 14) * (CHART.right - CHART.left))) < 1e-9);
});

test('the flight at most risk is the one annotated, and sits past the limit line when its duty is over 13 h', () => {
  const c = chartOf(view());
  assert.equal(c.flights.length, 2);
  assert.equal(c.top?.flight.flightNo, 'AZR 1138');
  assert.equal(c.top?.over, true);
  assert.ok(c.top!.x > c.limitX);
  assert.equal(chartOf(view({ today: [calm] })).top, null);
  assert.equal(chartOf(view({ today: [{ ...flight1138, dutyHours: undefined }] })).flights.length, 0);
});

test('axes stretch for a risk or a duty beyond the floor, and ignore non-finite points', () => {
  const c = chartOf(view({ riskCurve: [{ dutyHours: 0, risk: 0.01 }, { dutyHours: 16.5, risk: 0.093 }, { dutyHours: Number.NaN, risk: 0.5 }], today: [] }));
  assert.equal(c.xMax, 18);
  assert.equal(c.yMaxPct, 10);
  assert.equal(c.curve.length, 2);
  assert.equal(chartOf(view({ riskCurve: [], today: [] })).curve.length, 0);
});

test('pathOf draws a polyline and nothing for fewer than two points', () => {
  assert.equal(pathOf([{ x: 1, y: 2 }]), '');
  assert.equal(pathOf([{ x: 1, y: 2 }, { x: 3.25, y: 4 }]), 'M1.0 2.0 L3.3 4.0');
});

test('levers lead to the staff sheet, the leave planner or the fleet', () => {
  assert.equal(leverHash({ action: 'crew', ref: '7' }), '#staff/7');
  assert.equal(leverHash({ action: 'leave', ref: '' }), '#staff/leave');
  assert.equal(leverHash({ action: 'maintenance', ref: '12' }), '#wear/12');
});

test('"up to +10 points" is the sum of the levers, never past 100', () => {
  assert.equal(leversTotal(view().levers, 72), 10);
  assert.equal(leversTotal(view().levers, 95), 5);
  assert.equal(leversTotal([{ points: -2 }, { points: 3 }], 50), 3);
  assert.equal(leversTotal([], 50), 0);
});

test('incident facts: insured share, downtime in whole days, a grave one with no end is grounded', () => {
  assert.deepEqual(incidentFacts(incident()), { cost: 18_400, covered: 0, insured: 'none', downtimeDays: 2, grounded: false, reputation: 0 });
  assert.equal(incidentFacts(incident({ cost: 5_000, covered: 5_000 })).insured, 'all');
  assert.equal(incidentFacts(incident({ cost: 5_000, covered: 1_000 })).insured, 'part');
  const grave = incidentFacts(incident({ severity: 'grave', downtimeUntil: null, reputationDelta: -6 }));
  assert.equal(grave.grounded, true);
  assert.equal(grave.downtimeDays, null);
  assert.equal(grave.reputation, -6);
  assert.equal(incidentFacts(incident({ downtimeUntil: null })).grounded, false);
  assert.equal(incidentFacts(incident({ downtimeUntil: Date.UTC(2026, 10, 3, 14, 1) })).downtimeDays, 1);
});

test('the journal is newest first and its totals add up (borne = total - covered; covered never above the cost)', () => {
  const a = incident({ id: 1, at: 100, cost: 10_000, covered: 0 });
  const b = incident({ id: 2, at: 300, cost: 5_000, covered: 5_000 });
  const c = incident({ id: 3, at: 300, cost: 1_000, covered: 9_999 });
  assert.deepEqual(newestFirst([a, b, c]).map((i) => i.id), [3, 2, 1]);
  assert.deepEqual(seasonTotals([a, b, c]), { total: 16_000, covered: 6_000, borne: 10_000 });
  assert.deepEqual(seasonTotals([]), { total: 0, covered: 0, borne: 0 });
});

test('a registration the company no longer has reads as its id', () => {
  assert.equal(registrationOf([{ id: 12, registration: 'F-HAZC' }], 12), 'F-HAZC');
  assert.equal(registrationOf([{ id: 12, registration: 'F-HAZC' }], 99), '#99');
});

test('season chips are the last six UTC months, oldest first, across a year end; arrows stop at the ends', () => {
  const chips = recentSeasons(Date.UTC(2026, 1, 10));
  assert.deepEqual(chips, ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(stepSeason(chips, '2026-01', 1), '2026-02');
  assert.equal(stepSeason(chips, '2026-02', 1), '2026-02');
  assert.equal(stepSeason(chips, '2025-09', -1), '2025-09');
  assert.equal(stepSeason(chips, 'unknown', 1), '2025-09');
});
