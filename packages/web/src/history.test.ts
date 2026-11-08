import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_PAY_FACTOR, REJECT_REPUTATION_PENALTY, type AircraftType, type Flight, type HistoryEntry, type LineLeg } from '@opc/shared';
import { NO_FILTER, filterEntries, flightNeighbours, manualEstimate, manualWaitMs, payFactor, rowOf, seasonTotals, seasonsOf, statement, statementCsv, statusCounts, tabsOf } from './history.ts';

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
const leg = (id: number, at: number, o: Partial<LineLeg> = {}): LineLeg => ({
  id, lineId: 9, flightNo: `AZR ${1100 + id}`, dep: at, arr: at + 3_600_000, origin: 'LFPG', dest: 'LFLL', aircraftId: 7, status: 'done', delayMin: 0, delayCause: null, cancelCause: null, pax: 40, takenByPlayer: false,
  reg: 'F-HAZA', icao: 'AT76', revenue: 5000, fuelCost: 1200, landingFee: 300, maintenance: 100, net: 3400, ...o,
});
const flownEntry = (f: Flight): HistoryEntry => ({ at: f.completedAt ?? f.acceptedAt, cursor: `${f.completedAt ?? f.acceptedAt}-0-${f.id}`, source: 'flown', flight: f });
const lineEntry = (l: LineLeg): HistoryEntry => ({ at: l.dep, cursor: `${l.dep}-1-${l.id}`, source: 'line', leg: l });
// the server's log: closed flights and legs that left, newest first
const log: HistoryEntry[] = [
  lineEntry(leg(21, D(11, 6, 15))), flownEntry(flights[2]!), lineEntry(leg(20, D(11, 6, 9), { delayMin: 12 })), flownEntry(flights[1]!), lineEntry(leg(19, D(11, 4, 18), { status: 'cancelled', cancelCause: 'no_crew', net: 0, revenue: 0, fuelCost: 0, landingFee: 0, maintenance: 0, pax: null })),
  flownEntry(flights[0]!), flownEntry(flights[5]!), flownEntry(flights[3]!), lineEntry(leg(18, D(10, 29), { status: 'flying', aircraftId: 8 })),
];
const ids = (es: HistoryEntry[]): string[] => es.map((e) => (e.source === 'flown' ? `f${e.flight.id}` : `l${e.leg.id}`));

test('the log keeps the server order, and the source, status, aircraft and season filters combine over both sources', () => {
  assert.deepEqual(ids(filterEntries(log, NO_FILTER)), ['l21', 'f3', 'l20', 'f2', 'l19', 'f1', 'f6', 'f4', 'l18']);
  assert.deepEqual(ids(filterEntries(log, { ...NO_FILTER, source: 'lines' })), ['l21', 'l20', 'l19', 'l18']);
  assert.deepEqual(ids(filterEntries(log, { ...NO_FILTER, source: 'flown' })), ['f3', 'f2', 'f1', 'f6', 'f4']);
  assert.deepEqual(ids(filterEntries(log, { ...NO_FILTER, status: 'verified' })), ['f1', 'f4']);
  assert.deepEqual(ids(filterEntries(log, { ...NO_FILTER, status: 'done' })), ['l21', 'l20', 'l18']);
  assert.deepEqual(ids(filterEntries(log, { ...NO_FILTER, status: 'cancelled' })), ['l19', 'f6']);
  assert.deepEqual(ids(filterEntries(log, { ...NO_FILTER, season: '2026-11' })), ['l21', 'f3', 'l20', 'f2', 'l19', 'f1', 'f6']);
  assert.deepEqual(ids(filterEntries(log, { source: 'all', status: 'all', aircraftId: 7, season: '2026-11' })), ['l21', 'l20', 'l19']);
  assert.deepEqual(ids(filterEntries(log, { ...NO_FILTER, aircraftId: 2 })), ['f2']);
  assert.deepEqual(filterEntries(log, { ...NO_FILTER, aircraftId: 99 }), []);
});

test('status tab counts follow the other filters, and a tab that cannot match the source is not offered', () => {
  assert.deepEqual(statusCounts(log, NO_FILTER), { all: 9, verified: 2, unverified: 1, rejected: 1, done: 3, cancelled: 2 });
  assert.deepEqual(statusCounts(log, { ...NO_FILTER, source: 'lines' }), { all: 4, verified: 0, unverified: 0, rejected: 0, done: 3, cancelled: 1 });
  assert.deepEqual(statusCounts(log, { ...NO_FILTER, season: '2026-11' }), { all: 7, verified: 1, unverified: 1, rejected: 1, done: 2, cancelled: 2 });
  assert.deepEqual(tabsOf('all'), ['all', 'verified', 'unverified', 'rejected', 'done', 'cancelled']);
  assert.deepEqual(tabsOf('lines'), ['all', 'done', 'cancelled']);
  assert.deepEqual(tabsOf('flown'), ['all', 'verified', 'unverified', 'rejected', 'cancelled']);
});

test('seasons are the months with an entry of either source, newest first', () => {
  assert.deepEqual(seasonsOf(log), ['2026-11', '2026-10']);
  assert.deepEqual(seasonsOf(log.filter((e) => e.source === 'line' && e.leg.id === 18)), ['2026-10']);
});

test('season totals: the net counts both sources and says which is which; legs and verified flights are counted apart', () => {
  assert.deepEqual(seasonTotals(log, '2026-11'), { net: 1400 + 3400 + 3400, flownNet: 1400, linesNet: 6800, flown: 3, verified: 1, legs: 2, cancelledLegs: 1 });
  assert.deepEqual(seasonTotals(log, '2026-10'), { net: 700 + 3400, flownNet: 700, linesNet: 3400, flown: 1, verified: 1, legs: 1, cancelledLegs: 0 });
  assert.deepEqual(seasonTotals(log, '2026-09'), { net: 0, flownNet: 0, linesNet: 0, flown: 0, verified: 0, legs: 0, cancelledLegs: 0 });
});

test('a line leg row carries its flight number, money and state, and leads to its line; a flown flight leads to its page', () => {
  const regOf = (id: number): string | null => (id === 1 ? 'F-GXYZ' : null);
  const done = rowOf(log[0]!, regOf);
  assert.equal(done.source, 'line');
  assert.equal(done.net, 3400);
  assert.equal(done.href, '#line/9');
  assert.deepEqual(done.source === 'line' && [done.flightNo, done.pax, done.revenue, done.costs, done.state, done.reg, done.icao], ['AZR 1121', 40, 5000, 1600, { kind: 'done' }, 'F-HAZA', 'AT76']);
  assert.deepEqual(rowOf(log[2]!, regOf).source === 'line' && (rowOf(log[2]!, regOf) as { state: unknown }).state, { kind: 'late', delayMin: 12 });
  const cancelled = rowOf(log[4]!, regOf);
  assert.equal(cancelled.net, null, 'a cancelled leg earned nothing');
  assert.deepEqual(cancelled.source === 'line' && cancelled.state, { kind: 'cancelled', cause: 'no_crew' });
  assert.deepEqual(rowOf(log[8]!, regOf).source === 'line' && (rowOf(log[8]!, regOf) as { state: unknown }).state, { kind: 'flying' });
  const flown = rowOf(log[5]!, regOf);
  assert.deepEqual([flown.source, flown.net, flown.href, flown.reg, flown.origin, flown.dest], ['flown', 1000, '#flight/1', 'F-GXYZ', 'LFMN', 'LFLL']);
  assert.equal(rowOf(log[1]!, regOf).net, null, 'a rejected flight earned nothing');
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

test('the neighbours of a flight are the closed flights either side of it in the log, none at the ends or for an unknown flight', () => {
  const near = (id: number) => { const n = flightNeighbours(flights, id); return [n.older?.id ?? null, n.newer?.id ?? null]; };
  assert.deepEqual(near(2), [1, 3]);
  assert.deepEqual(near(3), [2, null]);
  assert.deepEqual(near(4), [null, 6]);
  assert.deepEqual(near(5), [null, null]);
  assert.deepEqual(near(99), [null, null]);
});

test('the statement exports as CSV: costs negative, a rejected flight pays nothing', () => {
  const paid = flight(1, 'verified', D(11, 4), { revenue: 5000, fuelCost: 900, landingFee: 40, maintenance: 300, net: 3760, job: { ...flights[0]!.job, payout: 5000 } });
  assert.equal(statementCsv(paid), 'item,amount\r\npayout,5000\r\ncoefficient,1\r\nrevenue,5000\r\nfuel,-900\r\nlanding_fee,-40\r\nmaintenance,-300\r\nnet,3760\r\n');
  assert.match(statementCsv(flight(3, 'rejected', D(11, 6))), /\ncoefficient,0\r\n/);
});
