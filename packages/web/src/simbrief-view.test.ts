import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flight, Job } from '@opc/shared';
import { dispatchFor, isConnected, planState } from './simbrief-view.ts';

const job = (over: Partial<Job> = {}): Job => ({ id: 'J', source: 'board', kind: 'pax', origin: 'LFPG', destination: 'EGLL', distanceNm: 188, payloadKg: 15000, pax: 150, payout: 9000, ...over });
const flight = (over: Partial<Flight> = {}, j: Partial<Job> = {}): Flight => ({
  id: 12, companyId: 1, job: job(j), aircraftId: 3, aircraftIcao: 'A320', status: 'active', rejectReason: null, acceptedAt: 1, completedAt: null,
  revenue: 0, fuelCost: 0, landingFee: 0, maintenance: 0, net: 0, simbrief: { staticId: 'opc_12_ab12cd34ef56', ofpId: null }, ...over,
});
const params = (url: string | null) => Object.fromEntries(new URL(url!).searchParams);

test('a passenger flight opens the dispatch page with its route, type, passengers, company identity, registration and static id', () => {
  assert.deepEqual(params(dispatchFor(flight(), { code: 'AZR', callsign: 'AZURAIR' }, 'F-HAZR')), {
    type: 'A320', orig: 'LFPG', dest: 'EGLL', airline: 'AZR', callsign: 'AZURAIR', reg: 'F-HAZR', pax: '150', units: 'KGS', static_id: 'opc_12_ab12cd34ef56',
  });
});

test('a cargo flight sends its weight in thousands of kilograms and no passengers', () => {
  const p = params(dispatchFor(flight({}, { kind: 'cargo', pax: 0, payloadKg: 5250 }), { code: null, callsign: null }, null));
  assert.equal(p.cargo, '5.25');
  assert.equal(p.pax, undefined);
});

test('what the company or aircraft does not have is left out, never invented', () => {
  assert.deepEqual(Object.keys(params(dispatchFor(flight(), { code: null, callsign: null }, undefined))).sort(), ['dest', 'orig', 'pax', 'static_id', 'type', 'units']);
});

test('a flight without a SimBrief id (not a player\'s flight) has no dispatch page', () => {
  const { simbrief: _gone, ...bare } = flight();
  assert.equal(dispatchFor(bare, { code: 'AZR', callsign: null }, null), null);
});

test('connected means a username or a Pilot ID is saved', () => {
  assert.equal(isConnected(null), false);
  assert.equal(isConnected({ username: null, pilotId: null, verifiedAt: null }), false);
  assert.equal(isConnected({ username: 'amy', pilotId: null, verifiedAt: 1 }), true);
  assert.equal(isConnected({ username: null, pilotId: 7, verifiedAt: 1 }), true);
});

test('the plan state is "fetched" only once the server has stored a plan id for the flight', () => {
  assert.deepEqual(planState(flight()), { kind: 'none' });
  assert.deepEqual(planState(flight({ simbrief: { staticId: 's', ofpId: '99' } }, { plannedFuelKg: 5200, route: 'DCT' })), { kind: 'fetched', ofpId: '99', fuelKg: 5200, route: 'DCT' });
});
