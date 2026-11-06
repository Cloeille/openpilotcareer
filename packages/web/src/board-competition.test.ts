import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AircraftType, Job } from '@opc/shared';
import { aiCanTake } from './board.ts';

const t = (o: Partial<AircraftType> = {}): AircraftType => ({ icao: 'AT76', name: 'ATR 72', category: 'turboprop-airliner', engines: 2, wtc: 'M', seats: 70, cargoKg: 2000, cruiseKts: 270, rangeNm: 800, derived: false, ...o });
const job = (o: Partial<Job> = {}): Job => ({ id: 'j', source: 'board', kind: 'pax', origin: 'LFMN', destination: 'LIRF', distanceNm: 254, payloadKg: 4600, pax: 46, payout: 11380, ...o });
const types = new Map([['AT76', t()], ['C172', t({ icao: 'C172', seats: 3, rangeNm: 500 })]]);

test('an AI company based at the origin with a fitting type could take the job', () => {
  assert.equal(aiCanTake({ hubs: ['LFMN'], fleet: [{ icao: 'AT76', count: 1 }] }, types, job()), true);
});

test('not based at the origin, or no fitting type, or unknown type: not contested', () => {
  assert.equal(aiCanTake({ hubs: ['EGLL'], fleet: [{ icao: 'AT76', count: 1 }] }, types, job()), false);
  assert.equal(aiCanTake({ hubs: ['LFMN'], fleet: [{ icao: 'C172', count: 3 }] }, types, job()), false);
  assert.equal(aiCanTake({ hubs: ['LFMN'], fleet: [{ icao: 'ZZZZ', count: 1 }] }, types, job()), false);
});
