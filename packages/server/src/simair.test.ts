import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIM_AIRCRAFT_MAX, type SimAircraftEntry, type SimAircraftList } from '@opc/shared';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, get, openDb } from './db.ts';
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
  assert.equal(matchByName({ title: 'C172SP G1000 Passengers', manufacturer: '', model: '' }), 'C172', 'default aircraft are named after their designator');
  assert.equal(matchByName({ title: 'C208B Cargo', manufacturer: '', model: '' }), 'C208');
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

test('remap: the player types an untyped aircraft by hand; the effective type is the override, a rescan keeps it, null clears it', async () => {
  const h = await harness();
  const { token, key } = await player(h, 'dave');
  const fenix = entry({ title: 'Fenix FNX320 CFM', icao: null, manufacturer: 'Fenix', model: 'FNX320', source: 'community' });
  const scan = { token: key, body: { aircraft: [entry(), fenix] } };
  await h.call('PUT', URL, scan);
  const view = async () => (await h.call('GET', URL, { token })).body as SimAircraftList;
  const fenixOf = async () => (await view()).aircraft.find((a) => a.title === 'Fenix FNX320 CFM')!;
  assert.deepEqual([(await fenixOf()).icao, (await fenixOf()).manual], [null, false]);

  const set = await h.call('PATCH', URL, { token, body: { title: 'fenix fnx320 cfm', icao: 'A320' } });
  assert.equal(set.status, 200, set.text);
  const got = set.body as SimAircraftList;
  assert.deepEqual(got.aircraft.find((a) => a.title === 'Fenix FNX320 CFM'), { ...fenix, icao: 'A320', manual: true, hidden: false }, 'effective type = override, flagged manual');
  assert.ok(got.types.some((t) => t.icao === 'A320' && !t.derived), 'the catalogue type is sent, so the buy filter can offer it');

  h.clock.t += 60_000;
  await h.call('PUT', URL, scan);
  assert.deepEqual([(await fenixOf()).icao, (await fenixOf()).manual], ['A320', true], 'a rescan keeps the manual choice');
  h.clock.t += 60_000;
  await h.call('PUT', URL, { token: key, body: { aircraft: [{ ...fenix, icao: 'A21N' }] } });
  assert.deepEqual([(await fenixOf()).icao, (await fenixOf()).manual], ['A320', true], 'and wins over a type the scan now reports');
  await h.call('PUT', URL, { token: key, body: { aircraft: [entry()] } });
  await h.call('PUT', URL, { token: key, body: { aircraft: [entry(), fenix] } });
  assert.deepEqual([(await fenixOf()).icao, (await fenixOf()).manual], [null, false], 'an aircraft that left the scan loses its override with its row');

  await h.call('PATCH', URL, { token, body: { title: 'Fenix FNX320 CFM', icao: 'A320' } });
  await h.call('PATCH', URL, { token, body: { title: 'Fenix FNX320 CFM', hidden: true } });
  assert.deepEqual([(await fenixOf()).icao, (await fenixOf()).hidden], ['A320', true], 'hiding leaves the override alone');
  const cleared = await h.call('PATCH', URL, { token, body: { title: 'Fenix FNX320 CFM', icao: null } });
  assert.equal(cleared.status, 200);
  assert.deepEqual([(await fenixOf()).icao, (await fenixOf()).manual, (await fenixOf()).hidden], [null, false, true], 'null clears the override and nothing else');
  await h.call('PUT', URL, { token: key, body: { aircraft: [{ ...fenix, icao: 'A21N' }] } });
  await h.call('PATCH', URL, { token, body: { title: 'Fenix FNX320 CFM', icao: 'A320' } });
  await h.call('PATCH', URL, { token, body: { title: 'Fenix FNX320 CFM', icao: null } });
  assert.deepEqual([(await fenixOf()).icao, (await fenixOf()).manual], ['A21N', false], 'clearing it brings the scanned type back');
});

test('remap: only a curated catalogue type is accepted (422), a bad body is 400, nothing is stored on a refusal', async () => {
  const h = await harness();
  const { token, key } = await player(h, 'erin');
  await h.call('PUT', URL, { token: key, body: { aircraft: [entry({ title: 'Mod', icao: null })] } });
  const patch = async (body: unknown) => h.call('PATCH', URL, { token, body });
  assert.equal((await patch({ title: 'Mod', icao: 'ZZZ9' })).status, 422, 'not in the catalogue');
  assert.equal((await patch({ title: 'Mod', icao: 'A002' })).status, 422, 'in the catalogue but only a category estimate');
  assert.equal((await patch({ title: 'Mod', icao: 'a320' })).status, 400, 'lower case');
  assert.equal((await patch({ title: 'Mod', icao: 'ABCDE' })).status, 400);
  assert.equal((await patch({ title: 'Mod' })).status, 400, 'nothing to change');
  assert.equal((await patch({ icao: 'A320' })).status, 400, 'no title');
  assert.deepEqual(((await h.call('GET', URL, { token })).body as SimAircraftList).aircraft.map((a) => [a.icao, a.manual]), [[null, false]]);
  assert.equal((await h.call('PATCH', URL, { body: { title: 'Mod', icao: 'A320' } })).status, 401);
  assert.equal((await h.call('PATCH', URL, { token: key, body: { title: 'Mod', icao: 'A320' } })).status, 401, 'an API key cannot set it');
});

test('remap: nobody types another player\'s aircraft (404), and one player\'s override never reaches another list', async () => {
  const h = await harness();
  const a = await player(h, 'alice2');
  const b = await player(h, 'bob2');
  await h.call('PUT', URL, { token: a.key, body: { aircraft: [entry({ title: 'Shared Title', icao: null })] } });
  await h.call('PUT', URL, { token: b.key, body: { aircraft: [entry({ title: 'Shared Title', icao: null })] } });
  assert.equal((await h.call('PATCH', URL, { token: a.token, body: { title: 'Shared Title', icao: 'A320' } })).status, 200);
  const bobs = (await h.call('GET', URL, { token: b.token })).body as SimAircraftList;
  assert.deepEqual(bobs.aircraft.map((x) => [x.icao, x.manual]), [[null, false]], "bob's row with the same title is untouched");
  const carol = await player(h, 'carol2');
  assert.equal((await h.call('PATCH', URL, { token: carol.token, body: { title: 'Shared Title', icao: 'A320' } })).status, 404, 'a player with no such aircraft');
});

test('migration SCHEMA_SIM_AIRCRAFT_OVERRIDE adds icao_override to a database that already holds scanned aircraft, leaving them as they were', () => {
  const at = MIGRATIONS.findIndex((m) => m.includes('icao_override'));
  assert.ok(at > MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE sim_aircraft')), 'found by content, after the table it alters');
  const file = join(mkdtempSync(join(tmpdir(), 'opc-simac-')), 'prev.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < at; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${at}`);
  raw.exec(`INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1);
    INSERT INTO sim_aircraft (user_id, title, icao, manufacturer, model, source, liveries, hidden, scanned_at) VALUES (1, 'Old', 'C172', 'Cessna', '172', 'official', 1, 1, 5);`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.deepEqual({ ...get(db, 'SELECT title, icao, icao_override, hidden FROM sim_aircraft')! }, { title: 'Old', icao: 'C172', icao_override: null, hidden: 1 });
});
