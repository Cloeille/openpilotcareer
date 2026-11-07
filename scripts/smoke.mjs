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
// The server's clock starts one minute into a 6 h job-board window (a window lasts 36 real seconds at x600): the board listed at the start
// of the run is still the current one when its jobs are accepted. Starting at a random point let a run cross a window boundary in between,
// and a job of a refreshed board is correctly refused (404 job_not_found), which showed up as \"accepted ... -> flight undefined\".
const realStart = Date.now();
const t0 = Math.floor(realStart / (6 * HOUR)) * 6 * HOUR + 60_000;
const serverNow = () => t0 + (Date.now() - realStart) * WARP;
const sleepUntil = (serverMs) => new Promise((r) => setTimeout(r, Math.max(0, (serverMs - serverNow()) / WARP)));
const dir = mkdtempSync(join(tmpdir(), 'opc-smoke-'));
server = spawn(process.execPath, ['--import', here('./warp-clock.mjs'), here('../packages/server/src/index.ts')], {
  env: { ...process.env, OPC_DB: join(dir, 'smoke.sqlite'), OPC_PORT: String(port), OPC_HOST: '127.0.0.1', OPC_WARP: String(WARP), OPC_WARP_T0: String(t0), OPC_WARP_REAL_T0: String(realStart) },
  stdio: ['ignore', 'inherit', 'inherit'],
});
server.on('exit', (code) => { if (code) { console.error(`server exited with ${code}`); process.exit(1); } });
process.on('exit', () => { server.kill(); rmSync(dir, { recursive: true, force: true }); });

const base = `http://127.0.0.1:${port}`;
const api = `${base}/api/v1`;
async function call(method, path, { token, body, raw, company } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { ...(company === undefined ? {} : { 'x-opc-company': String(company) }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
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
expect(info.status === 200 && info.body.apiVersion === 1 && info.body.antiCheat === true, `server up on ${base}: ${info.body.name} v${info.body.version}, registration ${info.body.registrationOpen ? 'open' : 'closed'}, anti-cheat ${info.body.antiCheat ? 'on' : 'off'}`, info);

// --- account
const username = `smoke${Date.now().toString(36)}`;
const password = 'smoke-test-password';
const reg = await call('POST', '/auth/register', { body: { username, password, hub: 'LFPG' } });
expect(reg.status === 201, `registered ${username}: rank ${reg.body.pilot.rank}, balance ${reg.body.company.balance}, ${reg.body.fleet[0].icao} at ${reg.body.fleet[0].location}`, reg);
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
// --- SimBrief link: the accepted flight carries the static id of its dispatch; nothing is connected, and fetching a plan says so (no call to simbrief.com here)
expect(/^opc_\d+_[0-9a-f]{12}$/.test(acc.body.simbrief?.staticId ?? ''), 'the flight carries the static id of its SimBrief dispatch', acc.body.simbrief);
const sbNone = await call('GET', '/me/simbrief', { token });
expect(sbNone.status === 200 && sbNone.body.username === null && sbNone.body.pilotId === null, 'no SimBrief connection yet');
const sbFetch = await call('POST', `/flights/${acc.body.id}/simbrief/fetch`, { token });
expect(sbFetch.status === 409 && sbFetch.body.error === 'simbrief_not_connected', 'fetching a plan without a connection is refused plainly', sbFetch);
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

// --- a second company: create, rename, act as it, ownership
const created = await call('POST', '/me/companies', { token, body: { name: `${username} Cargo`, hub: 'EGLL' } });
expect(created.status === 201 && created.body.companies.length === 2, `second company created: ${created.body.company?.name}, ${created.body.fleet?.[0]?.icao} at ${created.body.fleet?.[0]?.location}`, created);
const cid = created.body.company.id;
expect(cid !== me.company.id && created.body.company.balance === 400_000 && created.body.hubs.join() === 'EGLL', `the new company starts from scratch (balance ${created.body.company.balance}, hubs ${created.body.hubs.join()})`, created.body.company);
const renamed = await call('PATCH', `/companies/${cid}`, { token, body: { name: `${username} Freight` } });
expect(renamed.status === 200 && renamed.body.name === `${username} Freight`, `renamed to "${renamed.body.name}"`, renamed);
expect((await call('PATCH', `/companies/${cid}`, { token, body: { name: me.company.name.toUpperCase() } })).status === 409, 'a name clash (case-insensitive) is refused with 409');
expect((await call('GET', '/me', { token, company: rival.body.company.id })).status === 403 && (await call('PATCH', `/companies/${rival.body.company.id}`, { token, body: { name: 'Hijacked' } })).status === 403, "acting as, or renaming, someone else's company is refused with 403");
const secondPlane = created.body.fleet[0];
let job2;
for (const j of (await call('GET', '/jobs?airport=EGLL', { token, company: cid })).body.jobs) if (j.distanceNm <= secondPlane.type.rangeNm && (j.kind === 'pax' ? j.pax <= secondPlane.type.seats : j.payloadKg <= secondPlane.type.cargoKg)) { job2 = j; break; }
const acc3 = await call('POST', `/jobs/${job2.id}/accept`, { token, company: cid, body: { aircraftId: secondPlane.id } });
expect(acc3.status === 201 && acc3.body.companyId === cid, `the second company accepted ${job2.origin}-${job2.destination} -> flight ${acc3.body.id} (company ${acc3.body.companyId})`, acc3);
expect((await call('POST', `/flights/${acc3.body.id}/cancel`, { token, company: me.company.id })).status === 404, "the first company cannot touch the second company's flight");
const one = (await call('GET', '/me', { token, company: me.company.id })).body;
const two = (await call('GET', '/me', { token, company: cid })).body;
expect(one.company.flights === 1 && two.company.flights === 0 && one.fleet.length === 1 && two.fleet.length === 1 && two.fleet[0].busy && !one.fleet[0].busy, 'fleet, flights and stats are per company');
expect(two.pilot.flights === 1 && two.pilot.rank === one.pilot.rank, `the pilot is shared: ${two.pilot.rank}, ${two.pilot.flights} flight over both companies`);
expect((await call('POST', `/flights/${acc3.body.id}/cancel`, { token, company: cid })).status === 200, 'cancelled it again (the job returns to the board)');

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
expect(exp.status === 200 && doc.schemaVersion === 2 && doc.companies.length === 2 && doc.companies[0].flights.length === 2 && doc.companies[0].transactions.length === ledger.length && doc.profile.username === username && doc.companies[0].flights[0].telemetry.source === 'simconnect',
  `export JSON: schemaVersion ${doc.schemaVersion}, profile + ${doc.companies.length} companies (first: ${doc.companies[0].hubs.length} hub, ${doc.companies[0].fleet.length} aircraft, ${doc.companies[0].flights.length} flights, ${doc.companies[0].transactions.length} transactions; ${exp.text.length} bytes)`);
expect(!/pass_hash|key_hash|opc_[\w-]{43}/.test(exp.text), 'the export contains no credentials');
const fcsv = await call('GET', '/me/export?format=flights.csv', { token, raw: true });
expect(fcsv.status === 200 && fcsv.text.trim().split('\r\n').length === 3 && /^text\/csv/.test(fcsv.headers.get('content-type')), 'flights.csv: header + 2 rows');
const tcsv = await call('GET', '/me/export?format=transactions.csv', { token, raw: true });
expect(tcsv.status === 200 && tcsv.text.trim().split('\r\n').length === ledger.length + 1, `transactions.csv: header + ${ledger.length} rows`);

// --- v3 lines: a line flies by itself on the server clock (x600), is paid through the ledger, and can be switched off
const lp = await call('POST', '/auth/register', { body: { username: `${username}l`, password, hub: 'LFPG' } });
const lineBody = { a: 'LFPG', b: 'LFLL', freqPerDay: 4, days: Array(7).fill(true), windowStart: '00:00', windowEnd: '23:45', aircraftIds: [lp.body.fleet[0].id] };
const fc = await call('POST', '/lines/forecast', { token: lp.body.token, body: lineBody });
expect(fc.status === 200 && fc.body.valid === true && fc.body.forecast.estimated === true, `line forecast: valid, ${fc.body.forecast.seatsPerWeek} seats a week`, fc);
const made = await call('POST', '/lines', { token: lp.body.token, body: lineBody });
expect(made.status === 201 && made.body.a === 'LFLL' && made.body.b === 'LFPG', `line ${made.body.a}-${made.body.b} created, flights ${made.body.flightNos.join('-')}`, made);
// v3 staff (C11): a new company has nobody, so its line cannot fly until it has a crew. A hire starts after its notice (7 days), an interim pilot now.
const lineTok = lp.body.token;
const need = (await call('GET', '/staff', { token: lineTok })).body;
expect(need.people === 0 && need.positions > 0, `staff: ${need.positions} positions, nobody employed yet`, need);
const cand = (await call('GET', '/staff/candidates?family=pilot&base=LFPG&qual=C172', { token: lineTok })).body.candidates[0];
const hire = await call('POST', '/staff/hire', { token: lineTok, body: { candidateId: cand.id } });
expect(hire.status === 201 && hire.body.member.state === 'pending', `hired ${cand.name}: starts after the notice, premium ${hire.body.premium}`, hire);
const interim = await call('POST', '/staff/interim', { token: lineTok, body: { family: 'pilot', qual: 'C172', days: 30 } });
expect(interim.status === 201 && interim.body.member.state === 'free', `interim pilot ${interim.body.member.name} flies from now`, interim);
let flown = 0;
for (let i = 0; i < 90 && flown === 0; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const net = await call('GET', '/network', { token: lp.body.token });
  flown = net.body.today.done + net.body.flying.length;
}
const lineTx = (await call('GET', '/me/transactions', { token: lp.body.token })).body.filter((x) => x.kind.startsWith('line_'));
expect(flown > 0 && lineTx.some((x) => x.kind === 'line_revenue' && x.amount > 0), `the line flew on its own: ${lineTx.length} ledger lines (line_revenue ${lineTx.find((x) => x.kind === 'line_revenue')?.amount})`, lineTx);
const staffNow = await call('GET', `/staff/${interim.body.member.id}`, { token: lineTok });
expect(staffNow.status === 200 && staffNow.body.week.length > 0 && staffNow.body.duty.flight28d > 0, `the interim pilot's card shows the legs flown: ${staffNow.body.duty.flight28d} h in 28 days`, staffNow.body.duty);
// v3 safety: the index, tonight's crews and the journal answer the B.5 shapes (a new company with wear off has no incident to show)
const safety = await call('GET', '/safety', { token: lineTok });
expect(safety.status === 200 && safety.body.index === safety.body.parts.fatigue.points + safety.body.parts.aircraft.points + safety.body.parts.training.points && safety.body.riskCurve.length > 0, `safety index ${safety.body.index}/100, ${safety.body.today.length} flights tonight, ${safety.body.levers.length} levers`, safety);
const journal = await call('GET', '/safety/incidents', { token: lineTok });
expect(journal.status === 200 && Array.isArray(journal.body), `incident journal: ${journal.body.length} this season`, journal);
const ops = await call('GET', '/ops', { token: lp.body.token });
expect(ops.status === 200 && ops.body.enabled === true, `operations board: ${ops.body.counts.flying} flying, ${ops.body.counts.upcoming} upcoming`, ops);
// v3 facilities: the plan of the hub, the contract preview, renting a hangar (deposit booked, one more aircraft fits), the overview carrying it
const hubsView = (await call('GET', '/hubs/overview', { token: lineTok })).body;
expect(hubsView.hubs[0].icao === 'LFPG' && hubsView.hubs[0].facilities.some((f) => f.owner === 'available'), `hubs overview: ${hubsView.hubs[0].facilities.length} buildings at LFPG, ${hubsView.monthlyCost} a month`, hubsView);
const hubPlan = (await call('GET', '/hubs/LFPG/plan', { token: lineTok })).body;
const hangar = hubPlan.buildings.find((b) => b.effect === 'hangar' && b.owner === 'available');
const preview = (await call('GET', `/facilities/${hangar.facilityId}?mode=lease&level=1`, { token: lineTok })).body;
expect(preview.due.today === 2 * hangar.rent && preview.offer.purchase.price > 100 * hangar.rent, `${hangar.name}: ${hangar.rent} a month, ${preview.due.today} due at signing`, preview);
const spotsBefore = (await call('GET', '/me/hubs', { token: lineTok })).body[0].spots;
const rented = await call('POST', `/facilities/${hangar.facilityId}/lease`, { token: lineTok, body: {} });
const spotsAfter = (await call('GET', '/me/hubs', { token: lineTok })).body[0].spots;
expect(rented.status === 201 && rented.body.due === preview.due.today && spotsAfter === spotsBefore + 2, `hangar rented: ${rented.body.due} paid, parking ${spotsBefore} -> ${spotsAfter}`, rented);
expect((await call('POST', `/facilities/${hangar.facilityId}/lease`, { token: lineTok, body: {} })).body.error === 'occupied', 'the same hangar cannot be rented twice');
// v3 service: the policy table and the meal cards answer, a change is pending until tomorrow, the kitchen hall is on the plan, and the line's legs booked their service
const service = await call('GET', '/service', { token: lineTok });
expect(service.status === 200 && service.body.hauls.length === 3 && service.body.qualities.length === 3, `service: ${service.body.network.lines} line(s), satisfaction ${service.body.satisfaction.value ?? 'n/a (no cabin)'}, ${service.body.perDay.sales} sold and ${service.body.perDay.cost} spent today`, service);
const policy = await call('PUT', '/service/policy', { token: lineTok, body: { haul: 'short', item: 'snack', mode: 'free' } });
const snackCell = policy.body.hauls[0].cells.find((c) => c.item === 'snack');
expect(policy.status === 200 && snackCell.mode === 'paid' && snackCell.next === 'free', 'a policy change applies tomorrow (paid now, free next)', snackCell);
const kitchenHall = hubPlan.buildings.find((b) => b.effect === 'kitchen');
const kitchen = await call('GET', '/kitchen/LFPG', { token: lineTok });
expect(kitchen.status === 200 && kitchen.body.hall?.facilityId === kitchenHall?.facilityId && kitchen.body.provider === 'caterer', `kitchen at LFPG: hall ${kitchen.body.hall?.facilityId} on offer, a caterer serves`, kitchen);
expect((await call('PUT', '/kitchen/LFPG', { token: lineTok, body: { provider: 'own' } })).body.error === 'no_kitchen_hall', 'an own kitchen needs the hall');
const lineService = (await call('GET', '/me/transactions', { token: lp.body.token })).body.filter((x) => x.kind.startsWith('service_'));
expect(lineService.length === 0 && service.body.satisfaction.value === null, 'the smoke line flies a C172 (no cabin crew): nothing is served, nothing is booked, no satisfaction term', lineService);
const off = await call('PUT', '/network/enabled', { token: lp.body.token, body: { enabled: false } });
expect(off.body.enabled === false && (await call('GET', '/network', { token: lp.body.token })).body.enabled === false, 'the network switch turns the lines off');
await call('DELETE', '/me', { token: lp.body.token, body: { password } });

// --- delete
expect((await call('DELETE', '/me', { token, body: { password: 'not the password' } })).status === 403, 'account deletion with a wrong password is refused');
expect((await call('DELETE', '/me', { token, body: { password } })).status === 204, 'account deleted with the right password');
expect((await call('GET', '/me', { token })).status === 401 && (await call('POST', '/auth/login', { body: { username, password } })).status === 401, 'the deleted account can no longer sign in');
await call('DELETE', '/me', { token: rival.body.token, body: { password } });

console.log(`\nSMOKE PASS (${step} checks)`);
done(0);
