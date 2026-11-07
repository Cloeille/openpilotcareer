import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AircraftType, Job, Me } from '@opc/shared';
import { noAircraftReason, planeLabel, type Distance } from './board.ts';

const type = (o: Partial<AircraftType> = {}): AircraftType => ({ icao: 'A35K', name: 'A350-1000', category: 'jet-widebody', engines: 2, wtc: 'H', seats: 410, cargoKg: 20000, cruiseKts: 490, rangeNm: 8700, derived: false, ...o });
const plane = (id: number, location: string, o: { type?: AircraftType; busy?: boolean; status?: 'available' | 'flying' | 'maintenance'; ferryUntil?: number | null } = {}): Me['fleet'][number] => {
  const t = o.type ?? type();
  return { id, icao: t.icao, type: t, location, busy: o.busy ?? false, value: 1, registration: `JA000${id}`, ownership: 'owned', wearPct: 0, status: o.status ?? (o.busy ? 'flying' : 'available'), maintenanceUntil: null, contract: null, ferryUntil: o.ferryUntil ?? null };
};
const job = (o: Partial<Job> = {}): Job => ({ id: 'LFPG-1-0', source: 'board', kind: 'pax', origin: 'LFPG', destination: 'LFLL', distanceNm: 250, payloadKg: 5000, pax: 50, payout: 9000, ...o });
const me = (fleet: Me['fleet']): Me => ({ fleet } as Me);
/** What a "too small / too short" reason says: its kind, the aircraft named, the need and what that aircraft has. */
const short = (r: ReturnType<typeof noAircraftReason>) => (r && 'need' in r ? [r.kind, r.aircraft.id, r.need, r.have] : null);
const km: Record<string, number> = { 'RJTT-LFPG': 5_900, 'LFMN-LFPG': 410 };
const dist: Distance = (a, b) => km[`${a}-${b}`] ?? km[`${b}-${a}`] ?? null;

test('an aircraft at the origin that can fly the job: no reason to give', () => {
  assert.equal(noAircraftReason(me([plane(4, 'LFPG')]), job(), dist), null);
});

test('right aircraft, wrong airport: name it and where it is, so it can be ferried to the origin', () => {
  const r = noAircraftReason(me([plane(4, 'RJTT')]), job(), dist);
  assert.deepEqual(r && { kind: r.kind, id: 'aircraft' in r ? r.aircraft.id : null, d: 'distanceNm' in r ? r.distanceNm : null }, { kind: 'elsewhere', id: 4, d: 5_900 });
  assert.equal(planeLabel(plane(4, 'RJTT')), 'A35K JA0004');
});

test('wrong airport, several aircraft: the nearest one that can fly the job is offered', () => {
  const r = noAircraftReason(me([plane(1, 'RJTT'), plane(2, 'LFMN', { type: type({ icao: 'A320', seats: 180, rangeNm: 3000 }) })]), job(), dist);
  assert.equal(r?.kind === 'elsewhere' && r.aircraft.id, 2);
});

test('wrong airport and beyond the aircraft’s range: say so instead of offering a flight that would be refused', () => {
  const r = noAircraftReason(me([plane(1, 'RJTT', { type: type({ rangeNm: 3000 }) })]), job(), dist);
  assert.equal(r?.kind, 'far');
  assert.equal(r?.kind === 'far' && r.distanceNm, 5_900);
});

test('too small: the closest-fitting aircraft is named with its seats against the need', () => {
  const small = type({ icao: 'C208', seats: 9, cargoKg: 1000, rangeNm: 900 }), mid = type({ icao: 'AT76', seats: 70, cargoKg: 2000, rangeNm: 800 }), tiny = type({ icao: 'C172', seats: 4, cargoKg: 60, rangeNm: 640 });
  const r = noAircraftReason(me([plane(1, 'LFPG', { type: small }), plane(2, 'LFPG', { type: tiny })]), job({ pax: 50 }), dist);
  assert.deepEqual(short(r), ['seats', 1, 50, 9]);
  const closest = noAircraftReason(me([plane(1, 'LFPG', { type: small }), plane(3, 'LFPG', { type: mid })]), job({ pax: 100 }), dist);
  assert.equal(short(closest)?.[1], 3, '70 of 100 seats is nearer than 9 of 100');
  const cargo = noAircraftReason(me([plane(1, 'LFPG', { type: small })]), job({ kind: 'cargo', pax: 0, payloadKg: 9000 }), dist);
  assert.deepEqual(short(cargo), ['cargo', 1, 9000, 1000]);
});

test('too short a range: the real reason even when the aircraft stands at the origin', () => {
  const r = noAircraftReason(me([plane(1, 'LFPG', { type: type({ icao: 'C208', seats: 200, rangeNm: 900 }) })]), job({ distanceNm: 4000 }), dist);
  assert.deepEqual(short(r), ['range', 1, 4000, 900]);
});

test('a job that needs one type you do not own, no aircraft at all, and aircraft that are busy or landing', () => {
  assert.deepEqual(noAircraftReason(me([plane(1, 'LFPG')]), job({ requiredAircraft: 'B738' }), dist), { kind: 'type', icao: 'B738' });
  assert.deepEqual(noAircraftReason(me([]), job(), dist), { kind: 'none' });
  assert.deepEqual(noAircraftReason(me([plane(1, 'LFPG', { busy: true })]), job(), dist), { kind: 'busy' });
  assert.deepEqual(noAircraftReason(me([plane(1, 'LFPG', { status: 'maintenance' })]), job(), dist), { kind: 'busy' });
  const landing = noAircraftReason(me([plane(1, 'LFPG', { busy: true, ferryUntil: 99 })]), job(), dist);
  assert.deepEqual(landing && 'at' in landing && [landing.kind, landing.at], ['arriving', 99]);
});

test('without airport coordinates the aircraft is still named (the server prices the flight)', () => {
  const r = noAircraftReason(me([plane(4, 'RJTT')]), job());
  assert.equal(r?.kind === 'elsewhere' && r.distanceNm, null);
});
