import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const fixture = (n: string) => fileURLToPath(new URL(`../fixtures/${n}.json`, import.meta.url));
const KEY = 'opc_testkey-0123456789';

type Ctx = { after: (f: () => void) => void };
/** A server that knows one active flight (LFPN -> LFAQ, C172, id 7) and answers every report with `verdict`. `antiCheat` is left out of /info unless given (older servers). */
async function stub(t: Ctx, verdict: { verification: string; reason: string | null }, antiCheat?: boolean) {
  const seen: { auth: string | undefined; body: unknown }[] = [];
  const s = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (req.url === '/api/v1/info') return json(200, { name: 'Stub', version: '0', apiVersion: 1, registrationOpen: true, ...(antiCheat === undefined ? {} : { antiCheat }) });
      if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: 'unauthorized', message: 'bad key' });
      if (req.url === '/api/v1/flights/active') return json(200, [{ id: 7, aircraftIcao: 'C172', acceptedAt: Date.now() - 60_000, job: { origin: 'LFPN', destination: 'LFAQ', distanceNm: 50, payloadKg: 100 } }]);
      if (req.method === 'POST' && req.url === '/api/v1/flights/7/telemetry-verify') { seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) }); return json(200, verdict); }
      json(404, { error: 'not_found', message: 'not found' });
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
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
