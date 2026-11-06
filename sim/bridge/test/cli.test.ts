import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { saveConfig } from '../src/config.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const fixture = (n: string) => fileURLToPath(new URL(`../fixtures/${n}.json`, import.meta.url));
const KEY = 'opc_testkey-0123456789';

type Ctx = { after: (f: () => void) => void };
/** A server that knows one active flight (LFPN -> LFAQ, C172, id 7) and answers every report with `verdict`. `antiCheat` is left out of /info unless given (older servers). */
async function stub(t: Ctx, verdict: { verification: string; reason: string | null }, antiCheat?: boolean, live: 'ok' | 'missing' | 'hang' = 'ok') {
  const seen: { auth: string | undefined; body: unknown }[] = [];
  const liveSeen: { auth: string | undefined; body: Record<string, any> }[] = [];
  const s = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (req.url === '/api/v1/info') return json(200, { name: 'Stub', version: '0', apiVersion: 1, registrationOpen: true, ...(antiCheat === undefined ? {} : { antiCheat }) });
      if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: 'unauthorized', message: 'bad key' });
      if (req.url === '/api/v1/flights/active') return json(200, [{ id: 7, aircraftIcao: 'C172', acceptedAt: Date.now() - 60_000, job: { origin: 'LFPN', destination: 'LFAQ', distanceNm: 50, payloadKg: 100 } }]);
      if (req.method === 'POST' && req.url === '/api/v1/flights/7/live') {
        if (live === 'missing') return json(404, { error: 'not_found', message: 'not found' });
        if (live === 'hang') return; // never answers
        liveSeen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        return void res.writeHead(204).end();
      }
      if (req.method === 'POST' && req.url === '/api/v1/flights/7/telemetry-verify') { seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) }); return json(200, verdict); }
      json(404, { error: 'not_found', message: 'not found' });
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen, liveSeen };
}

function run(t: Ctx, args: string[], stdin?: string) {
  const home = mkdtempSync(join(tmpdir(), 'opc-cli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return new Promise<{ code: number | null; out: string; home: string }>((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { env: { ...process.env, XDG_CONFIG_HOME: home, APPDATA: home, OPC_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    p.stdin.end(stdin ?? '');
    p.on('close', (code) => resolve({ code, out, home }));
  });
}

test('replay of a clean flight: reported to the matching active flight, exit 0, the key is never printed', async (t) => {
  const srv = await stub(t, { verification: 'verified', reason: null });
  const r = await run(t, ['replay', fixture('ga-c172-lfpn-lfaq'), '--server', srv.url, '--key', KEY, '--speed', '100000']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /as flight 7: LFPN -> LFAQ/);
  assert.match(r.out, /verified/);
  assert.equal(srv.seen.length, 1);
  const report = srv.seen[0]!.body as Record<string, unknown>;
  assert.deepEqual([report.departureIcao, report.arrivalIcao, report.aircraftIcao, report.source], ['LFPN', 'LFAQ', 'C172', 'simconnect']);
  assert.equal(report.flags, undefined);
  assert.ok(!r.out.includes(KEY));
});

test('replay of a cheat flight: the flags travel with the report and the rejection gives exit code 2', async (t) => {
  const reason = 'the simulator client flagged this flight: time_acceleration_above_1x';
  const srv = await stub(t, { verification: 'rejected', reason });
  const r = await run(t, ['replay', fixture('cheat-simrate4x-c172-lfpn-lfaq'), '--server', srv.url, '--key', KEY, '--speed', '100000']);
  assert.equal(r.code, 2, r.out);
  assert.ok(r.out.includes(reason), r.out);
  assert.deepEqual((srv.seen[0]!.body as { flags: string[] }).flags, ['time_acceleration_above_1x']);
});

test('replay: no matching active flight and a wrong key are explained, nothing is sent', async (t) => {
  const srv = await stub(t, { verification: 'verified', reason: null });
  const other = await run(t, ['replay', fixture('airliner-a320-lfpg-egll'), '--server', srv.url, '--key', KEY, '--speed', '100000']);
  assert.equal(other.code, 1);
  assert.match(other.out, /flies LFPG -> EGLL in a A320: accept such a job/);
  const bad = await run(t, ['replay', fixture('ga-c172-lfpn-lfaq'), '--server', srv.url, '--key', 'opc_wrongwrongwrong', '--speed', '100000']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /bad key/);
  assert.equal(srv.seen.length, 0);
});

test('setup checks the key against the server before saving it (mode 600); flights then works without flags', async (t) => {
  const srv = await stub(t, { verification: 'verified', reason: null });
  const refused = await run(t, ['setup', '--server', srv.url, '--key', 'opc_wrongwrongwrong']);
  assert.equal(refused.code, 1);
  const r = await run(t, ['setup', '--server', srv.url], `${KEY}\n`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /key accepted, 1 active flight/);
  assert.ok(!r.out.includes(KEY));
  assert.equal(statSync(join(r.home, 'openpilotcareer', 'config.json')).mode & 0o777, 0o600);
  // reuse the saved setup: same config dir, no flags
  const again = await new Promise<string>((resolve) => {
    const p = spawn(process.execPath, [cli, 'flights'], { env: { ...process.env, XDG_CONFIG_HOME: r.home, APPDATA: r.home, OPC_API_KEY: '' } });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    p.on('close', () => resolve(out));
  });
  assert.match(again, /7 {2}LFPN -> LFAQ {2}C172/);
});

test('flights tells the pilot when the server has anti-cheat off, and stays quiet otherwise', async (t) => {
  const off = await stub(t, { verification: 'verified', reason: null }, false);
  const r = await run(t, ['flights', '--server', off.url, '--key', KEY]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Stub has anti-cheat off/);
  assert.match(r.out, /7 {2}LFPN -> LFAQ/);
  for (const antiCheat of [true, undefined]) {
    const on = await stub(t, { verification: 'verified', reason: null }, antiCheat);
    assert.doesNotMatch((await run(t, ['flights', '--server', on.url, '--key', KEY])).out, /anti-cheat/);
  }
});

test('replay posts live samples to POST /flights/:id/live while the flight is reported as before', async (t) => {
  const srv = await stub(t, { verification: 'verified', reason: null });
  const r = await run(t, ['replay', fixture('ga-c172-lfpn-lfaq'), '--server', srv.url, '--key', KEY, '--speed', '1000']);
  assert.equal(r.code, 0, r.out);
  assert.equal(srv.seen.length, 1, 'the telemetry report is still sent exactly once');
  assert.ok(srv.liveSeen.length >= 5, `live samples received: ${srv.liveSeen.length}`);
  assert.ok(srv.liveSeen.every((l) => l.auth === `Bearer ${KEY}`));
  const phases = new Set(srv.liveSeen.map((l) => l.body.phase));
  assert.ok(phases.has('airborne'), [...phases].join());
  const air = srv.liveSeen.filter((l) => l.body.phase === 'airborne');
  assert.ok(air.some((l) => l.body.gsKts > 100 && l.body.altFt > 0), 'airborne samples carry speed and an estimated altitude');
  const lons = srv.liveSeen.map((l) => l.body.lon as number);
  assert.ok(lons[lons.length - 1]! !== lons[0], 'the position moves along the route');
  const b = srv.liveSeen[0]!.body;
  assert.deepEqual(Object.keys(b).sort(), ['altFt', 'engines', 'flags', 'fuelKg', 'gsKts', 'headingDeg', 'lat', 'lon', 'paused', 'phase', 'simRate', 't', 'vsFpm']);
  assert.ok(!r.out.includes(KEY));
});

test('replay against a server without the live route (older server): the flight is still verified and the pilot is told once', async (t) => {
  const srv = await stub(t, { verification: 'verified', reason: null }, undefined, 'missing');
  const r = await run(t, ['replay', fixture('ga-c172-lfpn-lfaq'), '--server', srv.url, '--key', KEY, '--speed', '1000']);
  assert.equal(r.code, 0, r.out);
  assert.equal(srv.seen.length, 1);
  assert.equal((r.out.match(/live position stopped/g) ?? []).length, 1, r.out);
});

test('replay with a live endpoint that never answers: the report is not delayed', async (t) => {
  const srv = await stub(t, { verification: 'verified', reason: null }, undefined, 'hang');
  const started = Date.now();
  const r = await run(t, ['replay', fixture('ga-c172-lfpn-lfaq'), '--server', srv.url, '--key', KEY, '--speed', '100000']);
  assert.equal(r.code, 0, r.out);
  assert.equal(srv.seen.length, 1);
  assert.ok(Date.now() - started < 8_000, 'finished well before the live request timeout would matter');
});

// ---- no command: what a double click, or MSFS starting the exe from exe.xml, runs

type Flight = { id: number; acceptedAt: number; origin: string; destination: string };
const flightJson = (f: Flight) => ({ id: f.id, aircraftIcao: 'C172', acceptedAt: f.acceptedAt, job: { origin: f.origin, destination: f.destination, distanceNm: 50, payloadKg: 100 } });

/** A server whose list of active flights the test can change while the bridge runs. */
async function flightsStub(t: Ctx, flights: { list: Flight[] }) {
  const s = createServer((req, res) => {
    const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.url === '/api/v1/info') return json(200, { name: 'Stub', version: '0', apiVersion: 1, registrationOpen: true });
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: 'unauthorized', message: 'bad key' });
    if (req.url === '/api/v1/flights/active') return json(200, flights.list.map(flightJson));
    json(404, { error: 'not_found', message: 'not found' });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as { port: number };
  await new Promise((r) => s.close(r));
  return port;
}

/** Starts the CLI with `args`, lets `until` watch the output (it may also act), and stops the CLI once it returns. */
async function runUntil(t: Ctx, args: string[], o: { home?: string; answers?: [RegExp, string][]; until: (out: () => string) => Promise<void> }) {
  const home = o.home ?? mkdtempSync(join(tmpdir(), 'opc-cli-'));
  if (!o.home) t.after(() => rmSync(home, { recursive: true, force: true }));
  const port = await freePort();
  const p = spawn(process.execPath, [cli, ...args], { env: { ...process.env, XDG_CONFIG_HOME: home, APPDATA: home, OPC_API_KEY: '', OPC_STATUS_PORT: String(port), OPC_POLL_MS: '100' }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { p.kill('SIGKILL'); });
  let out = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { out += c; });
  // a person types each answer after its question; piping both lines at once would lose the second one
  const answers = [...(o.answers ?? [])];
  p.stdout.on('data', () => { while (answers[0] && answers[0][0].test(out)) p.stdin.write(answers.shift()![1]); });
  const exited = new Promise<number | null>((resolve) => p.on('close', resolve));
  await Promise.race([o.until(() => out), new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout; output so far:\n${out}`)), 15_000))]);
  const statusBody = await fetch(`http://127.0.0.1:${port}/status`).then((r) => r.json(), () => null);
  p.kill('SIGINT');
  const code = await exited;
  return { out, code, home, status: statusBody as { flight: { id: number } | null; phase: string } | null };
}

const until = (re: RegExp) => async (out: () => string) => { while (!re.test(out())) await new Promise((r) => setTimeout(r, 25)); };
const configured = (url: string) => { const home = mkdtempSync(join(tmpdir(), 'opc-cli-')); saveConfig(join(home, 'openpilotcareer'), { serverUrl: url, apiKey: KEY }); return home; };

test('no command after setup: follows the only active flight like `fly`', async (t) => {
  const url = await flightsStub(t, { list: [{ id: 7, acceptedAt: 1_000, origin: 'LFPN', destination: 'LFAQ' }] });
  const home = configured(url);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const r = await runUntil(t, [], { home, until: until(/flight 7: LFPN -> LFAQ in a C172/) });
  assert.equal(r.status?.flight?.id, 7);
  assert.ok(!r.out.includes(KEY));
  assert.doesNotMatch(r.out, /waiting for a job/);
});

test('no command with several active flights: the most recently accepted one', async (t) => {
  const url = await flightsStub(t, { list: [
    { id: 3, acceptedAt: 5_000, origin: 'LFPN', destination: 'LFAQ' },
    { id: 9, acceptedAt: 9_000, origin: 'LFPG', destination: 'EGLL' },
    { id: 5, acceptedAt: 2_000, origin: 'LFPO', destination: 'LFRS' },
  ] });
  const home = configured(url);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const r = await runUntil(t, [], { home, until: until(/flight 9: LFPG -> EGLL/) });
  assert.equal(r.status?.flight?.id, 9);
});

test('no command without an active flight: says it waits, serves an empty status, then picks up the job accepted later', async (t) => {
  const flights = { list: [] as Flight[] };
  const url = await flightsStub(t, flights);
  const home = configured(url);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const r = await runUntil(t, [], { home, until: async (out) => {
    await until(/waiting for a job accepted in the web app/)(out);
    flights.list = [{ id: 11, acceptedAt: 3_000, origin: 'LFPN', destination: 'LFAQ' }];
    await until(/flight 11: LFPN -> LFAQ/)(out);
  } });
  assert.equal(r.status?.flight?.id, 11);
});

test('no command and no active flight: the panel gets a "no job" status while waiting', async (t) => {
  const url = await flightsStub(t, { list: [] });
  const home = configured(url);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const r = await runUntil(t, [], { home, until: until(/waiting for a job accepted in the web app/) });
  assert.equal(r.status?.flight, null);
  assert.equal(r.code, 0);
});

test('no command and never set up: runs setup interactively, then follows the flight', async (t) => {
  const url = await flightsStub(t, { list: [{ id: 7, acceptedAt: 1_000, origin: 'LFPN', destination: 'LFAQ' }] });
  const r = await runUntil(t, [], { answers: [[/Server URL/, `${url}\n`], [/API key/, `${KEY}\n`]], until: until(/flight 7: LFPN -> LFAQ/) });
  assert.match(r.out, /key accepted, 1 active flight/);
  assert.ok(!r.out.includes(KEY));
  assert.equal(statSync(join(r.home, 'openpilotcareer', 'config.json')).mode & 0o777, 0o600);
});

test('`fly` still needs an explicit flight id', async (t) => {
  const r = await run(t, ['fly']);
  assert.equal(r.code, 1);
  assert.match(r.out, /fly needs a flight id/);
});
