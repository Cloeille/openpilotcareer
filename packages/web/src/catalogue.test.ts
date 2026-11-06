import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AircraftType } from '@opc/shared';
import { fleetSummary, groupOf, inGroup, isIcaoAirport, isIcaoType, quote, stepGroup } from './catalogue.ts';

const type = (o: Partial<AircraftType> = {}): AircraftType => ({ icao: 'C208', name: 'Caravan', category: 'turboprop-single', engines: 1, wtc: 'L', seats: 9, cargoKg: 1000, cruiseKts: 180, rangeNm: 900, derived: false, ...o });

test('every category belongs to one tab, "other" only to "all"', () => {
  assert.equal(groupOf('piston-multi'), 'piston');
  assert.equal(groupOf('turboprop-airliner'), 'turboprop');
  assert.equal(groupOf('jet-widebody'), 'jet');
  assert.equal(groupOf('helicopter'), 'helicopter');
  assert.equal(groupOf('other'), null);
  assert.equal(inGroup(type({ category: 'other' }), 'all'), true);
  assert.equal(inGroup(type({ category: 'other' }), 'jet'), false);
});

test('tabs wrap around in both directions', () => {
  assert.equal(stepGroup('all', 1), 'piston');
  assert.equal(stepGroup('helicopter', 1), 'all');
  assert.equal(stepGroup('all', -1), 'helicopter');
});

test('quote: price follows capacity x speed, balance after and shortfall', () => {
  const t = type({ seats: 9, cargoKg: 0, cruiseKts: 100 }); // 900 kg x 100 kt
  assert.deepEqual(quote(t, 1000_000), { price: 90_000, balanceAfter: 910_000, missing: 0, coverage: 1, affordable: true });
  const poor = quote(t, 30_000);
  assert.equal(poor.affordable, false);
  assert.equal(poor.missing, 60_000);
  assert.equal(poor.balanceAfter, -60_000);
  assert.ok(Math.abs(poor.coverage - 1 / 3) < 1e-9);
  assert.equal(quote(t, 90_000).affordable, true);
});

test('designators are validated like the server does', () => {
  assert.equal(isIcaoType('c208'), true);
  assert.equal(isIcaoType('A'), false);
  assert.equal(isIcaoType('ABCDE'), false);
  assert.equal(isIcaoType('C-208'), false);
  assert.equal(isIcaoAirport('lfmn'), true);
  assert.equal(isIcaoAirport('LF1N'), false);
  assert.equal(isIcaoAirport('LFM'), false);
});

test('fleet summary counts available aircraft', () => {
  assert.deepEqual(fleetSummary([{ busy: false }, { busy: true }, { busy: false }]), { total: 3, available: 2 });
  assert.deepEqual(fleetSummary([]), { total: 0, available: 0 });
});
