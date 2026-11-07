import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURVE_MAX_H, INCIDENT_BASE_RISK, INCIDENT_COST, INCIDENT_REF_VALUE, REST_POLICIES, SEVERITY_SHARE, dutyFactor, drawIncident, incidentCost, incidentRisk, insuranceSurcharge,
  leverPoints, riskCurve, riskMultiple, roundScores, safetyIndex, safetyScores, severityOf, wearFactor,
  type IncidentKind, type Severity,
} from './index.ts';

test('incident risk: the check value of B.5 is 1.8 % at 13 h 15 of duty and 40 % wear, four times the average flight', () => {
  assert.equal(dutyFactor(8), 1);
  assert.ok(Math.abs(dutyFactor(13.25) - 4) < 1e-9);
  assert.ok(Math.abs(wearFactor(40) - 1) < 0.01);
  const risk = incidentRisk(13.25, 40);
  assert.ok(Math.abs(risk - 0.018) < 0.0002, `${risk}`);
  assert.equal(riskMultiple(risk), 4);
  assert.equal(riskMultiple(INCIDENT_BASE_RISK), 1);
  // more duty or more wear never lowers the risk, and a generous rest policy lowers it by its factor
  assert.ok(incidentRisk(10, 40) < incidentRisk(12, 40) && incidentRisk(10, 40) < incidentRisk(10, 70));
  assert.equal(incidentRisk(12, 50, REST_POLICIES.generous.riskFactor), incidentRisk(12, 50) * 0.7);
  assert.equal(incidentRisk(1000, 100), 1, 'a probability never exceeds 1');
});

test('the risk curve is the company\'s own: half-hour steps from 0 to 14 h, at the wear and rest policy given', () => {
  const c = riskCurve(63, 0.9);
  assert.equal(c.length, 29);
  assert.deepEqual([c[0]!.dutyHours, c.at(-1)!.dutyHours], [0, CURVE_MAX_H]);
  assert.equal(c[26]!.risk, incidentRisk(13, 63, 0.9));
});

test('a roll is seeded: the same draws always give the same incident, and the severity shares add up', () => {
  const seq = (...xs: number[]) => { let i = 0; return () => xs[i++]!; };
  assert.equal(drawIncident(0.01, seq(0.5)), null, 'above the risk: nothing happens');
  assert.deepEqual(drawIncident(0.01, seq(0.001, 0.1, 0.5, 0.25)), { severity: 'minor', kind: 'technical_delay', costUnit: 0.25 });
  assert.deepEqual(drawIncident(0.01, seq(0.001, 0.9, 0.99, 0)), { severity: 'serious', kind: 'engine_shutdown', costUnit: 0 });
  assert.deepEqual(drawIncident(0.01, seq(0.001, 0.99, 0.7, 0.5)), { severity: 'grave', kind: 'engine_failure', costUnit: 0.5 });
  assert.equal(Object.values(SEVERITY_SHARE).reduce((a, b) => a + b, 0), 1);
  assert.deepEqual([0, 0.69, 0.7, 0.94, 0.95, 0.999].map(severityOf), ['minor', 'minor', 'serious', 'serious', 'grave', 'grave'] satisfies Severity[]);
});

test('incident cost: inside the severity range for an airliner, in proportion for a cheaper aircraft, rounded to 50', () => {
  for (const s of ['minor', 'serious', 'grave'] as const) {
    const { min, max } = INCIDENT_COST[s];
    assert.equal(incidentCost(s, 0, INCIDENT_REF_VALUE), min);
    assert.ok(incidentCost(s, 0.999, 5_000_000) <= max && incidentCost(s, 0.999, 5_000_000) > max - 200);
  }
  assert.equal(incidentCost('grave', 0.37, 39_040) % 50, 0);
  assert.ok(incidentCost('grave', 0.5, 39_040) < 6_000, 'a 39 000 euro Cessna is not billed an airliner\'s repair');
});

test('insurance: the mockup\'s month (a grave, two at-fault minors, a bird strike) is +12 %, a bird strike alone changes nothing, the rise is capped', () => {
  const m = (severity: Severity, kind: IncidentKind) => ({ severity, kind });
  assert.equal(insuranceSurcharge([m('grave', 'runway_excursion'), m('minor', 'hard_landing'), m('minor', 'technical_delay'), m('minor', 'bird_strike')]), 0.12);
  assert.equal(insuranceSurcharge([m('minor', 'bird_strike'), m('minor', 'bird_strike')]), 0);
  assert.equal(insuranceSurcharge(Array.from({ length: 20 }, () => m('grave', 'engine_failure'))), 0.4);
  assert.equal(insuranceSurcharge([]), 0);
});

test('the safety index: the mockup\'s 27 + 29 + 16 = 72 comes out of a 38 % mean fatigue, a worn fleet and one rating to retake', () => {
  const inputs = { fatigues: [38, 38], wears: [30, 63], expiring: 1 };
  const p = roundScores(safetyScores(inputs));
  assert.deepEqual(p, { fatigue: 27, aircraft: 29, training: 16 });
  assert.equal(safetyIndex(p), 72);
  assert.equal(safetyIndex(roundScores(safetyScores({ fatigues: [], wears: [], expiring: 0 }))), 100, 'no crew, no aircraft: nothing lost');
  assert.equal(roundScores(safetyScores({ fatigues: [100], wears: [100], expiring: 9 })).training, 0, 'the training part never goes below zero');
});

test('a lever is worth the exact difference of the two indexes, to a tenth of a point', () => {
  const before = { fatigues: [38, 38], wears: [30, 63], expiring: 1 };
  const serviced = { ...before, wears: [30, 5] };
  const gain = leverPoints(before, serviced);
  assert.ok(gain > 0 && gain === Math.round(gain * 10) / 10);
  assert.equal(leverPoints(before, before), 0);
});
