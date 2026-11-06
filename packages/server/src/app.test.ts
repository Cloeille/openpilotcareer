import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cannotFly, fuelBurnKg, type Job } from '@opc/shared';
import { catalogType } from './catalog.ts';
import { JOB_WINDOW_MS } from './board.ts';
import { harness } from './harness.ts';

test('GET /info describes the server; unknown routes are 404 JSON', async () => {
  const h = await harness({ name: 'Test Server', registrationOpen: false });
  const r = await h.call('GET', '/api/v1/info');
  assert.deepEqual(r.body, { name: 'Test Server', version: '0.1.0', apiVersion: 1, registrationOpen: false, antiCheat: true });
  assert.equal((await h.call('GET', '/api/v1/nope')).status, 404);
  assert.equal(r.headers['access-control-allow-origin'], '*');
});

test('registration: validation, uniqueness, closed servers; login/logout lifecycle', async () => {
  const h = await harness();
  const a = await h.register('alice');
  assert.equal(a.me.pilot.rank, 'Student Pilot');
  assert.deepEqual(a.me.companies.map((c: { id: number }) => c.id), [a.me.company.id]);
  assert.equal(a.me.company.balance, 400_000);
  assert.deepEqual(a.me.hubs, ['LFPG']);
  assert.equal(a.me.fleet[0]?.icao, 'C172');
  assert.equal(a.me.fleet[0].location, 'LFPG');

  assert.equal((await h.call('POST', '/api/v1/auth/register', { body: { username: 'ALICE', password: 'whatever123' } })).status, 409);
  assert.equal((await h.call('POST', '/api/v1/auth/register', { body: { username: 'x', password: 'whatever123' } })).status, 400);
  assert.equal((await h.call('POST', '/api/v1/auth/register', { body: { username: 'bob', password: 'short' } })).status, 400);
  assert.equal((await h.call('POST', '/api/v1/auth/register', { body: { username: 'bob', password: 'whatever123', hub: 'ZZZZ' } })).status, 422);

  assert.equal((await h.call('POST', '/api/v1/auth/login', { body: { username: 'alice', password: 'wrong' } })).status, 401);
  assert.equal((await h.call('POST', '/api/v1/auth/login', { body: { username: 'nobody', password: 'wrong' } })).status, 401);
  const login = await h.call('POST', '/api/v1/auth/login', { body: { username: 'alice', password: 'correct horse' } });
  assert.equal(login.status, 200);
  assert.equal((await h.call('GET', '/api/v1/me', { token: login.body.token })).body.username, 'alice');

  assert.equal((await h.call('GET', '/api/v1/me')).status, 401);
  assert.equal((await h.call('GET', '/api/v1/me', { token: 'garbage' })).status, 401);
  assert.equal((await h.call('POST', '/api/v1/auth/logout', { token: login.body.token })).status, 204);
  assert.equal((await h.call('GET', '/api/v1/me', { token: login.body.token })).status, 401);

  const closed = await harness({ registrationOpen: false });
  assert.equal((await closed.call('POST', '/api/v1/auth/register', { body: { username: 'carol', password: 'whatever123' } })).status, 403);
});

test('sessions expire; passwords and tokens are stored hashed', async () => {
  const h = await harness();
  const { token } = await h.register('dave');
  const row = h.db.prepare('SELECT pass_hash FROM users').get() as { pass_hash: string };
  assert.ok(!row.pass_hash.includes('correct horse'));
  assert.equal((h.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(token) as { n: number }).n, 0, 'raw token is not stored');
  h.clock.t += 31 * 24 * 3_600_000;
  assert.equal((await h.call('GET', '/api/v1/me', { token })).status, 401);
  await h.call('POST', '/api/v1/auth/login', { body: { username: 'dave', password: 'correct horse' } });
  assert.equal((h.db.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n, 1, 'expired session purged at the next login');
});

test('credential endpoints are rate limited', async () => {
  const h = await harness();
  let last = 0;
  for (let i = 0; i < 25; i++) last = (await h.call('POST', '/api/v1/auth/login', { body: { username: 'x', password: 'y' } })).status;
  assert.equal(last, 429);
});

test('job board is deterministic per airport and window, and changes between windows', async () => {
  const h = await harness();
  const { token } = await h.register();
  const a = (await h.call('GET', '/api/v1/jobs?airport=LFPG', { token })).body.jobs as Job[];
  const b = (await h.call('GET', '/api/v1/jobs?airport=LFPG', { token })).body.jobs as Job[];
  assert.ok(a.length > 5);
  assert.deepEqual(a, b);
  for (const j of a) {
    assert.equal(j.origin, 'LFPG');
    assert.notEqual(j.destination, 'LFPG');
    assert.ok(j.payout > 0 && j.distanceNm > 0 && j.payloadKg > 0);
    if (j.kind === 'pax') assert.equal(j.payloadKg, j.pax * 100);
  }
  h.clock.t += JOB_WINDOW_MS;
  const next = (await h.call('GET', '/api/v1/jobs?airport=LFPG', { token })).body.jobs as Job[];
  assert.notDeepEqual(a.map((j) => j.destination), next.map((j) => j.destination));
  assert.equal((await h.call('GET', '/api/v1/jobs?airport=lfpg', { token })).status, 400);
  assert.equal((await h.call('GET', '/api/v1/jobs?airport=ZZZZ', { token })).status, 404);
  assert.equal((await h.call('GET', '/api/v1/jobs')).status, 401);
});

test('a job can be taken once: the second company gets 409 and the job leaves the board', async () => {
  const h = await harness();
  const a = await h.register('first');
  const b = await h.register('second');
  const job = await h.flyableJob(a.token, a.me.fleet[0].id);
  const acc = await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: a.token, body: { aircraftId: a.me.fleet[0].id } });
  assert.equal(acc.status, 201, acc.text);
  assert.equal(acc.body.status, 'active');
  const other = await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: b.token, body: { aircraftId: b.me.fleet[0].id } });
  assert.equal(other.status, 409);
  assert.equal(other.body.error, 'job_taken');
  const board = (await h.call('GET', `/api/v1/jobs?airport=${job.origin}`, { token: b.token })).body.jobs as Job[];
  assert.ok(!board.some((j) => j.id === job.id));
  // the same aircraft cannot take a second job while busy
  const second = (await h.call('GET', '/api/v1/jobs', { token: a.token })).body.jobs.find((j: Job) => !cannotFly(catalogType('C172'), j));
  if (second) assert.equal((await h.call('POST', `/api/v1/jobs/${second.id}/accept`, { token: a.token, body: { aircraftId: a.me.fleet[0].id } })).status, 409);
});

test('accept validates aircraft ownership, capability, location and job id', async () => {
  const h = await harness();
  const a = await h.register('own');
  const b = await h.register('other');
  const jobs = (await h.call('GET', '/api/v1/jobs', { token: a.token })).body.jobs as Job[];
  const tooBig = jobs.find((j) => cannotFly(catalogType('C172'), j));
  assert.ok(tooBig);
  assert.equal((await h.call('POST', `/api/v1/jobs/${tooBig.id}/accept`, { token: a.token, body: { aircraftId: a.me.fleet[0].id } })).body.error, 'cannot_fly');
  assert.equal((await h.call('POST', `/api/v1/jobs/${tooBig.id}/accept`, { token: a.token, body: { aircraftId: b.me.fleet[0].id } })).status, 404, "someone else's aircraft");
  assert.equal((await h.call('POST', '/api/v1/jobs/bogus/accept', { token: a.token, body: { aircraftId: a.me.fleet[0].id } })).status, 404);
  assert.equal((await h.call('POST', '/api/v1/jobs/LFPG-1-0/accept', { token: a.token, body: { aircraftId: a.me.fleet[0].id } })).status, 404, 'other window');
  assert.equal((await h.call('POST', `/api/v1/jobs/${tooBig.id}/accept`, { token: a.token, body: {} })).status, 400);
  const far = jobs.find((j) => j.origin !== 'LFPG');
  assert.equal(far, undefined, 'jobs list only covers airports where aircraft stand');
});

test('verified telemetry pays the flight; ledger lines add up and the aircraft moves', async () => {
  const h = await harness();
  const { token, me } = await h.register('pilot');
  const key = await h.apiKey(token);
  const job = await h.flyableJob(token, me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  const before = (await h.call('GET', '/api/v1/me', { token })).body;
  const r = await h.call('POST', `/api/v1/flights/${flight.id}/telemetry-verify`, { token: key, body: h.goodReport(job) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.verification, 'verified');
  assert.equal(r.body.flight.status, 'verified');
  assert.equal(r.body.flight.revenue, job.payout);
  assert.equal(r.body.flight.net, r.body.flight.revenue - r.body.flight.fuelCost - r.body.flight.landingFee - r.body.flight.maintenance);
  const after = (await h.call('GET', '/api/v1/me', { token })).body;
  assert.equal(after.company.balance, before.company.balance + r.body.flight.net);
  assert.equal(after.company.flights, 1);
  assert.ok(after.company.hours > 0);
  assert.equal(after.fleet[0].location, job.destination);
  assert.ok(after.company.reputation > before.company.reputation);

  const tx = (await h.call('GET', '/api/v1/me/transactions', { token })).body as { amount: number; balanceAfter: number; kind: string }[];
  assert.deepEqual(tx.map((t) => t.kind).reverse(), ['grant', 'payout', 'fuel', 'landing_fee', 'maintenance']);
  assert.equal(tx.reduce((s, t) => s + t.amount, 0), after.company.balance, 'ledger sums to the balance');
  assert.equal(tx[0]!.balanceAfter, after.company.balance);

  const flights = (await h.call('GET', '/api/v1/me/flights', { token })).body;
  assert.equal(flights[0].status, 'verified');
  assert.equal((await h.call('GET', '/api/v1/me/flights?status=active', { token })).body.length, 0);
  assert.equal((await h.call('GET', '/api/v1/me/flights?status=verified', { token })).body.length, 1);
  assert.equal((await h.call('GET', '/api/v1/me/flights?status=bogus', { token })).status, 400);
  // a closed flight cannot be settled twice
  assert.equal((await h.call('POST', `/api/v1/flights/${flight.id}/telemetry-verify`, { token: key, body: h.goodReport(job) })).status, 409);
});

test('implausible telemetry is rejected with a reason: no pay, reputation penalty, job stays claimed', async () => {
  const h = await harness();
  const { token, me } = await h.register('cheat');
  const key = await h.apiKey(token);
  const job = await h.flyableJob(token, me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  const before = (await h.call('GET', '/api/v1/me', { token })).body.company;
  const bad = { ...h.goodReport(job), arrivalIcao: 'EGLL' };
  const r = await h.call('POST', `/api/v1/flights/${flight.id}/telemetry-verify`, { token: key, body: bad });
  assert.equal(r.status, 200);
  assert.equal(r.body.verification, 'rejected');
  assert.match(r.body.reason, /arrival/);
  assert.equal(r.body.flight.status, 'rejected');
  const after = (await h.call('GET', '/api/v1/me', { token })).body.company;
  assert.equal(after.balance, before.balance);
  assert.ok(after.reputation < before.reputation);
  assert.equal((await h.call('GET', `/api/v1/jobs?airport=${job.origin}`, { token })).body.jobs.some((j: Job) => j.id === job.id), false);
});

test('telemetry carrying client anti-cheat flags is rejected with the flags in the reason', async () => {
  const h = await harness();
  const { token, me } = await h.register('flagged');
  const key = await h.apiKey(token);
  const job = await h.flyableJob(token, me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  const r = await h.call('POST', `/api/v1/flights/${flight.id}/telemetry-verify`, { token: key, body: { ...h.goodReport(job), flags: ['slew_detected'] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.verification, 'rejected');
  assert.match(r.body.reason, /flagged.*slew_detected/);
});

test('a server with anti-cheat off says so, pays flagged and too-fast flights in full, but still ties the report to the job', async () => {
  const h = await harness({ antiCheat: false });
  assert.equal((await h.call('GET', '/api/v1/info')).body.antiCheat, false);
  const { token, me } = await h.register('casual');
  const key = await h.apiKey(token);
  const flyable = async () => {
    const job = await h.flyableJob(token, me.fleet[0].id);
    const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
    return { job, flight, url: `/api/v1/flights/${flight.id}/telemetry-verify` };
  };
  const a = await flyable();
  const cheat = { ...h.goodReport(a.job), flags: ['time_acceleration_above_1x'], fuelUsedKg: 1, landingFpm: -3000 };
  const ok = await h.call('POST', a.url, { token: key, body: cheat });
  assert.equal(ok.body.verification, 'verified', ok.text);
  assert.equal(ok.body.flight.revenue, a.job.payout);
  const stored = JSON.parse((h.db.prepare('SELECT telemetry FROM flights WHERE id = ?').get(a.flight.id) as { telemetry: string }).telemetry);
  assert.deepEqual(stored.flags, ['time_acceleration_above_1x'], 'flags are still recorded');

  const b = await flyable();
  const wrong = await h.call('POST', b.url, { token: key, body: { ...h.goodReport(b.job), arrivalIcao: 'EGKK' } });
  assert.equal(wrong.body.verification, 'rejected');
  assert.match(wrong.body.reason, /arrival/);
});

test('with anti-cheat off a manual completion needs no wait and still pays 60%', async () => {
  const h = await harness({ antiCheat: false });
  const { token, me } = await h.register('impatient');
  const job = await h.flyableJob(token, me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  const done = await h.call('POST', `/api/v1/flights/${flight.id}/complete`, { token });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.status, 'unverified');
  assert.equal(done.body.revenue, Math.round(job.payout * 0.6));
});

test('manual telemetry is accepted only as unverified with reduced pay', async () => {
  const h = await harness();
  const { token, me } = await h.register('manual');
  const key = await h.apiKey(token);
  const job = await h.flyableJob(token, me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  const r = await h.call('POST', `/api/v1/flights/${flight.id}/telemetry-verify`, { token: key, body: { ...h.goodReport(job), source: 'manual' } });
  assert.equal(r.body.verification, 'unverified');
  assert.equal(r.body.flight.revenue, Math.round(job.payout * 0.6));
  // untrusted numbers never lower a cost: fuel is the type's estimate, not the (lower) reported figure
  assert.equal(r.body.flight.fuelCost, Math.round(fuelBurnKg(catalogType('C172'), job.distanceNm) * 0.9));
});

test('telemetry endpoint: API-key auth only, schema validation, key revocation, ownership', async () => {
  const h = await harness();
  const a = await h.register('keyed');
  const b = await h.register('stranger');
  const key = await h.apiKey(a.token);
  const keyB = await h.apiKey(b.token);
  const job = await h.flyableJob(a.token, a.me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: a.token, body: { aircraftId: a.me.fleet[0].id } })).body;
  const url = `/api/v1/flights/${flight.id}/telemetry-verify`;
  const report = h.goodReport(job);
  const active = await h.call('GET', '/api/v1/flights/active', { token: key });
  assert.deepEqual(active.body.map((f: { id: number }) => f.id), [flight.id], 'a key lists its owner\'s active flights');
  assert.equal((await h.call('GET', '/api/v1/flights/active', { token: keyB })).body.length, 0, 'and nobody else\'s');
  assert.equal((await h.call('GET', '/api/v1/flights/active', { token: a.token })).status, 401, 'a session token is not an API key');
  assert.equal((await h.call('GET', '/api/v1/me', { token: key })).status, 401, 'a key cannot read the account');
  assert.equal((await h.call('POST', url, { body: report })).status, 401, 'no credentials');
  assert.equal((await h.call('POST', url, { token: a.token, body: report })).status, 401, 'a session token is not an API key');
  assert.equal((await h.call('POST', url, { token: 'opc_forged', body: report })).status, 401);
  assert.equal((await h.call('POST', url, { token: key, body: { ...report, landingFpm: 'soft' } })).status, 400);
  assert.equal((await h.call('POST', url, { token: key, body: { ...report, source: 'cheat' } })).status, 400);
  assert.equal((await h.call('POST', url, { token: keyB, body: report })).status, 404, "another user's flight");
  const keys = (await h.call('GET', '/api/v1/me/api-keys', { token: a.token })).body;
  assert.equal(keys.length, 1);
  assert.ok(!('key' in keys[0]) && keys[0].lastUsedAt !== null);
  assert.equal((await h.call('DELETE', `/api/v1/me/api-keys/${keys[0].id}`, { token: a.token })).status, 204);
  assert.equal((await h.call('POST', url, { token: key, body: report })).status, 401, 'revoked key');
  assert.equal((await h.call('DELETE', `/api/v1/me/api-keys/${keys[0].id}`, { token: a.token })).status, 404);
});

test('manual completion pays 60% but only after the fastest believable flight time; cancel closes unpaid', async () => {
  const h = await harness();
  const { token, me } = await h.register('slow');
  const job = await h.flyableJob(token, me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  const early = await h.call('POST', `/api/v1/flights/${flight.id}/complete`, { token });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'too_early');
  h.clock.t += (job.distanceNm / 100 + 1) * 3_600_000;
  const done = await h.call('POST', `/api/v1/flights/${flight.id}/complete`, { token });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.status, 'unverified');
  assert.equal(done.body.revenue, Math.round(job.payout * 0.6));

  const j2 = await h.flyableJob(token, me.fleet[0].id);
  const f2 = (await h.call('POST', `/api/v1/jobs/${j2.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  const balance = (await h.call('GET', '/api/v1/me', { token })).body.company.balance;
  assert.equal((await h.call('POST', `/api/v1/flights/${f2.id}/cancel`, { token })).body.status, 'cancelled');
  assert.equal((await h.call('GET', '/api/v1/me', { token })).body.company.balance, balance);
  assert.ok((await h.call('GET', `/api/v1/jobs?airport=${j2.origin}`, { token })).body.jobs.some((j: Job) => j.id === j2.id), 'a cancelled job returns to the board');
  assert.equal((await h.call('POST', `/api/v1/flights/${f2.id}/cancel`, { token })).status, 409, 'already closed');
});

test('buying hubs and aircraft: price checks, hub requirement, insufficient funds, any ICAO works', async () => {
  const h = await harness();
  const { token } = await h.register('buyer');
  assert.equal((await h.call('POST', '/api/v1/me/fleet', { token, body: { icao: 'C172', hub: 'EGLL' } })).body.error, 'not_a_hub');
  assert.equal((await h.call('POST', '/api/v1/me/fleet', { token, body: { icao: 'A388', hub: 'LFPG' } })).body.error, 'insufficient_funds');
  const bought = await h.call('POST', '/api/v1/me/fleet', { token, body: { icao: 'C182', hub: 'LFPG' } });
  assert.equal(bought.status, 201);
  assert.equal(bought.body.fleet.length, 2);
  assert.ok(bought.body.company.balance < 400_000);
  // an ICAO the FAA list has never heard of still resolves via the category fallback
  const odd = await h.call('POST', '/api/v1/me/fleet', { token, body: { icao: 'ZZ9', hub: 'LFPG' } });
  assert.equal(odd.status, 201, odd.text);
  assert.equal(odd.body.fleet.at(-1).type.derived, true);
  assert.ok(odd.body.fleet.at(-1).type.seats > 0);
  assert.equal((await h.call('POST', '/api/v1/me/hubs', { token, body: { icao: 'EGLL' } })).body.hubs.join(), 'EGLL,LFPG');
  assert.equal((await h.call('POST', '/api/v1/me/hubs', { token, body: { icao: 'EGLL' } })).status, 409);
});

test('custom aircraft: validated, per-company, usable in the fleet, protected while in use', async () => {
  const h = await harness();
  const a = await h.register('custom');
  const b = await h.register('custom2');
  const def = { icao: 'MYAC', name: 'My Homebuilt', category: 'piston-single', engines: 1, wtc: 'L', seats: 2, cargoKg: 20, cruiseKts: 90, rangeNm: 300 };
  assert.equal((await h.call('POST', '/api/v1/me/custom-aircraft', { token: a.token, body: { ...def, seats: 0, cargoKg: 0 } })).status, 400);
  assert.equal((await h.call('POST', '/api/v1/me/custom-aircraft', { token: a.token, body: def })).status, 201);
  assert.equal((await h.call('POST', '/api/v1/me/custom-aircraft', { token: a.token, body: def })).status, 409);
  const bought = await h.call('POST', '/api/v1/me/fleet', { token: a.token, body: { icao: 'MYAC', hub: 'LFPG' } });
  assert.equal(bought.status, 201);
  assert.equal(bought.body.fleet.at(-1).type.name, 'My Homebuilt');
  assert.equal(bought.body.fleet.at(-1).type.derived, false);
  assert.equal((await h.call('GET', '/api/v1/me', { token: b.token })).body.customAircraft.length, 0);
  assert.equal((await h.call('DELETE', '/api/v1/me/custom-aircraft/MYAC', { token: a.token })).status, 409);
});

test('aircraft catalog and airports are searchable', async () => {
  const h = await harness();
  const types = (await h.call('GET', '/api/v1/aircraft-types?q=a320')).body;
  assert.equal(types[0].icao, 'A320');
  assert.equal(types[0].derived, false);
  const derived = (await h.call('GET', '/api/v1/aircraft-types/ZZ9')).body;
  assert.equal(derived.derived, true);
  assert.equal((await h.call('GET', '/api/v1/airports?q=heathrow')).body[0].icao, 'EGLL');
  assert.equal((await h.call('GET', '/api/v1/airports/lfpg')).body.iata, 'CDG');
  assert.equal((await h.call('GET', '/api/v1/airports/ZZZZ')).status, 404);
});

test('export: full JSON with schemaVersion, CSV for flights and transactions, no credentials', async () => {
  const h = await harness();
  const { token, me } = await h.register('exporter');
  const key = await h.apiKey(token);
  const job = await h.flyableJob(token, me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  await h.call('POST', `/api/v1/flights/${flight.id}/telemetry-verify`, { token: key, body: h.goodReport(job) });

  assert.equal((await h.call('GET', '/api/v1/me/export')).status, 401);
  const json = await h.call('GET', '/api/v1/me/export', { token });
  assert.equal(json.status, 200);
  assert.match(String(json.headers['content-disposition']), /attachment; filename="opc-export\.json-2026/);
  const d = json.body;
  assert.equal(d.schemaVersion, 2);
  for (const k of ['profile', 'companies']) assert.ok(k in d, k);
  assert.equal(d.profile.username, 'exporter');
  assert.equal(d.profile.rank, 'Student Pilot');
  assert.equal(d.companies.length, 1);
  for (const k of ['company', 'hubs', 'fleet', 'customAircraft', 'flights', 'transactions']) assert.ok(k in d.companies[0], k);
  assert.equal(d.companies[0].flights.length, 1);
  assert.equal(d.companies[0].flights[0].telemetry.source, 'simconnect');
  assert.equal(d.companies[0].transactions.length, 5);
  assert.ok(!/pass_hash|token|key_hash|opc_/.test(json.text), 'no credentials in the export');

  const fl = await h.call('GET', '/api/v1/me/export?format=flights.csv', { token });
  assert.match(String(fl.headers['content-type']), /text\/csv/);
  const rows = fl.text.trim().split('\r\n');
  assert.equal(rows.length, 2);
  assert.match(rows[0]!, /^id,status,rejectReason/);
  assert.match(rows[1]!, /verified/);
  const tr = await h.call('GET', '/api/v1/me/export?format=transactions.csv', { token });
  assert.equal(tr.text.trim().split('\r\n').length, 6);
  assert.equal((await h.call('GET', '/api/v1/me/export?format=xml', { token })).status, 400);
});

test('CSV cells that could be spreadsheet formulas are neutralised', async () => {
  const { toCsv } = await import('./export.ts');
  assert.equal(toCsv(['a', 'b'], [['=1+1', 'x,"y"'], [null, 3]]), "a,b\r\n'=1+1,\"x,\"\"y\"\"\"\r\n,3\r\n");
});

test('account deletion needs the password, erases everything and frees claimed jobs', async () => {
  const h = await harness();
  const { token, me } = await h.register('leaver');
  const key = await h.apiKey(token);
  const job = await h.flyableJob(token, me.fleet[0].id);
  await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } });
  assert.equal((await h.call('DELETE', '/api/v1/me', { token, body: { password: 'nope nope' } })).status, 403);
  assert.equal((await h.call('DELETE', '/api/v1/me', { token, body: {} })).status, 400);
  assert.equal((await h.call('GET', '/api/v1/me', { token })).status, 200, 'wrong password changed nothing');
  assert.equal((await h.call('DELETE', '/api/v1/me', { token, body: { password: 'correct horse' } })).status, 204);
  assert.equal((await h.call('GET', '/api/v1/me', { token })).status, 401);
  assert.equal((await h.call('POST', '/api/v1/auth/login', { body: { username: 'leaver', password: 'correct horse' } })).status, 401);
  for (const t of ['users', 'companies', 'aircraft', 'flights', 'transactions', 'job_claims', 'api_keys', 'sessions', 'hubs']) {
    assert.equal((h.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n, 0, t);
  }
  void key;
  const again = await h.register('leaver');
  assert.equal(again.me.username, 'leaver');
});

test('malformed and oversized bodies are rejected cleanly', async () => {
  const h = await harness();
  const r = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: '{nope', headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 400);
  assert.equal(JSON.parse(r.body).error, 'bad_request');
  const big = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: JSON.stringify({ username: 'a'.repeat(100_000), password: 'x' }), headers: { 'content-type': 'application/json' } });
  assert.equal(big.statusCode, 413);
});

test('CORS: API answers preflight and allows any origin (clients choose their server)', async () => {
  const h = await harness();
  const r = await h.app.inject({ method: 'OPTIONS', url: '/api/v1/me', headers: { origin: 'https://app.example', 'access-control-request-method': 'GET' } });
  assert.equal(r.statusCode, 204);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.match(String(r.headers['access-control-allow-headers']), /authorization/);
});

test('SimBrief import is routed, validated and creates a pending custom job (details in simbrief.test.ts)', async () => {
  const ofp = { origin: { icao_code: 'LFPG' }, destination: { icao_code: 'EGLL' }, aircraft: { icaocode: 'C172' }, weights: { payload: '300', pax_count_actual: '3' }, fuel: { plan_ramp: '90' }, general: { route: 'DCT' }, params: { units: 'kgs' } };
  const h = await harness({ fetch: (async () => new Response(JSON.stringify(ofp), { status: 200 })) as typeof fetch });
  const { token, me } = await h.register('briefer');
  assert.equal((await h.call('POST', '/api/v1/jobs/import-simbrief', { token, body: { simbriefUsername: '../etc' } })).status, 400);
  const r = await h.call('POST', '/api/v1/jobs/import-simbrief', { token, body: { simbriefUsername: 'briefer' } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.source, 'simbrief');
  assert.equal(r.body.requiredAircraft, 'C172');
  assert.equal(r.body.plannedFuelKg, 90);
  const board = (await h.call('GET', '/api/v1/jobs', { token })).body;
  assert.equal(board.imported[0].id, r.body.id);
  // imported jobs belong to their importer
  const other = await h.register('nosy');
  assert.equal((await h.call('POST', `/api/v1/jobs/${r.body.id}/accept`, { token: other.token, body: { aircraftId: other.me.fleet[0].id } })).status, 404);
  const acc = await h.call('POST', `/api/v1/jobs/${r.body.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } });
  assert.equal(acc.status, 201, acc.text);
  assert.equal((await h.call('GET', '/api/v1/jobs', { token })).body.imported.length, 0);
});

test('with a web root, the server serves the app and falls back to index.html for client routes; API misses stay JSON', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'opc-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
  const h = await harness({ webRoot: dir });
  writeFileSync(join(dir, 'late.js'), 'console.log(1)'); // added after the app was built: must still be served
  const late = await h.app.inject({ method: 'GET', url: '/late.js' });
  assert.equal(late.statusCode, 200);
  assert.match(String(late.headers['content-type']), /javascript/);
  const root = await h.app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 200);
  assert.match(root.body, /<title>app/);
  assert.equal((await h.app.inject({ method: 'GET', url: '/some/client/route' })).statusCode, 200);
  const miss = await h.app.inject({ method: 'GET', url: '/api/v1/nope' });
  assert.equal(miss.statusCode, 404);
  assert.equal(JSON.parse(miss.body).error, 'not_found');
  assert.equal((await h.app.inject({ method: 'POST', url: '/elsewhere' })).statusCode, 404);
});
