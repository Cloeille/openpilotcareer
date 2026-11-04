#!/usr/bin/env node
// End-to-end smoke test: starts a real server (temp database, free port) and drives it over HTTP exactly like the web app
// and a simulator client would. Exits non-zero on the first failed step.   Usage: node scripts/smoke.mjs
//
// The server runs under scripts/warp-clock.mjs (server clock x600) so a short flight "takes" seconds instead of an hour.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuelBurnKg } from '@opc/shared';

const HOUR = 3_600_000;
const WARP = 600;
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

let step = 0;
let server;
const done = (code) => { server?.kill(); process.exit(code); };
const ok = (msg) => console.log(`ok ${String(++step).padStart(2)}  ${msg}`);
const fail = (msg, detail) => { console.error(`FAIL    ${msg}${detail === undefined ? '' : `\n        ${JSON.stringify(detail).slice(0, 600)}`}`); done(1); };
const expect = (cond, msg, detail) => (cond ? ok(msg) : fail(msg, detail));

const port = await new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const t0 = Date.now();
const serverNow = () => t0 + (Date.now() - t0) * WARP;
const sleepUntil = (serverMs) => new Promise((r) => setTimeout(r, Math.max(0, (serverMs - serverNow()) / WARP)));
const dir = mkdtempSync(join(tmpdir(), 'opc-smoke-'));
server = spawn(process.execPath, ['--import', here('./warp-clock.mjs'), here('../packages/server/src/index.ts')], {
  env: { ...process.env, OPC_DB: join(dir, 'smoke.sqlite'), OPC_PORT: String(port), OPC_HOST: '127.0.0.1', OPC_WARP: String(WARP), OPC_WARP_T0: String(t0) },
  stdio: ['ignore', 'inherit', 'inherit'],
});
server.on('exit', (code) => { if (code) { console.error(`server exited with ${code}`); process.exit(1); } });
process.on('exit', () => { server.kill(); rmSync(dir, { recursive: true, force: true }); });

const base = `http://127.0.0.1:${port}`;
const api = `${base}/api/v1`;
async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return raw ? { status: res.status, text, headers: res.headers } : { status: res.status, body: text ? JSON.parse(text) : null };
}
for (let i = 0; ; i++) {
  if (await fetch(`${api}/info`).then((r) => r.ok, () => false)) break;
  if (i > 100) fail('server did not start');
  await new Promise((r) => setTimeout(r, 100));
}

const info = await call('GET', '/info');
expect(info.status === 200 && info.body.apiVersion === 1, `server up on ${base}: ${info.body.name} v${info.body.version}, registration ${info.body.registrationOpen ? 'open' : 'closed'}`, info);

// --- account
const username = `smoke${Date.now().toString(36)}`;
const password = 'smoke-test-password';
const reg = await call('POST', '/auth/register', { body: { username, password, hub: 'LFPG' } });
expect(reg.status === 201, `registered ${username}: rank ${reg.body.rank}, balance ${reg.body.company.balance}, ${reg.body.fleet[0].icao} at ${reg.body.fleet[0].location}`, reg);
const token = reg.body.token;
const plane = reg.body.fleet[0];
const t = plane.type;
const canFly = (j) => (j.kind === 'pax' ? j.pax <= t.seats : j.payloadKg <= t.cargoKg) && j.distanceNm <= t.rangeNm;

// --- job board: shared, deterministic
const jobs = (await call('GET', '/jobs?airport=LFPG', { token })).body.jobs;
const again = (await call('GET', '/jobs?airport=LFPG', { token })).body.jobs;
expect(jobs.length > 0 && JSON.stringify(jobs) === JSON.stringify(again), `LFPG board lists ${jobs.length} jobs, identical on a second request`);
const flyable = jobs.filter(canFly).sort((a, b) => a.distanceNm - b.distanceNm);
expect(flyable.length >= 2, `${flyable.length} of them can be flown by a ${plane.icao}`);
const [first, second] = [flyable.at(-1), flyable[0]];

// --- accept; a rival cannot take the same job
const acc = await call('POST', `/jobs/${first.id}/accept`, { token, body: { aircraftId: plane.id } });
expect(acc.status === 201 && acc.body.status === 'active', `accepted ${first.origin}-${first.destination} (${first.distanceNm} nm, pays ${first.payout}) -> flight ${acc.body.id} active`, acc);
const rival = await call('POST', '/auth/register', { body: { username: `${username}r`, password, hub: 'LFPG' } });
const steal = await call('POST', `/jobs/${first.id}/accept`, { token: rival.body.token, body: { aircraftId: rival.body.fleet[0].id } });
expect(steal.status === 409 && steal.body.error === 'job_taken', `a second pilot cannot take the same job (${steal.status} ${steal.body.error})`, steal);
const boardAfter = (await call('GET', '/jobs?airport=LFPG', { token: rival.body.token })).body.jobs;
expect(!boardAfter.some((j) => j.id === first.id), 'the taken job is gone from the shared board for everyone');

// --- verification through a per-user API key
const key = await call('POST', '/me/api-keys', { token, body: { label: 'smoke' } });
expect(key.status === 201 && key.body.key.startsWith('opc_'), 'API key created (plaintext shown once)', key);
const apiKey = key.body.key;
expect((await call('POST', `/flights/${acc.body.id}/telemetry-verify`, { token, body: {} })).status === 401, 'a session token is not accepted as an API key');
const active = await call('GET', '/flights/active', { token: apiKey });
expect(active.body.length === 1 && active.body[0].id === acc.body.id, 'the key lists the active flight to report on', active);

const reportFor = (job, takeoffMs) => {
  const hours = job.distanceNm / t.cruiseKts + 0.1;
  return {
    takeoffAt: new Date(takeoffMs).toISOString(), landedAt: new Date(takeoffMs + hours * HOUR).toISOString(), departureIcao: job.origin,
    arrivalIcao: job.destination, aircraftIcao: plane.icao, payloadKg: job.payloadKg, fuelUsedKg: Math.round(fuelBurnKg(t, job.distanceNm)),
    landingFpm: -190, distanceNm: job.distanceNm + 3, source: 'simconnect', hours,
  };
};
const strip = ({ hours, ...r }) => r;
const forged = { ...strip(reportFor(first, serverNow())), arrivalIcao: 'KJFK' };
const bad = await call('POST', `/flights/${acc.body.id}/telemetry-verify`, { token: apiKey, body: forged });
expect(bad.status === 200 && bad.body.verification === 'rejected', `forged report (wrong arrival airport) is REJECTED: "${bad.body.reason}"`, bad);
expect((await call('POST', `/flights/${acc.body.id}/telemetry-verify`, { token: apiKey, body: forged })).status === 409, 'a rejected flight is closed: no second attempt');

// the real flight: the shortest flyable job, flown for (server-clock) time, then reported
const acc2 = await call('POST', `/jobs/${second.id}/accept`, { token, body: { aircraftId: plane.id } });
expect(acc2.status === 201, `accepted ${second.origin}-${second.destination} (${second.distanceNm} nm, pays ${second.payout}) -> flight ${acc2.body.id}`, acc2);
const early = await call('POST', `/flights/${acc2.body.id}/complete`, { token });
expect(early.status === 409 && early.body.error === 'too_early', `manual completion before the flight could be flown is refused (${early.body.error})`, early);
const takeoff = serverNow() + 60_000;
const report = reportFor(second, takeoff);
console.log(`        flying ${report.hours.toFixed(2)} h of server time (about ${((report.hours * HOUR) / WARP / 1000).toFixed(1)} s real)...`);
await sleepUntil(Date.parse(report.landedAt) + 60_000);
const before = (await call('GET', '/me', { token })).body.company;
const ver = await call('POST', `/flights/${acc2.body.id}/telemetry-verify`, { token: apiKey, body: strip(report) });
const f = ver.body.flight;
expect(ver.status === 200 && ver.body.verification === 'verified',
  `telemetry accepted -> ${ver.body.verification.toUpperCase()}: revenue ${f.revenue} - fuel ${f.fuelCost} - landing ${f.landingFee} - maintenance ${f.maintenance} = net ${f.net}`, ver);
const me = (await call('GET', '/me', { token })).body;
expect(me.company.balance === before.balance + f.net && f.net !== 0, `balance ${before.balance} -> ${me.company.balance} (${f.net >= 0 ? '+' : ''}${f.net} = flight net)`, me.company);
expect(me.company.flights === 1 && me.company.hours > 0 && me.company.reputation > before.reputation && me.fleet[0].location === second.destination,
  `profile updated: ${me.company.flights} flight, ${me.company.hours} h, reputation ${before.reputation} -> ${me.company.reputation}, aircraft now at ${me.fleet[0].location}`, me);
const flights = (await call('GET', '/me/flights', { token })).body;
expect(flights.map((x) => x.status).join() === 'verified,rejected', `flight history: ${flights.map((x) => `${x.job.origin}-${x.job.destination} ${x.status}`).join(', ')}`, flights);
const ledger = (await call('GET', '/me/transactions?limit=200', { token })).body;
expect(ledger.reduce((s, x) => s + x.amount, 0) === me.company.balance, `ledger (${ledger.length} lines) sums to the balance`);
expect((await call('DELETE', `/me/api-keys/${key.body.id}`, { token })).status === 204 && (await call('GET', '/flights/active', { token: apiKey })).status === 401, 'revoking the key stops it working immediately');

// --- AI companies on the same server
const lb = (await call('GET', '/leaderboard')).body;
const ais = lb.rows.filter((r) => r.isAI);
const mine = lb.rows.find((r) => r.name === me.company.name);
expect(ais.length >= 5 && mine, `leaderboard ${lb.season}: ${ais.length} AI companies + ${lb.rows.length - ais.length} human companies; you are #${mine?.rank}`, lb);
for (const r of lb.rows.slice(0, 5)) console.log(`        #${r.rank} ${r.name.padEnd(20)} ${r.isAI ? 'AI   ' : 'human'} net worth ${String(r.netWorth).padStart(9)}  flights ${String(r.flights).padStart(4)}  rep ${r.reputation}`);
const prof = (await call('GET', `/companies/${ais[0].companyId}`)).body;
expect(prof.personality?.style && prof.fleet.length > 0, `${prof.name}: ${prof.personality.style}, hub ${prof.hubs.join('/')}, fleet ${prof.fleet.map((x) => `${x.count}x${x.icao}`).join(' ')}, ${prof.flights} lifetime flights`, prof);
expect(JSON.stringify(boardAfter.map((j) => j.id)) !== '[]' && (await call('GET', '/jobs?airport=EGLL', { token })).body.jobs.length > 0, 'AI hubs have their own shared boards');

// --- export
const exp = await call('GET', '/me/export', { token, raw: true });
const doc = JSON.parse(exp.text);
expect(exp.status === 200 && doc.schemaVersion === 1 && doc.flights.length === 2 && doc.transactions.length === ledger.length && doc.profile.username === username && doc.flights[0].telemetry.source === 'simconnect',
  `export JSON: schemaVersion ${doc.schemaVersion}, profile+company+${doc.hubs.length} hub+${doc.fleet.length} aircraft+${doc.flights.length} flights+${doc.transactions.length} transactions (${exp.text.length} bytes)`);
expect(!/pass_hash|key_hash|opc_/.test(exp.text), 'the export contains no credentials');
const fcsv = await call('GET', '/me/export?format=flights.csv', { token, raw: true });
expect(fcsv.status === 200 && fcsv.text.trim().split('\r\n').length === 3 && /^text\/csv/.test(fcsv.headers.get('content-type')), 'flights.csv: header + 2 rows');
const tcsv = await call('GET', '/me/export?format=transactions.csv', { token, raw: true });
expect(tcsv.status === 200 && tcsv.text.trim().split('\r\n').length === ledger.length + 1, `transactions.csv: header + ${ledger.length} rows`);

// --- delete
expect((await call('DELETE', '/me', { token, body: { password: 'not the password' } })).status === 403, 'account deletion with a wrong password is refused');
expect((await call('DELETE', '/me', { token, body: { password } })).status === 204, 'account deleted with the right password');
expect((await call('GET', '/me', { token })).status === 401 && (await call('POST', '/auth/login', { body: { username, password } })).status === 401, 'the deleted account can no longer sign in');
await call('DELETE', '/me', { token: rival.body.token, body: { password } });

console.log(`\nSMOKE PASS (${step} checks)`);
done(0);
