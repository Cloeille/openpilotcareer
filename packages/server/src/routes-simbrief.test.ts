import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flight } from '@opc/shared';
import { get, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';

const UNKNOWN = { fetch: { userid: '', static_id: '', status: 'Error: Unknown UserID', time: '0.0004' } };
const NO_PLAN = { fetch: { userid: '1423851', static_id: '', status: 'Error: No flight plan found', time: '0.0004' } };
const plan = (over: Record<string, unknown> = {}, staticId = '') => ({
  fetch: { userid: '1423851', static_id: staticId, status: 'Success' },
  origin: { icao_code: 'LFPG' }, destination: { icao_code: 'EGLL' }, aircraft: { icaocode: 'C172' },
  weights: { payload: '300', pax_count_actual: '3' }, fuel: { plan_ramp: '95' }, general: { route: 'LFPG DCT EGLL' },
  params: { units: 'kgs', request_id: '192644104', user_id: '1423851' }, ...over,
});

/** A SimBrief that answers what `answer(url)` says (status 200 unless it returns [status, body]) and remembers every URL it was asked. */
function fakeSimbrief(answer: (url: URL) => unknown | [number, unknown]) {
  const urls: URL[] = [];
  const fetch = (async (u: string) => {
    const url = new URL(u);
    urls.push(url);
    const a = answer(url);
    const [status, body] = Array.isArray(a) && typeof a[0] === 'number' ? (a as [number, unknown]) : [200, a];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
}

test('the connection is per account, verified against SimBrief, learns the Pilot ID and survives a new login', async () => {
  const sb = fakeSimbrief((u) => (u.searchParams.get('username') === 'ghost' ? [400, UNKNOWN] : plan()));
  const h = await harness({ fetch: sb.fetch });
  const { token } = await h.register('amy');
  assert.equal((await h.call('GET', '/api/v1/me/simbrief')).status, 401);
  assert.deepEqual((await h.call('GET', '/api/v1/me/simbrief', { token })).body, { username: null, pilotId: null, verifiedAt: null });

  assert.equal((await h.call('PUT', '/api/v1/me/simbrief', { token, body: {} })).status, 400);
  assert.equal((await h.call('PUT', '/api/v1/me/simbrief', { token, body: { username: 'a', pilotId: 5 } })).status, 400);
  assert.equal((await h.call('PUT', '/api/v1/me/simbrief', { token, body: { username: '../etc' } })).status, 400);
  assert.equal(sb.urls.length, 0, 'invalid input never reaches SimBrief');

  const unknown = await h.call('PUT', '/api/v1/me/simbrief', { token, body: { username: 'ghost' } });
  assert.equal(unknown.status, 422);
  assert.equal(unknown.body.error, 'simbrief_user_not_found');
  assert.equal((await h.call('GET', '/api/v1/me/simbrief', { token })).body.username, null, 'nothing saved for an unknown account');

  const ok = await h.call('PUT', '/api/v1/me/simbrief', { token, body: { username: ' SpeedMaintenance746 ' } });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.body, { username: 'SpeedMaintenance746', pilotId: 1423851, verifiedAt: h.clock.t });
  assert.equal(sb.urls.at(-1)!.searchParams.get('username'), 'SpeedMaintenance746');

  const again = await h.call('POST', '/api/v1/auth/login', { body: { username: 'amy', password: 'correct horse' } });
  assert.equal(again.status, 200);
  assert.deepEqual((await h.call('GET', '/api/v1/me/simbrief', { token: again.body.token })).body, ok.body, 'lives in the database, not in a session');
  assert.equal(JSON.stringify((await h.call('GET', '/api/v1/me/export', { token })).body).includes('SpeedMaintenance746'), false, 'not part of the export');
});

test('an account with no plan yet is valid; a Pilot ID is verified as typed; SimBrief down is not "unknown user"', async () => {
  let mode: 'noplan' | 'down' = 'noplan';
  const sb = fakeSimbrief(() => (mode === 'noplan' ? [400, NO_PLAN] : [503, { oops: 1 }]));
  const h = await harness({ fetch: sb.fetch });
  const { token } = await h.register('amy');
  const ok = await h.call('PUT', '/api/v1/me/simbrief', { token, body: { pilotId: 1423851 } });
  assert.deepEqual(ok.body, { username: null, pilotId: 1423851, verifiedAt: h.clock.t });
  assert.equal(sb.urls.at(-1)!.searchParams.get('userid'), '1423851');
  const named = await h.call('PUT', '/api/v1/me/simbrief', { token, body: { username: 'fresh' } });
  assert.deepEqual(named.body, { username: 'fresh', pilotId: 1423851, verifiedAt: h.clock.t }, 'learns the Pilot ID from the refusal');
  mode = 'down';
  const down = await h.call('PUT', '/api/v1/me/simbrief', { token, body: { username: 'other' } });
  assert.equal(down.status, 502);
  assert.equal(down.body.error, 'simbrief_unavailable');
  assert.equal((await h.call('GET', '/api/v1/me/simbrief', { token })).body.username, 'fresh', 'the saved connection is untouched by a failed change');
});

test('disconnect clears it, an API key cannot touch it, another account never sees it', async () => {
  const h = await harness({ fetch: fakeSimbrief(() => plan()).fetch });
  const amy = await h.register('amy');
  const bob = await h.register('bob');
  await h.call('PUT', '/api/v1/me/simbrief', { token: amy.token, body: { username: 'amy' } });
  const key = await h.apiKey(amy.token);
  for (const method of ['GET', 'PUT', 'DELETE'] as const) assert.equal((await h.call(method, '/api/v1/me/simbrief', { token: key, body: { username: 'x' } })).status, 401, method);
  assert.equal((await h.call('GET', '/api/v1/me/simbrief', { token: bob.token })).body.username, null);
  assert.equal((await h.call('DELETE', '/api/v1/me/simbrief', { token: amy.token })).status, 204);
  assert.deepEqual((await h.call('GET', '/api/v1/me/simbrief', { token: amy.token })).body, { username: null, pilotId: null, verifiedAt: null });
});

test('connecting is rate limited', async () => {
  const h = await harness({ fetch: fakeSimbrief(() => plan()).fetch });
  const { token } = await h.register('amy');
  let last = 0;
  for (let i = 0; i < 14; i++) last = (await h.call('PUT', '/api/v1/me/simbrief', { token, body: { username: 'amy' } })).status;
  assert.equal(last, 429);
});

async function flying(fetch: typeof globalThis.fetch) {
  const h = await harness({ fetch });
  const u = await h.register('amy');
  const aircraft = u.me.fleet[0].id as number;
  const job = await h.flyableJob(u.token, aircraft);
  const accepted = await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: u.token, body: { aircraftId: aircraft } });
  assert.equal(accepted.status, 201, accepted.text);
  return { h, u, job, flight: accepted.body as Flight };
}

test('an accepted flight carries the static id its SimBrief dispatch is made under; AI flights do not', async () => {
  const { h, u, flight } = await flying(fakeSimbrief(() => plan()).fetch);
  assert.match(flight.simbrief!.staticId, /^opc_\d+_[0-9a-f]{12}$/);
  assert.ok(flight.simbrief!.staticId.startsWith(`opc_${flight.id}_`));
  assert.equal(flight.simbrief!.ofpId, null);
  const listed = (await h.call('GET', '/api/v1/me/flights', { token: u.token })).body as Flight[];
  assert.equal(listed[0]!.simbrief!.staticId, flight.simbrief!.staticId);
  const ai = await harness({ ai: true });
  assert.ok(get<{ n: number }>(ai.db, 'SELECT COUNT(*) AS n FROM flights WHERE simbrief_static_id IS NOT NULL')!.n === 0);
});

test('fetching the plan: needs a connection, asks for exactly this flight\'s plan, checks origin, destination and type, stores fuel, route and plan id', async () => {
  let staticId = '';
  let answer: (u: URL) => unknown = () => plan();
  const sb = fakeSimbrief((u) => answer(u));
  const { h, u, job, flight } = await flying(sb.fetch);
  staticId = flight.simbrief!.staticId;
  const fetchPlan = (token = u.token, id = flight.id) => h.call('POST', `/api/v1/flights/${id}/simbrief/fetch`, { token });

  assert.equal((await fetchPlan()).body.error, 'simbrief_not_connected');
  assert.equal(sb.urls.length, 0);
  await h.call('PUT', '/api/v1/me/simbrief', { token: u.token, body: { username: 'amy' } });

  answer = () => plan({ origin: { icao_code: job.origin }, destination: { icao_code: job.destination } }, 'opc_other_plan');
  const stale = await fetchPlan();
  assert.equal(stale.status, 404, 'a plan made under another static id is not this flight\'s plan');
  assert.equal(stale.body.error, 'ofp_not_found');
  const asked = sb.urls.at(-1)!;
  assert.equal(asked.searchParams.get('userid'), '1423851');
  assert.equal(asked.searchParams.get('static_id'), staticId);
  assert.equal(asked.searchParams.get('username'), null);

  answer = () => plan({ origin: { icao_code: 'LFPO' }, destination: { icao_code: job.destination }, aircraft: { icaocode: 'C172' } }, staticId);
  const wrong = await fetchPlan();
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.error, 'ofp_mismatch');
  assert.match(wrong.body.message, /^SimBrief LFPO → \w{4} \(C172\), flight /);

  answer = () => plan({ origin: { icao_code: job.origin }, destination: { icao_code: job.destination }, aircraft: { icaocode: 'C172' }, fuel: { plan_ramp: '110' }, general: { route: 'DCT ABC DCT' } }, staticId);
  const ok = await fetchPlan();
  assert.equal(ok.status, 200, ok.text);
  const f = ok.body as Flight;
  assert.equal(f.job.plannedFuelKg, 110);
  assert.equal(f.job.route, 'DCT ABC DCT');
  assert.equal(f.simbrief!.ofpId, '192644104');
  const stored = (await h.call('GET', '/api/v1/me/flights?status=active', { token: u.token })).body as Flight[];
  assert.equal(stored[0]!.job.plannedFuelKg, 110);
  assert.equal(stored[0]!.job.payout, job.payout, 'the plan changes no money');
  assert.ok(!JSON.stringify(stored).includes('weights'), 'the OFP body is not kept');

  const other = await h.register('bob');
  assert.equal((await fetchPlan(other.token)).status, 404, 'ownership');
  assert.equal((await fetchPlan(u.token, 99999)).status, 404);
  assert.equal((await h.call('POST', '/api/v1/flights/abc/simbrief/fetch', { token: u.token })).status, 404);
});

test('without a Pilot ID the latest plan of the username is used and still has to match the flight', async () => {
  const noId = (over: Record<string, unknown> = {}) => plan({ params: { units: 'kgs', request_id: '7' }, ...over });
  let answer: (u: URL) => unknown = () => noId();
  const sb = fakeSimbrief((u) => answer(u));
  const { h, u, job, flight } = await flying(sb.fetch);
  run(h.db, "UPDATE users SET simbrief_username = 'amy', simbrief_verified_at = 1 WHERE username = 'amy'");
  answer = () => noId({ origin: { icao_code: job.origin }, destination: { icao_code: job.destination } });
  const ok = await h.call('POST', `/api/v1/flights/${flight.id}/simbrief/fetch`, { token: u.token });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(sb.urls.at(-1)!.searchParams.get('username'), 'amy');
  assert.equal(sb.urls.at(-1)!.searchParams.get('static_id'), null);
  answer = () => noId({ aircraft: { icaocode: 'B738' }, origin: { icao_code: job.origin }, destination: { icao_code: job.destination } });
  assert.equal((await h.call('POST', `/api/v1/flights/${flight.id}/simbrief/fetch`, { token: u.token })).body.error, 'ofp_mismatch');
});

test('a closed flight cannot take a plan', async () => {
  const { h, u, flight } = await flying(fakeSimbrief(() => plan()).fetch);
  await h.call('PUT', '/api/v1/me/simbrief', { token: u.token, body: { username: 'amy' } });
  await h.call('POST', `/api/v1/flights/${flight.id}/cancel`, { token: u.token });
  const r = await h.call('POST', `/api/v1/flights/${flight.id}/simbrief/fetch`, { token: u.token });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'flight_closed');
});

test('the import route keeps working with a username and now with a Pilot ID', async () => {
  const sb = fakeSimbrief(() => plan({ aircraft: { icaocode: 'C172' } }));
  const h = await harness({ fetch: sb.fetch });
  const { token } = await h.register('amy');
  assert.equal((await h.call('POST', '/api/v1/jobs/import-simbrief', { token, body: { simbriefUsername: 'amy' } })).status, 201);
  assert.equal(sb.urls.at(-1)!.searchParams.get('username'), 'amy');
  assert.equal((await h.call('POST', '/api/v1/jobs/import-simbrief', { token, body: { pilotId: 1423851 } })).status, 201);
  assert.equal(sb.urls.at(-1)!.searchParams.get('userid'), '1423851');
  assert.equal((await h.call('POST', '/api/v1/jobs/import-simbrief', { token, body: {} })).status, 400);
});

test('a line rotation (private job, source "line") is a flight like any other for SimBrief', async () => {
  const sb = fakeSimbrief(() => plan());
  const h = await harness({ fetch: sb.fetch });
  const u = await h.register('amy', 'LFPG');
  const ac = insertAircraft(h.db, { companyId: u.me.company.id, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  run(h.db, `INSERT INTO custom_jobs (id, company_id, created_at, kind, origin, destination, distance_nm, payload_kg, pax, payout, required_aircraft, source, expires_at)
    VALUES ('ln-1', ?, ?, 'pax', 'LFPG', 'LFLL', 240, 1000, 10, 5000, 'AT76', 'line', ?)`, u.me.company.id, h.clock.t, h.clock.t + 3_600_000);
  const accepted = await h.call('POST', '/api/v1/jobs/ln-1/accept', { token: u.token, body: { aircraftId: ac } });
  assert.equal(accepted.status, 201, accepted.text);
  assert.equal(accepted.body.job.source, 'line');
  assert.match(accepted.body.simbrief.staticId, /^opc_\d+_[0-9a-f]{12}$/);
});
