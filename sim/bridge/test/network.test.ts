import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Telemetry } from '@opc/shared';
import { ApiError, ServerClient } from '../src/client.ts';
import { loadConfig, normalizeServerUrl, saveConfig, sendsKeyInClear } from '../src/config.ts';
import { backoffMs, deliver, flushOutbox } from '../src/deliver.ts';
import { Outbox } from '../src/outbox.ts';

const report: Telemetry = {
  takeoffAt: '2026-11-04T10:00:00Z', landedAt: '2026-11-04T11:00:00Z', departureIcao: 'LFPN', arrivalIcao: 'LFAQ', aircraftIcao: 'C172',
  payloadKg: 300, fuelUsedKg: 20, landingFpm: -180, distanceNm: 77, source: 'simconnect',
};
const tmp = (t: { after: (f: () => void) => void }): string => {
  const d = mkdtempSync(join(tmpdir(), 'opc-bridge-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
type Handler = (method: string, url: string, auth: string | undefined, body: string) => { status: number; body?: unknown; raw?: string } | 'hangup';
async function fakeServer(t: { after: (f: () => void) => void }, handler: Handler): Promise<string> {
  const s: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = handler(req.method!, req.url!, req.headers.authorization, body);
      if (r === 'hangup') return req.socket.destroy();
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(r.raw ?? JSON.stringify(r.body ?? null));
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
const noSleep = async () => {};

test('config: written owner-only, round-trips, refuses a group/world-readable file and bad input', (t) => {
  const dir = tmp(t);
  assert.equal(loadConfig(dir), null);
  saveConfig(dir, { serverUrl: 'http://127.0.0.1:8080', apiKey: 'opc_secretsecret' });
  assert.deepEqual(loadConfig(dir), { serverUrl: 'http://127.0.0.1:8080', apiKey: 'opc_secretsecret' });
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(dir, 'config.json')).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    chmodSync(join(dir, 'config.json'), 0o644);
    assert.throws(() => loadConfig(dir), /readable by other users/);
  }
  assert.throws(() => saveConfig(dir, { serverUrl: 'ftp://x', apiKey: 'opc_secretsecret' }));
  assert.throws(() => saveConfig(dir, { serverUrl: 'http://x.test', apiKey: 'short' }));
  assert.equal(normalizeServerUrl('https://Example.org:8443//'), 'https://example.org:8443');
  assert.throws(() => normalizeServerUrl('file:///etc/passwd'));
  assert.equal(sendsKeyInClear('http://example.org'), true);
  assert.equal(sendsKeyInClear('http://127.0.0.1:8080'), false);
  assert.equal(sendsKeyInClear('https://example.org'), false);
});

test('client: validates every response, sends the key only in the header, maps errors', async (t) => {
  const seen: { url: string; auth: string | undefined; body: string }[] = [];
  const base = await fakeServer(t, (m, url, auth, body) => {
    seen.push({ url, auth, body });
    if (url === '/api/v1/info') return { status: 200, body: { name: 'Test', version: '0.1.0', apiVersion: 1, registrationOpen: true } };
    if (url === '/api/v1/flights/active') return auth === 'Bearer opc_goodgoodgood'
      ? { status: 200, body: [{ id: 7, status: 'active', aircraftIcao: 'C172', acceptedAt: 1, job: { origin: 'LFPN', destination: 'LFAQ', distanceNm: 77, payloadKg: 300, extra: 1 }, extra: 'ignored' }] }
      : { status: 401, body: { error: 'unauthorized', message: 'missing or invalid API key' } };
    if (url === '/api/v1/flights/7/telemetry-verify') return { status: 200, body: { verification: 'verified', reason: null, flight: {} } };
    if (url === '/api/v1/flights/8/telemetry-verify') return { status: 200, body: { verification: 'maybe' } };
    if (url === '/api/v1/flights/9/telemetry-verify') return { status: 500, raw: '<html>boom</html>' };
    return { status: 404, body: { error: 'not_found', message: 'not found' } };
  });
  const c = new ServerClient(base, 'opc_goodgoodgood');
  assert.equal((await c.info()).apiVersion, 1);
  const flights = await c.activeFlights();
  assert.deepEqual(flights.map((f) => [f.id, f.aircraftIcao, f.job.origin]), [[7, 'C172', 'LFPN']]);
  assert.deepEqual(await c.verify(7, report), { verification: 'verified', reason: null });
  assert.equal(seen.find((s) => s.url === '/api/v1/info')?.auth, undefined, 'info is public: no key sent');
  assert.ok(seen.every((s) => !s.url.includes('opc_good') && !s.body.includes('opc_good')), 'key never in URL or body');
  assert.equal(JSON.parse(seen.find((s) => s.url.endsWith('/7/telemetry-verify'))!.body).source, 'simconnect');

  await assert.rejects(new ServerClient(base, 'opc_wrongwrong').activeFlights(), (e: ApiError) => e.kind === 'refused' && e.status === 401 && e.code === 'unauthorized');
  await assert.rejects(c.verify(8, report), (e: ApiError) => e.kind === 'protocol' && !e.retryable);
  await assert.rejects(c.verify(9, report), (e: ApiError) => e.kind === 'server' && e.retryable && /500/.test(e.message));
  await assert.rejects(new ServerClient('http://127.0.0.1:1', 'opc_goodgoodgood').info(), (e: ApiError) => e.kind === 'network' && e.retryable && !e.message.includes('opc_good'));
});

test('client: a 2xx body that is not the documented shape is a protocol error, never a crash or a trusted value', async (t) => {
  const base = await fakeServer(t, (_m, url) => url === '/api/v1/info' ? { status: 200, body: { name: 1 } } : { status: 200, body: [{ id: -3 }] });
  const c = new ServerClient(base, 'opc_goodgoodgood');
  await assert.rejects(c.info(), (e: ApiError) => e.kind === 'protocol');
  await assert.rejects(c.activeFlights(), (e: ApiError) => e.kind === 'protocol');
});

test('outbox: put is idempotent, list is per server and ordered, corrupt files are set aside', (t) => {
  const dir = tmp(t);
  const ob = new Outbox(dir);
  ob.put({ serverUrl: 'http://a.test', flightId: 1, report, queuedAt: 2 });
  ob.put({ serverUrl: 'http://a.test', flightId: 1, report, queuedAt: 2 });
  ob.put({ serverUrl: 'http://a.test', flightId: 2, report, queuedAt: 1 });
  ob.put({ serverUrl: 'http://b.test', flightId: 1, report, queuedAt: 0 });
  assert.deepEqual(ob.list('http://a.test').map((p) => p.flightId), [2, 1]);
  writeFileSync(join(dir, 'outbox', 'junk.json'), '{not json');
  assert.equal(ob.list('http://a.test').length, 2);
  assert.ok(readdirSync(join(dir, 'outbox')).includes('junk.json.corrupt'));
  ob.remove('http://a.test', 1);
  ob.remove('http://a.test', 1);
  assert.deepEqual(ob.list('http://a.test').map((p) => p.flightId), [2]);
});

test('deliver: server down -> stays on disk, backs off, then delivers once it is back, exactly one accepted post', async (t) => {
  const dir = tmp(t);
  const ob = new Outbox(dir);
  let calls = 0, accepted = 0;
  const base = await fakeServer(t, () => {
    calls++;
    if (calls <= 3) return calls === 1 ? 'hangup' : { status: 503, body: { error: 'down', message: 'maintenance' } };
    accepted++;
    return { status: 200, body: { verification: 'verified', reason: null } };
  });
  const waits: number[] = [];
  const c = new ServerClient(base, 'opc_goodgoodgood');
  const r = await deliver(c, ob, { serverUrl: base, flightId: 5, report, queuedAt: 1 }, { sleep: async (ms) => { waits.push(ms); assert.equal(ob.list(base).length, 1, 'report is on disk while retrying'); }, });
  assert.deepEqual(r, { state: 'verified', reason: null });
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(accepted, 1);
  assert.equal(ob.list(base).length, 0);
});

test('deliver: gives up for now but keeps the report; a later flush sends it; an already-closed flight is cleared', async (t) => {
  const dir = tmp(t);
  const ob = new Outbox(dir);
  let up = false;
  const base = await fakeServer(t, (_m, url) => (up ? (url.includes('/6/') ? { status: 409, body: { error: 'flight_closed', message: 'flight is already verified' } } : { status: 200, body: { verification: 'rejected', reason: 'arrival EGLL does not match job destination LFAQ' } }) : 'hangup'));
  const c = new ServerClient(base, 'opc_goodgoodgood');
  const r = await deliver(c, ob, { serverUrl: base, flightId: 5, report, queuedAt: 1 }, { maxAttempts: 2, sleep: noSleep });
  assert.equal(r.state, 'queued');
  await deliver(c, ob, { serverUrl: base, flightId: 6, report, queuedAt: 2 }, { maxAttempts: 1, sleep: noSleep });
  assert.equal(ob.list(base).length, 2);
  up = true;
  const flushed = await flushOutbox(c, ob, base, { sleep: noSleep });
  assert.deepEqual(flushed.map((d) => d.state).sort(), ['closed', 'rejected']);
  assert.equal(ob.list(base).length, 0);
});

test('deliver: 401 keeps the report for a new key; a 400 is dropped (retrying cannot help)', async (t) => {
  const dir = tmp(t);
  const ob = new Outbox(dir);
  const base = await fakeServer(t, (_m, url) => (url.includes('/1/') ? { status: 401, body: { error: 'unauthorized', message: 'missing or invalid API key' } } : { status: 400, body: { error: 'invalid_request', message: 'bad' } }));
  const c = new ServerClient(base, 'opc_goodgoodgood');
  const a = await deliver(c, ob, { serverUrl: base, flightId: 1, report, queuedAt: 1 }, { sleep: noSleep });
  assert.equal(a.state, 'queued');
  assert.match(a.reason ?? '', /opc-bridge setup/);
  const b = await deliver(c, ob, { serverUrl: base, flightId: 2, report, queuedAt: 2 }, { sleep: noSleep });
  assert.equal(b.state, 'dropped');
  assert.deepEqual(ob.list(base).map((p) => p.flightId), [1]);
});

test('backoff doubles and is capped', () => {
  assert.deepEqual([0, 1, 2, 3].map(backoffMs), [1000, 2000, 4000, 8000]);
  assert.equal(backoffMs(30), 300_000);
});
