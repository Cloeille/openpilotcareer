import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AircraftType, Job, Me } from '@opc/shared';
import { candidates, flyable, jobsAtIdleAirports } from './board.ts';

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
