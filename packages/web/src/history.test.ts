import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_PAY_FACTOR, REJECT_REPUTATION_PENALTY, type AircraftType, type Flight } from '@opc/shared';
import { NO_FILTER, filterFlights, manualEstimate, manualWaitMs, payFactor, seasonTotals, seasonsOf, statement, statusCounts } from './history.ts';

const D = (m: number, d: number, h = 12): number => Date.UTC(2026, m - 1, d, h);
const flight = (id: number, status: Flight['status'], at: number, o: Partial<Flight> = {}): Flight => ({
  id, companyId: 1, aircraftId: 1, aircraftIcao: 'C208', status, rejectReason: null, acceptedAt: at - 3_600_000, completedAt: status === 'active' ? null : at,
  revenue: 0, fuelCost: 0, landingFee: 0, maintenance: 0, net: 0, job: { id: 'j' + id, source: 'board', kind: 'pax', origin: 'LFMN', destination: 'LFLL', distanceNm: 165, payloadKg: 500, pax: 5, payout: 5000 }, ...o,
});
const type: AircraftType = { icao: 'C208', name: 'Caravan', category: 'turboprop-single', engines: 1, wtc: 'L', seats: 9, cargoKg: 1000, cruiseKts: 180, rangeNm: 900, derived: false };

const flights = [
  flight(1, 'verified', D(11, 4), { net: 1000, revenue: 2000 }), flight(2, 'unverified', D(11, 5), { net: 400, aircraftId: 2 }), flight(3, 'rejected', D(11, 6)),
  flight(4, 'verified', D(10, 30), { net: 700 }), flight(5, 'active', D(11, 7)), flight(6, 'cancelled', D(11, 3)),
];

test('the log lists closed flights only, newest first', () => {
  assert.deepEqual(filterFlights(flights, NO_FILTER).map((f) => f.id), [3, 2, 1, 6, 4]);
});

test('status, aircraft and season filters combine', () => {
  assert.deepEqual(filterFlights(flights, { ...NO_FILTER, status: 'verified' }).map((f) => f.id), [1, 4]);
  assert.deepEqual(filterFlights(flights, { ...NO_FILTER, season: '2026-11' }).map((f) => f.id), [3, 2, 1, 6]);
  assert.deepEqual(filterFlights(flights, { status: 'unverified', aircraftId: 2, season: '2026-11' }).map((f) => f.id), [2]);
  assert.deepEqual(filterFlights(flights, { ...NO_FILTER, aircraftId: 99 }), []);
});

test('status tab counts follow the other filters', () => {
  assert.deepEqual(statusCounts(flights, NO_FILTER), { all: 5, verified: 2, unverified: 1, rejected: 1, cancelled: 1 });
  assert.deepEqual(statusCounts(flights, { ...NO_FILTER, season: '2026-11' }), { all: 4, verified: 1, unverified: 1, rejected: 1, cancelled: 1 });
});

test('seasons are the months with closed flights, newest first', () => {
  assert.deepEqual(seasonsOf(flights), ['2026-11', '2026-10']);
});

test('season totals: net of paid flights; verified out of every flight that went through verification', () => {
  assert.deepEqual(seasonTotals(flights, '2026-11'), { net: 1400, flown: 3, verified: 1 });
  assert.deepEqual(seasonTotals(flights, '2026-09'), { net: 0, flown: 0, verified: 0 });
});

test('pay factor: full, reduced, none', () => {
  assert.equal(payFactor('verified'), 1);
  assert.equal(payFactor('unverified'), MANUAL_PAY_FACTOR);
  assert.equal(payFactor('rejected'), 0);
  assert.equal(payFactor('cancelled'), 0);
});

test('statement adds up and only a rejection has a known reputation change', () => {
  const s = statement(flight(1, 'verified', D(11, 4), { revenue: 5000, fuelCost: 900, landingFee: 40, maintenance: 300, net: 3760 }));
  assert.equal(s.charges, 1240);
  assert.equal(s.revenue - s.charges, s.net);
  assert.equal(s.reputation, null);
  assert.equal(statement(flight(3, 'rejected', D(11, 6))).reputation, -REJECT_REPUTATION_PENALTY);
});

test('manual estimate pays 60 % of the payout and charges the same costs as the server formula', () => {
  const e = manualEstimate(flight(1, 'active', D(11, 4)), type, 'large', false);
  assert.equal(e.revenue, 3000);
  assert.equal(e.net, e.revenue - e.fuelCost - e.landingFee - e.maintenance);
});

test('manual completion waits for the fastest believable flight time while anti-cheat is on', () => {
  const f = flight(1, 'active', D(11, 4), { acceptedAt: D(11, 4, 10) });
  const min = (165 / (180 * 1.25)) * 3_600_000;
  assert.equal(Math.round(manualWaitMs(f, type, D(11, 4, 10), true)), Math.round(min));
  assert.equal(manualWaitMs(f, type, D(11, 4, 10) + min + 1, true), 0);
  assert.equal(manualWaitMs(f, type, D(11, 4, 10), false), 0);
});
