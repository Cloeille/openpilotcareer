import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ServerClient } from '../src/client.ts';
import { readSamples } from '../src/fixture.ts';
import { Outbox } from '../src/outbox.ts';
import { Session, type FlightInfo } from '../src/session.ts';
import { serveStatus } from '../src/status.ts';
import { PHASES } from '../src/types.ts';

// The panel contract from the brief, written independently of Status so a drift in either shows up here.
const statusContract = z.strictObject({
  phase: z.enum(PHASES),
  flight: z.strictObject({ id: z.number(), from: z.string(), to: z.string(), aircraftIcao: z.string() }).nullable(),
  verification: z.enum(['pending', 'verified', 'rejected']).nullable(),
  reason: z.string().optional(),
  flags: z.array(z.string()),
  serverUrl: z.string(),
});
// What GET /status really serves: the panel contract above plus the fields the web app reads (v2 contract, lot LIVE).
const servedContract = statusContract.extend({ sim: z.enum(['connected', 'waiting', 'unavailable']), version: z.string().min(1) }).strict();

const flight: FlightInfo = { id: 7, from: 'LFPN', to: 'LFAQ', aircraftIcao: 'C172' };
const fixture = (n: string) => readSamples(fileURLToPath(new URL(`../fixtures/${n}.json`, import.meta.url)));
async function stub(t: { after: (f: () => void) => void }, answer: () => { status: number; body: unknown } | 'hangup') {
  const s = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const a = answer();
      if (a === 'hangup') return req.socket.destroy();
      res.writeHead(a.status, { 'content-type': 'application/json' }).end(JSON.stringify(a.body));
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
const tmp = (t: { after: (f: () => void) => void }) => { const d = mkdtempSync(join(tmpdir(), 'opc-bridge-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const make = (base: string, dir: string, extra = {}) => new Session({ flight, serverUrl: base, client: new ServerClient(base, 'opc_goodgoodgood'), outbox: new Outbox(dir), deliver: { sleep: async () => {}, ...extra } });

test('verified flight: status walks pending -> parked/verified and matches the panel contract at every step', async (t) => {
  const base = await stub(t, () => ({ status: 200, body: { verification: 'verified', reason: null, flight: {} } }));
  const s = make(base, tmp(t));
  const seen = new Set<string>();
  for (const sample of fixture('ga-c172-lfpn-lfaq')) {
    s.feed(sample);
    const st = statusContract.parse(s.status);
    seen.add(`${st.phase}/${st.verification}`);
  }
  await s.done;
  const end = statusContract.parse(s.status);
  assert.deepEqual([end.phase, end.verification, end.reason, end.flags], ['parked', 'verified', undefined, []]);
  assert.deepEqual(end.flight, flight);
  assert.ok(seen.has('preflight/null') && seen.has('airborne/pending') && seen.has('parked/pending'), [...seen].join(' '));
});

/** True when `p` has not settled yet (a settled promise wins the race against a macrotask tick). */
const pending = async (p: Promise<void>): Promise<boolean> => (await Promise.race([p.then(() => false), new Promise<boolean>((r) => setImmediate(() => r(true)))]));

test('done is not resolved by starting: no verdict before the aircraft is parked, then it resolves with the verdict', async (t) => {
  const base = await stub(t, () => ({ status: 200, body: { verification: 'verified', reason: null, flight: {} } }));
  const s = make(base, tmp(t));
  assert.equal(await pending(s.done), true, 'fresh session: nothing has happened yet');
  const samples = fixture('ga-c172-lfpn-lfaq');
  const parkedAt = samples.findIndex((_, i) => { s.feed(samples[i]!); return s.status.phase === 'parked'; });
  assert.ok(parkedAt > 0);
  await s.done;
  assert.equal(s.status.verification, 'verified');
});

test('done stays pending while the flight is being flown (preflight, taxi, airborne)', async (t) => {
  const base = await stub(t, () => ({ status: 200, body: { verification: 'verified', reason: null, flight: {} } }));
  const s = make(base, tmp(t));
  for (const sample of fixture('ga-c172-lfpn-lfaq')) {
    if (s.status.phase === 'parked') break;
    s.feed(sample);
    if (s.status.phase === 'airborne') break;
  }
  assert.equal(s.status.phase, 'airborne');
  assert.equal(await pending(s.done), true);
});

test('a recording that ends before the aircraft parks: end() says nothing will be reported, and done resolves', async (t) => {
  let posts = 0;
  const base = await stub(t, () => { posts++; return { status: 200, body: { verification: 'verified', reason: null } }; });
  const s = make(base, tmp(t));
  for (const sample of fixture('ga-c172-lfpn-lfaq').slice(0, 120)) s.feed(sample);
  assert.equal(await pending(s.done), true);
  s.end();
  await s.done;
  assert.equal(posts, 0);
  assert.equal(s.status.verification, 'pending');
});

test('end() does not cut short a report that is being delivered: done resolves with the verdict', async (t) => {
  const base = await stub(t, () => ({ status: 200, body: { verification: 'verified', reason: null, flight: {} } }));
  const s = make(base, tmp(t));
  for (const sample of fixture('ga-c172-lfpn-lfaq')) s.feed(sample);
  s.end();
  await s.done;
  assert.equal(s.status.verification, 'verified');
});

test('cheat flight: flags show while flying, the server rejection reason reaches the panel', async (t) => {
  const reason = 'the simulator client flagged this flight: time_acceleration_above_1x';
  const base = await stub(t, () => ({ status: 200, body: { verification: 'rejected', reason, flight: {} } }));
  const s = make(base, tmp(t));
  let flagsWhileFlying: string[] = [];
  for (const sample of fixture('cheat-simrate4x-c172-lfpn-lfaq')) {
    s.feed(sample);
    if (s.status.phase === 'airborne' && s.status.flags.length) flagsWhileFlying = s.status.flags;
  }
  await s.done;
  assert.deepEqual(flagsWhileFlying, ['time_acceleration_above_1x']);
  assert.deepEqual([s.status.verification, s.status.reason, s.status.flags], ['rejected', reason, ['time_acceleration_above_1x']]);
});

test('server unreachable: status says why and stays pending; the report is on disk', async (t) => {
  const dir = tmp(t);
  const base = await stub(t, () => 'hangup');
  const s = make(base, dir, { maxAttempts: 2 });
  for (const sample of fixture('ga-c172-lfpn-lfaq')) s.feed(sample);
  await s.done;
  assert.equal(s.status.verification, 'pending');
  assert.match(s.status.reason ?? '', /cannot reach/);
  assert.equal(new Outbox(dir).list(base).length, 1);
});

test('a flight with nothing reportable is shown as rejected locally and never sent', async (t) => {
  let posts = 0;
  const base = await stub(t, () => { posts++; return { status: 200, body: { verification: 'verified', reason: null } }; });
  const s = make(base, tmp(t));
  for (const sample of fixture('ga-c172-lfpn-lfaq').map((x) => ({ ...x, lon: x.lon - 40 }))) s.feed(sample);
  await s.done;
  assert.equal(posts, 0);
  assert.deepEqual([s.status.verification, s.status.phase], ['rejected', 'parked']);
  assert.match(s.status.reason ?? '', /known airport/);
});

test('status endpoint: 127.0.0.1 only, CORS for the panel, GET /status only, rejects foreign Host headers', async (t) => {
  const s = make('http://127.0.0.1:1', tmp(t));
  const server = await serveStatus(() => s.status, 0);
  t.after(() => server.close());
  const addr = server.address() as { address: string; port: number };
  assert.equal(addr.address, '127.0.0.1');
  const url = `http://127.0.0.1:${addr.port}`;
  const res = await fetch(`${url}/status`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(servedContract.parse(await res.json()), { phase: 'preflight', flight, verification: null, flags: [], serverUrl: 'http://127.0.0.1:1', sim: 'waiting', version: '0.1.0' });
  assert.equal((await fetch(`${url}/status`, { method: 'OPTIONS' })).status, 204);
  assert.equal((await fetch(`${url}/status`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${url}/other`)).status, 404);
  const rebinding = await new Promise<number>((resolve, reject) => {
    import('node:http').then(({ request }) => request({ host: '127.0.0.1', port: addr.port, path: '/status', headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode!); }).on('error', reject).end());
  });
  assert.equal(rebinding, 403);
  await assert.rejects(serveStatus(() => s.status, addr.port), /in use/);
});

test('status endpoint: sim follows the simulator link and version is the bridge package version', async (t) => {
  const s = make('http://127.0.0.1:1', tmp(t));
  let link: 'connected' | 'waiting' | 'unavailable' = 'unavailable';
  const server = await serveStatus(() => s.status, 0, { sim: () => link, version: '9.9.9' });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/status`;
  assert.deepEqual(await fetch(url).then((r) => r.json()).then((b) => [b.sim, b.version]), ['unavailable', '9.9.9']);
  link = 'connected';
  assert.equal((await fetch(url).then((r) => r.json())).sim, 'connected');
  // the panel contract fields are all still there, unchanged
  assert.deepEqual(statusContract.parse(await fetch(url).then((r) => r.json()).then(({ sim: _s, version: _v, ...rest }) => rest)).phase, 'preflight');
});
