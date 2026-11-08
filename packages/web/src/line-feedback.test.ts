import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AircraftLine, ScheduledFlight } from '@opc/shared';
import { makeFormat } from './format.ts';
import { aircraftLive, liveLast, liveState, whenLabel } from './line-feedback.ts';
import { landedLegs } from './history.ts';

const D = (h: number, m = 0, day = 8): number => Date.UTC(2026, 10, day, h, m);
const leg = (o: Partial<ScheduledFlight> = {}): ScheduledFlight => ({
  id: 1, lineId: 3, flightNo: 'AUR 1101', dep: D(0), arr: D(1, 0), origin: 'RJTT', dest: 'RJFF', aircraftId: 7, status: 'scheduled', delayMin: 0, delayCause: null, cancelCause: null, pax: null, takenByPlayer: false, ...o,
});
const state = (o: Partial<AircraftLine> = {}): AircraftLine => ({ aircraftId: 7, location: 'RJTT', flying: null, next: null, last: null, ...o });
const NOW = D(23, 0, 7);

test('an aircraft in the air reads "in flight", with the real arrival time (the delay moves it)', () => {
  const live = aircraftLive(state({ location: 'RJFF', flying: leg({ status: 'flying', dep: D(0, 22), arr: D(1, 22), delayMin: 0 }) }))!;
  assert.deepEqual(live.state, { kind: 'flying', from: 'RJTT', to: 'RJFF', arrAt: D(1, 22) });
  assert.equal(liveState(live, D(0, 40, 8), 'en'), 'In flight RJTT → RJFF, arrives at 01:22Z');
  assert.equal(liveState(live, D(0, 40, 8), 'fr'), 'En vol RJTT → RJFF, arrivée à 01:22Z');
  const late = aircraftLive(state({ flying: leg({ status: 'flying', dep: D(0), arr: D(1), delayMin: 20 }) }))!;
  assert.equal(late.state.kind === 'flying' && late.state.arrAt, D(1, 20));
});

test('an aircraft on the ground says where it is and its next departure, the real time with the delay, and the day when it is not today', () => {
  const live = aircraftLive(state({ next: leg({ dep: D(0), delayMin: 0 }) }))!;
  assert.deepEqual(live.state, { kind: 'ground', at: 'RJTT', next: { flightNo: 'AUR 1101', depAt: D(0) } });
  assert.equal(liveState(live, D(23, 0, 7) + 1, 'fr'), 'Au sol à RJTT · prochain départ AUR 1101 le 8 nov. à 00:00Z');
  assert.equal(liveState(live, D(22, 0, 8), 'en'), 'On the ground at RJTT · next departure AUR 1101 at 00:00Z');
  assert.equal(liveState(aircraftLive(state({ next: leg({ dep: D(0), delayMin: 15 }) }))!, D(0, 5, 8), 'en'), 'On the ground at RJTT · next departure AUR 1101 at 00:15Z');
  assert.equal(liveState(aircraftLive(state())!, NOW, 'en'), 'On the ground at RJTT · no departure planned');
});

test('the last leg is reported with its signed net, and nothing before the first landing', () => {
  const live = aircraftLive(state({ last: { ...leg({ flightNo: 'AUR 1102', status: 'done' }), net: 19_210 } }))!;
  assert.equal(liveLast(live, 'en'), `Last flight AUR 1102 ${makeFormat('en').signedMoney(19_210)}`);
  assert.equal(liveLast(live, 'fr'), 'Dernier vol AUR 1102 +19\u00a0210\u00a0€');
  assert.equal(liveLast(aircraftLive(state())!), null);
  assert.equal(liveLast(aircraftLive(state({ last: { ...leg({ status: 'done' }), net: -450 } }))!, 'fr'), 'Dernier vol AUR 1101 \u2212450\u00a0€');
  assert.equal(aircraftLive(undefined), null, 'an aircraft that flies no line has no live state');
});

test('whenLabel: the time today, the date and time another day', () => {
  assert.equal(whenLabel(D(14, 5), D(9), 'en'), '14:05Z');
  assert.match(whenLabel(D(14, 5, 9), D(9), 'fr'), /^9 nov\. · 14:05Z$/);
});

test('the dashboard lists the last legs that landed: cancelled legs and legs still in the air are skipped', () => {
  const l = (id: number, status: 'done' | 'flying' | 'cancelled') => ({ at: D(id), cursor: `${D(id)}-1-${id}`, source: 'line' as const, leg: { ...leg({ id, status }), reg: 'JA0003', icao: 'B738', revenue: 1, fuelCost: 0, landingFee: 0, maintenance: 0, net: 1 } });
  const log = [l(20, 'flying'), l(19, 'done'), l(18, 'cancelled'), l(17, 'done'), l(16, 'done')];
  assert.deepEqual(landedLegs(log, 2).map((x) => x.id), [19, 17]);
  assert.deepEqual(landedLegs([], 4), []);
});
