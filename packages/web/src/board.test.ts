import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AircraftType, Job, Me } from '@opc/shared';
import { DEFAULT_FILTERS, boardRows, candidates, flyable, jobsAtIdleAirports, lookupJob, matchesFilters, nextBoardWave, remember } from './board.ts';

const type = (o: Partial<AircraftType> = {}): AircraftType => ({ icao: 'C208', name: 'Caravan', category: 'turboprop-single', engines: 1, wtc: 'L', seats: 9, cargoKg: 1000, cruiseKts: 180, rangeNm: 900, derived: false, ...o });
const plane = (id: number, location: string, busy = false, t = type()): Me['fleet'][number] => ({ id, icao: t.icao, type: t, location, busy, value: 1 });
const job = (id: string, origin: string, payout: number, o: Partial<Job> = {}): Job => ({ id, source: 'board', kind: 'pax', origin, destination: 'LFLL', distanceNm: 200, payloadKg: 500, pax: 5, payout, ...o });
const me = (fleet: Me['fleet']): Me => ({ fleet } as Me);

test('only jobs starting where an idle aircraft stands are listed', () => {
  const m = me([plane(1, 'LFMN'), plane(2, 'LFML', true)]);
  const out = jobsAtIdleAirports(m, { jobs: [job('a', 'LFMN', 100), job('b', 'LFML', 900), job('c', 'LFKJ', 900)], imported: [] });
  assert.deepEqual(out.map((j) => j.id), ['a']);
});

test('flyable jobs come first, then higher payout', () => {
  const m = me([plane(1, 'LFMN')]);
  const board = { jobs: [job('big', 'LFMN', 9000, { pax: 50 }), job('small-low', 'LFMN', 100), job('small-high', 'LFMN', 500)], imported: [] };
  assert.deepEqual(jobsAtIdleAirports(m, board).map((j) => j.id), ['small-high', 'small-low', 'big']);
});

test('an aircraft is a candidate only when idle, at the origin and able to fly the job', () => {
  const m = me([plane(1, 'LFMN'), plane(2, 'LFMN', true), plane(3, 'LFML'), plane(4, 'LFMN', false, type({ icao: 'C172', seats: 3 }))]);
  const j = job('a', 'LFMN', 100, { pax: 5 });
  assert.deepEqual(candidates(m, j).map((a) => a.id), [1]);
  assert.equal(flyable(m, j), true);
  assert.equal(flyable(m, job('b', 'LFKJ', 100)), false);
});

test('a job requiring another type is not flyable', () => {
  assert.equal(flyable(me([plane(1, 'LFMN')]), job('a', 'LFMN', 100, { requiredAircraft: 'AT76' })), false);
});

test('a job that left the board is still found from an earlier load, marked as no longer open', () => {
  const gone = job('LFMN-9-1', 'LFMN', 500);
  remember({ jobs: [gone], imported: [] });
  const now = { jobs: [job('LFMN-9-2', 'LFMN', 100)], imported: [] };
  assert.deepEqual(lookupJob(now, 'LFMN-9-1'), { job: gone, open: false });
  assert.equal(lookupJob(now, 'LFMN-9-2')?.open, true);
  assert.equal(lookupJob(now, 'nope'), null);
});

test('the next board wave is the next 6-hour UTC boundary', () => {
  assert.equal(nextBoardWave(Date.UTC(2026, 10, 5, 17, 42)), Date.UTC(2026, 10, 5, 18, 0));
  assert.equal(nextBoardWave(Date.UTC(2026, 10, 5, 18, 0)), Date.UTC(2026, 10, 6, 0, 0));
});

test('filters combine; the kind segment can be ignored to count the other segments', () => {
  const m = me([plane(1, 'LFMN')]);
  const f = { ...DEFAULT_FILTERS, kind: 'cargo' as const, distance: 'mid' as const, gain: '3000' as const };
  const cargo = job('c', 'LFMN', 5000, { kind: 'cargo', pax: 0, payloadKg: 400, distanceNm: 300 });
  const pax = job('p', 'LFMN', 5000, { distanceNm: 300 });
  assert.equal(matchesFilters(m, cargo, f), true);
  assert.equal(matchesFilters(m, pax, f), false);
  assert.equal(matchesFilters(m, pax, f, true), true);
  assert.equal(matchesFilters(m, { ...cargo, payout: 2999 }, f), false);
  assert.equal(matchesFilters(m, { ...cargo, distanceNm: 500 }, f), false);
  assert.equal(matchesFilters(m, { ...cargo, origin: 'LFML' }, { ...f, from: 'LFMN' }), false);
});

test('"my fleet" hides jobs no idle aircraft can fly; turning it off shows them', () => {
  const m = me([plane(1, 'LFMN')]);
  const far = job('far', 'LFMN', 100, { distanceNm: 5000 });
  assert.equal(matchesFilters(m, far, DEFAULT_FILTERS), false);
  assert.equal(matchesFilters(m, far, { ...DEFAULT_FILTERS, fleetOnly: false }), true);
});

test('board rows: SimBrief imports first, then flyable, then payout', () => {
  const m = me([plane(1, 'LFMN')]);
  const rows = boardRows(m, { jobs: [job('low', 'LFMN', 1), job('high', 'LFMN', 9), job('far', 'LFMN', 99, { distanceNm: 5000 })], imported: [job('sb', 'LFMN', 0, { source: 'simbrief' })] });
  assert.deepEqual(rows.map((j) => j.id), ['sb', 'high', 'low', 'far']);
});
