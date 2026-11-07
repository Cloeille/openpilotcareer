import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchUrl, simbriefConnectSchema, simbriefIdentifier, simbriefImportSchema } from './simbrief.ts';

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

test('dispatch URL: the documented base, the three required fields, metric units, nothing else when nothing else is known', () => {
  const url = dispatchUrl({ type: 'A320', orig: 'LFPG', dest: 'EGLL' });
  assert.equal(url, 'https://dispatch.simbrief.com/options/custom?type=A320&orig=LFPG&dest=EGLL&units=KGS');
});

test('dispatch URL: airline, callsign, registration, static id when present; empty ones are omitted', () => {
  const full = dispatchUrl({ type: 'A320', orig: 'LFPG', dest: 'EGLL', airline: 'AZR', callsign: 'AZURAIR', reg: 'F-HAZR', pax: 148, staticId: 'opc_12_ab12cd' });
  assert.deepEqual(params(full), { type: 'A320', orig: 'LFPG', dest: 'EGLL', airline: 'AZR', callsign: 'AZURAIR', reg: 'F-HAZR', pax: '148', units: 'KGS', static_id: 'opc_12_ab12cd' });
  assert.deepEqual(params(dispatchUrl({ type: 'C172', orig: 'LFPG', dest: 'LFLL', airline: '', callsign: undefined, reg: '' })), { type: 'C172', orig: 'LFPG', dest: 'LFLL', units: 'KGS' });
});

test('dispatch URL: pax wins over cargo; cargo is in thousands of kilograms; zero loads write nothing', () => {
  assert.equal(params(dispatchUrl({ type: 'B738', orig: 'LFPG', dest: 'EGLL', pax: 90, cargoKg: 5000 })).cargo, undefined);
  assert.equal(params(dispatchUrl({ type: 'B738', orig: 'LFPG', dest: 'EGLL', cargoKg: 5250 })).cargo, '5.25');
  assert.equal(params(dispatchUrl({ type: 'B738', orig: 'LFPG', dest: 'EGLL', cargoKg: 800 })).cargo, '0.8');
  const none = params(dispatchUrl({ type: 'B738', orig: 'LFPG', dest: 'EGLL', pax: 0, cargoKg: 0 }));
  assert.equal(none.pax, undefined);
  assert.equal(none.cargo, undefined);
});

test('dispatch URL: values are percent-encoded and cannot add parameters or change the host', () => {
  const url = dispatchUrl({ type: 'A320', orig: 'LFPG', dest: 'EGLL', callsign: 'X&units=LBS#frag', reg: 'a b/c?d' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://dispatch.simbrief.com/options/custom');
  assert.equal(u.hash, '');
  assert.equal(u.searchParams.get('units'), 'KGS');
  assert.equal(u.searchParams.get('callsign'), 'X&units=LBS#frag');
  assert.equal(u.searchParams.get('reg'), 'a b/c?d');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['callsign', 'dest', 'orig', 'reg', 'type', 'units']);
});

test('only SimBrief\'s documented dispatch parameters are ever written', () => {
  const all = dispatchUrl({ type: 'A320', orig: 'LFPG', dest: 'EGLL', airline: 'AZR', callsign: 'AZUR', reg: 'F-HAZR', pax: 1, staticId: 's' });
  const allowed = new Set(['type', 'orig', 'dest', 'airline', 'callsign', 'reg', 'pax', 'cargo', 'units', 'static_id']);
  for (const k of Object.keys(params(all))) assert.ok(allowed.has(k), k);
});

test('connect and import bodies take one identifier, trimmed, nothing extra', () => {
  assert.deepEqual(simbriefConnectSchema.parse({ username: '  SpeedMaintenance746 ' }), { username: 'SpeedMaintenance746' });
  assert.deepEqual(simbriefConnectSchema.parse({ pilotId: 1423851 }), { pilotId: 1423851 });
  for (const bad of [{}, { username: '' }, { username: ' ' }, { username: '../x' }, { username: 'a'.repeat(65) }, { pilotId: 0 }, { pilotId: 1.5 }, { pilotId: 10_000_000 }, { pilotId: '12' }, { username: 'a', pilotId: 1 }]) {
    assert.equal(simbriefConnectSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  assert.deepEqual(simbriefImportSchema.parse({ simbriefUsername: 'amy' }), { simbriefUsername: 'amy' });
  assert.deepEqual(simbriefImportSchema.parse({ pilotId: 7 }), { pilotId: 7 });
  assert.equal(simbriefImportSchema.safeParse({}).success, false);
});

test('one field: digits are a Pilot ID, anything else a username, junk is nothing', () => {
  assert.deepEqual(simbriefIdentifier(' 1423851 '), { pilotId: 1423851 });
  assert.deepEqual(simbriefIdentifier('SpeedMaintenance746'), { username: 'SpeedMaintenance746' });
  assert.deepEqual(simbriefIdentifier('12345678'), { username: '12345678' });
  for (const junk of ['', '   ', '../etc', 'a/b']) assert.equal(simbriefIdentifier(junk), null, junk);
});
