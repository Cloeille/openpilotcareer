import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { installedPackagesPath, scanCommunity } from '../src/aircraft-scan.ts';
import { reportAircraft, scanInstall } from '../src/aircraft-sync.ts';
import { ApiError, ServerClient } from '../src/client.ts';
import { ListAssembly, enumerateOn, type ListPacket } from '../src/simconnect.ts';

// A SimConnect answer as MSFS 2024 sends it: a long list is split in packets (dwEntryNumber 0..dwOutOf-1), one list per requested SimObject type.
const packet = (requestID: number, entryNumber: number, outOf: number, rows: [string, string][]): ListPacket =>
  ({ requestID, entryNumber, outOf, simobjectLiveries: rows.map(([aircraftTitle, liveryName]) => ({ aircraftTitle, liveryName })) });
const AIRPLANES = [
  packet(10, 0, 2, [['Cessna 172 Skyhawk (Asobo)', 'Livery A'], ['Cessna 172 Skyhawk (Asobo)', 'Livery B']]),
  packet(10, 1, 2, [['Airbus A320neo (Asobo)', ''], ['ApronLife_JetwayHelper_H', '']]),
];
const HELICOPTERS = [packet(11, 0, 1, [['Airbus H135 (Asobo)', 'Default']])];

/** The part of a ConnectionHandle enumerateOn uses, answering like the simulator: each request is answered with its packets, after the call returns. */
function fakeSim(answers: Record<number, ListPacket[]>, o: { refuse?: boolean } = {}) {
  const h = Object.assign(new EventEmitter(), {
    sent: [] as [number, number][],
    enumerateSimObjectsAndLiveries(id: number, type: number): number {
      this.sent.push([id, type]);
      setImmediate(() => { if (o.refuse) this.emit('exception', { exception: 1, sendId: 100 + id }); else for (const p of answers[id] ?? []) this.emit('enumerateSimobjectAndLiveryList', p); });
      return 100 + id;
    },
  });
  const sc = { SimObjectType: { AIRCRAFT: 2, HELICOPTER: 3 } };
  return { h, sc: sc as never, handle: h as never };
}

test('ListAssembly: a list is complete when all its packets arrived, whatever the order; foreign requests are ignored', () => {
  const a = new ListAssembly([10, 11]);
  a.add(AIRPLANES[1]!);
  a.add(packet(99, 0, 1, [['Not ours', '']]));
  assert.equal(a.complete, false);
  a.add(AIRPLANES[0]!);
  assert.equal(a.complete, false, 'the helicopter list is still missing');
  a.add(HELICOPTERS[0]!);
  assert.equal(a.complete, true);
  assert.deepEqual([a.rows.length, a.rowsOf(10), a.rowsOf(11)], [5, 4, 1]);
});

test('enumerateOn asks for airplanes and helicopters and returns every title/livery row of the fixture', async () => {
  const sim = fakeSim({ 10: AIRPLANES, 11: HELICOPTERS });
  const rows = await enumerateOn(sim.sc, sim.handle, { log: () => {} });
  assert.deepEqual(sim.h.sent, [[10, 2], [11, 3]]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { title: 'Cessna 172 Skyhawk (Asobo)', livery: 'Livery A' });
  assert.equal(sim.h.listenerCount('enumerateSimobjectAndLiveryList') + sim.h.listenerCount('exception'), 0, 'listeners removed');
});

test('enumerateOn: a SimConnect exception for one of our requests fails the scan; silence times out', async () => {
  const refused = fakeSim({}, { refuse: true });
  await assert.rejects(enumerateOn(refused.sc, refused.handle, { log: () => {} }), /refused the aircraft list/);
  const silent = fakeSim({});
  await assert.rejects(enumerateOn(silent.sc, silent.handle, { log: () => {}, timeoutMs: 20 }), /did not answer/);
  const partial = fakeSim({ 10: [AIRPLANES[0]!] });
  const rows = await enumerateOn(partial.sc, partial.handle, { log: () => {}, timeoutMs: 20 });
  assert.equal(rows.length, 2, 'what arrived is kept when the list is cut short');
});

// ---- the install on disk
function install(): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'opc-aircraft-'));
  const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
  put('Packages/Community/apronlife-jetway-helper/SimObjects/Airplanes/Jw/aircraft.cfg', '[GENERAL]\nicao_type_designator = "B772"\nicao_engine_count = 2\n[FLTSIM.0]\ntitle = "ApronLife_JetwayHelper_H"\nisuserselectable = 0\nisairtraffic = 1\n');
  put('Packages/Community/pmdg-aircraft-738/SimObjects/Airplanes/PMDG 737-800/aircraft.cfg', '[fltsim.0]\ntitle="PMDG 737-800 House"\nui_manufacturer="Boeing"\nui_type="737-800"\n');
  put('Packages/Community2024/microsoft-a320neo-ANA/SimObjects/Airplanes/A320_ANA/aircraft.cfg', '[VARIATION]\nbase_container = "..\\\\A320"\n[FLTSIM.0]\ntitle = "A320neo ANA"\n');
  put('Packages/Community/fnx-aircraft-320/SimObjects/Airplanes/FNX_32X/common/config/aircraft.cfg', '[GENERAL]\nicao_type_designator = A320\nicao_engine_count = 2\n');
  put('Packages/Community/fnx-aircraft-320/SimObjects/Airplanes/FNX_32X/presets/fnx/CFM/config/aircraft.cfg', '[fltsim.0]\ntitle = "FenixA320 CFM"\nui_manufacturer = "Airbus"\nui_type = "A320"\nisuserselectable = 1\n');
  put('Packages/Community/inibuilds-aircraft-a350/SimObjects/AirplaneParts/Seat/sim.cfg', '[fltsim.0]\ntitle=SEAT_A350_Copilot\n');
  put('Packages/Community/ground/SimObjects/GroundVehicles/Truck/sim.cfg', '[fltsim.0]\ntitle=Truck\n');
  put('Packages/Official2024/Steam/asobo-aircraft-c152/layout.json', '{}');
  put('Roaming/Microsoft Flight Simulator 2024/UserCfg.opt', `InstalledPackagesPath "${join(root, 'Packages')}"\nGraphics {\n}\n`);
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('installedPackagesPath reads InstalledPackagesPath from the 2024 UserCfg.opt, null without one', (t) => {
  const { root, done } = install();
  t.after(done);
  assert.equal(installedPackagesPath({ APPDATA: join(root, 'Roaming') }), join(root, 'Packages'));
  assert.equal(installedPackagesPath({ APPDATA: join(root, 'nowhere') }), null);
  assert.equal(installedPackagesPath({}), null);
});

test('scanCommunity walks Community and Community2024 Airplanes only, legacy and modular layouts, never parts, ground vehicles or the archived Official packages', (t) => {
  const { root, done } = install();
  t.after(done);
  const titles = scanCommunity(join(root, 'Packages')).flatMap((c) => c.variations.map((v) => v.title)).sort();
  assert.deepEqual(titles, ['A320neo ANA', 'ApronLife_JetwayHelper_H', 'FenixA320 CFM', 'PMDG 737-800 House']);
});

test('scanInstall: SimConnect titles + Community cfg files give one entry per model, the jet bridge helper is gone', (t) => {
  const { root, done } = install();
  t.after(done);
  const listing = [
    ...AIRPLANES.flatMap((p) => p.simobjectLiveries.map((r) => ({ title: r.aircraftTitle, livery: r.liveryName }))),
    { title: 'PMDG 737-800 House', livery: '' }, { title: 'FenixA320 CFM', livery: 'Standard' },
  ];
  const s = scanInstall(listing, join(root, 'Packages'));
  assert.deepEqual(s.entries.map((e) => [e.title, e.icao, e.source, e.liveries]), [
    ['Airbus A320neo (Asobo)', null, 'official', 1], ['Cessna 172 Skyhawk (Asobo)', null, 'official', 2], ['FenixA320 CFM', 'A320', 'community', 1], ['PMDG 737-800 House', null, 'community', 1],
  ]);
  assert.equal(s.stats.dropped, 1);
  assert.equal(s.cfgs, 4);
  assert.equal(scanInstall(listing, null).entries.length, 5, 'without a UserCfg.opt nothing is dropped and everything counts as official');
});

// ---- sending
const clientWith = (respond: (url: string, init: RequestInit) => Response) => new ServerClient('http://opc.test', 'opc_testkey-0123456789', (async (url: string, init: RequestInit) => respond(url, init)) as never);

test('reportAircraft PUTs the entries with the API key; an empty scan is never sent', async (t) => {
  const { root, done } = install();
  t.after(done);
  const seen: { url: string; method: string | undefined; auth: unknown; body: any }[] = [];
  const client = clientWith((url, init) => { seen.push({ url, method: init.method, auth: (init.headers as Record<string, string>).authorization, body: JSON.parse(String(init.body)) }); return Response.json({ count: 1, scannedAt: 5 }); });
  const lines: string[] = [];
  const saved = process.env.APPDATA;
  process.env.APPDATA = join(root, 'Roaming');
  t.after(() => { if (saved === undefined) delete process.env.APPDATA; else process.env.APPDATA = saved; });
  await reportAircraft(client, [{ title: 'FenixA320 CFM', livery: '' }], (l) => lines.push(l));
  assert.deepEqual([seen[0]!.url, seen[0]!.method, seen[0]!.auth], ['http://opc.test/api/v1/me/sim-aircraft', 'PUT', 'Bearer opc_testkey-0123456789']);
  assert.equal(seen[0]!.body.aircraft[0].icao, 'A320');
  assert.match(lines.join('\n'), /1 aircraft \(0 official, 1 community\)/);
  await assert.rejects(reportAircraft(client, [{ title: 'ApronLife_JetwayHelper_H', livery: '' }], () => {}), /no aircraft found/);
  assert.equal(seen.length, 1, 'nothing was sent for the empty scan');
  const refused = clientWith(() => Response.json({ error: 'unauthorized', message: 'bad key' }, { status: 401 }));
  await assert.rejects(reportAircraft(refused, [{ title: 'FenixA320 CFM', livery: '' }], () => {}), (e: unknown) => e instanceof ApiError && e.status === 401);
});
