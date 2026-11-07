import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIM_AIRCRAFT_MAX, type SimAircraftEntry, type SimAircraftList } from '@opc/shared';
import { MIGRATIONS } from './db.ts';
import { harness } from './harness.ts';
import { matchByName } from './simair.ts';

const URL = '/api/v1/me/sim-aircraft';
const entry = (over: Partial<SimAircraftEntry> = {}): SimAircraftEntry => ({ title: 'Cessna 172 Skyhawk (Asobo)', icao: 'C172', manufacturer: 'Cessna', model: '172', source: 'official', liveries: 3, ...over });

async function player(h: Awaited<ReturnType<typeof harness>>, name?: string) {
  const { token } = await h.register(name);
  return { token, key: await h.apiKey(token) };
}

test('the migration is appended: the sim_aircraft table exists and sits after the earlier lots', async () => {
  const h = await harness();
  assert.ok(MIGRATIONS.some((m) => m.includes('CREATE TABLE sim_aircraft')));
  assert.ok(MIGRATIONS.at(-1)!.includes('sim_aircraft') || MIGRATIONS.some((m, i) => i >= 10 && m.includes('sim_aircraft')), 'after position 10 (the live database)');
  h.db.prepare('SELECT 1 FROM sim_aircraft').all();
});

test('an API key PUTs the list; the owner reads it back with the catalogue types, no price from the client', async () => {
  const h = await harness();
  const { token, key } = await player(h);
  const put = await h.call('PUT', URL, { token: key, body: { aircraft: [entry(), entry({ title: 'A320neo ANA', icao: 'A20N', manufacturer: 'Airbus', model: 'A320neo', source: 'community', liveries: 1 }), entry({ title: 'Fenix Weird One', icao: 'ZZZ9', source: 'community', liveries: 0 })] } });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual([put.body.count, put.body.scannedAt], [3, h.clock.t]);
  const got = (await h.call('GET', URL, { token })).body as SimAircraftList;
  assert.equal(got.scannedAt, h.clock.t);
  assert.deepEqual(got.aircraft.map((a) => [a.title, a.icao, a.hidden]), [['A320neo ANA', 'A20N', false], ['Cessna 172 Skyhawk (Asobo)', 'C172', false], ['Fenix Weird One', 'ZZZ9', false]]);
  assert.deepEqual(got.types.map((t) => [t.icao, t.derived]), [['A20N', false], ['C172', false], ['ZZZ9', true]], 'the catalogue prices; an unknown designator is the category estimate');
});

test('a PUT replaces the list but keeps what the player hid; an unknown designator is matched against the catalogue by title', async () => {
  const h = await harness();
  const { token, key } = await player(h);
  await h.call('PUT', URL, { token: key, body: { aircraft: [entry(), entry({ title: 'Other', icao: 'C208' })] } });
  assert.equal((await h.call('PATCH', URL, { token, body: { title: 'Other', hidden: true } })).body.aircraft.find((a: any) => a.title === 'Other').hidden, true);
  h.clock.t += 60_000;
  await h.call('PUT', URL, { token: key, body: { aircraft: [entry({ title: 'Other', icao: null }), entry({ title: 'PMDG 737-800 House', icao: null, manufacturer: 'Boeing', model: '737-800', source: 'community' })] } });
  const got = (await h.call('GET', URL, { token })).body as SimAircraftList;
  assert.deepEqual(got.aircraft.map((a) => [a.title, a.icao, a.hidden]), [['Other', null, true], ['PMDG 737-800 House', 'B738', false]]);
  assert.equal(got.scannedAt, h.clock.t);
  assert.equal(matchByName({ title: 'Some Airbus A320neo skin', manufacturer: '', model: '' }), 'A20N');
  assert.equal(matchByName({ title: 'Xyz', manufacturer: '', model: '' }), null);
});

test('validation: bounds, shapes and duplicates are refused with 400 and nothing is stored', async () => {
  const h = await harness();
  const { token, key } = await player(h);
  const bad = async (aircraft: unknown) => (await h.call('PUT', URL, { token: key, body: { aircraft } })).status;
  assert.equal(await bad([entry({ icao: 'c172' })]), 400, 'lower case');
  assert.equal(await bad([entry({ icao: 'ABCDE' })]), 400);
  assert.equal(await bad([entry({ title: '' })]), 400);
  assert.equal(await bad([entry({ title: 'x'.repeat(201) })]), 400);
  assert.equal(await bad([entry({ manufacturer: 'x'.repeat(81) })]), 400);
  assert.equal(await bad([entry({ source: 'steam' as never })]), 400);
  assert.equal(await bad([entry({ liveries: -1 })]), 400);
  assert.equal(await bad([entry(), entry()]), 400, 'duplicate title');
  assert.equal(await bad('nope'), 400);
  assert.equal(await bad(Array.from({ length: SIM_AIRCRAFT_MAX + 1 }, (_, i) => entry({ title: `T${i}` }))), 400);
  assert.deepEqual(((await h.call('GET', URL, { token })).body as SimAircraftList).aircraft, []);
  const max = await h.call('PUT', URL, { token: key, body: { aircraft: Array.from({ length: SIM_AIRCRAFT_MAX }, (_, i) => entry({ title: `Plane ${i}`, manufacturer: 'M'.repeat(80), model: 'x'.repeat(80) })) } });
  assert.equal(max.status, 200, 'the biggest allowed list fits the body limit');
});

test('auth: the PUT needs an API key (a session or nothing is 401), the reads need a session, and nobody reads another player\'s list', async () => {
  const h = await harness();
  const a = await player(h, 'alice');
  const b = await player(h, 'bob');
  assert.equal((await h.call('PUT', URL, { body: { aircraft: [] } })).status, 401);
  assert.equal((await h.call('PUT', URL, { token: a.token, body: { aircraft: [] } })).status, 401, 'a session token is not an API key');
  assert.equal((await h.call('GET', URL)).status, 401);
  assert.equal((await h.call('GET', URL, { token: a.key })).status, 401, 'an API key cannot read: it can only send');
  await h.call('PUT', URL, { token: a.key, body: { aircraft: [entry()] } });
  assert.equal(((await h.call('GET', URL, { token: b.token })).body as SimAircraftList).aircraft.length, 0, 'bob sees his own (empty) list');
  assert.equal((await h.call('PATCH', URL, { token: b.token, body: { title: entry().title, hidden: true } })).status, 404, 'bob cannot hide alice\'s aircraft');
  assert.equal(((await h.call('GET', URL, { token: a.token })).body as SimAircraftList).aircraft[0]!.hidden, false);
  assert.equal((await h.call('PUT', URL, { token: b.key, body: { aircraft: [] } })).status, 200);
  assert.equal(((await h.call('GET', URL, { token: a.token })).body as SimAircraftList).aircraft.length, 1, "bob's PUT never touches alice's rows");
});

test('hiding: PATCH hides and shows a title (case-insensitive), validates its body, and deleting the account removes the list', async () => {
  const h = await harness();
  const { token, key } = await player(h, 'carol');
  await h.call('PUT', URL, { token: key, body: { aircraft: [entry()] } });
  assert.equal((await h.call('PATCH', URL, { token, body: { title: 'cessna 172 skyhawk (asobo)', hidden: true } })).body.aircraft[0].hidden, true);
  assert.equal((await h.call('PATCH', URL, { token, body: { title: entry().title, hidden: false } })).body.aircraft[0].hidden, false);
  assert.equal((await h.call('PATCH', URL, { token, body: { title: entry().title } })).status, 400);
  assert.equal((await h.call('PATCH', URL, { token, body: { title: 'Nope', hidden: true } })).status, 404);
  assert.equal((await h.call('DELETE', '/api/v1/me', { token, body: { password: 'correct horse' } })).status, 204);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM sim_aircraft').get()!.n, 0);
});
