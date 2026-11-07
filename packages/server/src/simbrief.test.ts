import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http.ts';
import { fetchOfp, lookupAccount, ofpMismatch } from './simbrief.ts';

const ofp = (over: Record<string, unknown> = {}) => ({
  origin: { icao_code: 'LFPG' }, destination: { icao_code: 'EGLL' }, aircraft: { icaocode: 'A320' },
  weights: { payload: '18000', pax_count_actual: '150' }, fuel: { plan_ramp: '5200' }, general: { route: 'LFPG DCT EGLL' }, params: { units: 'kgs' }, ...over,
});
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })) as typeof fetch;
const fails = async (f: typeof fetch, status: number, code: string) => {
  await assert.rejects(fetchOfp({ username: 'someone' }, f), (e: unknown) => e instanceof HttpError && e.status === status && e.code === code, `${status} ${code}`);
};

test('parses a SimBrief OFP into a job source (kg units)', async () => {
  assert.deepEqual(await fetchOfp({ username: 'someone' }, reply(ofp())), {
    origin: 'LFPG', destination: 'EGLL', aircraftIcao: 'A320', payloadKg: 18000, pax: 150, plannedFuelKg: 5200, route: 'LFPG DCT EGLL', ofpId: null,
  });
});

test('converts pounds to kilograms', async () => {
  const r = await fetchOfp({ username: 'someone' }, reply(ofp({ params: { units: 'lbs' }, weights: { payload: '1000', pax_count_actual: '0' }, fuel: { plan_ramp: '2000' } })));
  assert.equal(r.payloadKg, 454);
  assert.equal(r.plannedFuelKg, 907);
});

test('requests the documented endpoint with the encoded username, a timeout signal and no redirects', async () => {
  let seen: { url: string; init?: RequestInit } | null = null;
  const spy = (async (url: string, init?: RequestInit) => { seen = { url, ...(init ? { init } : {}) }; return new Response(JSON.stringify(ofp())); }) as unknown as typeof fetch;
  await fetchOfp({ username: 'a b&c' }, spy);
  assert.equal(seen!.url, 'https://www.simbrief.com/api/xml.fetcher.php?username=a%20b%26c&json=1');
  assert.ok(seen!.init?.signal instanceof AbortSignal);
  assert.equal(seen!.init?.redirect, 'error');
});

// The exact answer SimBrief gave for an unknown name (checked live, HTTP 400): { fetch: { userid: '', status: 'Error: Unknown UserID', ... } }.
const UNKNOWN_USER = { fetch: { userid: '', static_id: '', status: 'Error: Unknown UserID', time: '0.0004' } };

test('unknown SimBrief user is a 422 simbrief_user_not_found with SimBrief\'s message', async () => {
  await assert.rejects(
    fetchOfp({ username: 'ghost' }, reply(UNKNOWN_USER, 400)),
    (e: unknown) => e instanceof HttpError && e.status === 422 && e.code === 'simbrief_user_not_found' && /Unknown UserID/.test(e.message),
  );
});

test('an account without a plan is a 404 simbrief_not_found, and still a valid account', async () => {
  const none = { fetch: { userid: '1423851', status: 'Error: No flight plan found for this user' } };
  await assert.rejects(fetchOfp({ pilotId: 1423851 }, reply(none, 400)), (e: unknown) => e instanceof HttpError && e.status === 404 && e.code === 'simbrief_not_found');
  assert.deepEqual(await lookupAccount({ pilotId: 1423851 }, reply(none, 400)), { pilotId: 1423851 });
  assert.deepEqual(await lookupAccount({ username: 'fresh' }, reply({ fetch: { userid: '77', status: 'Error: No flight plan found' } }, 400)), { pilotId: 77 });
  await assert.rejects(lookupAccount({ username: 'ghost' }, reply(UNKNOWN_USER, 400)), (e: unknown) => e instanceof HttpError && e.status === 422 && e.code === 'simbrief_user_not_found');
});

test('lookupAccount learns the Pilot ID from a plan answer; SimBrief downtime is not "unknown user"', async () => {
  assert.deepEqual(await lookupAccount({ username: 'someone' }, reply(ofp({ params: { units: 'kgs', user_id: '1423851', request_id: '9' } }))), { pilotId: 1423851 });
  assert.deepEqual(await lookupAccount({ username: 'someone' }, reply(ofp())), { pilotId: null });
  await assert.rejects(lookupAccount({ username: 'x' }, reply({ oops: 1 }, 503)), (e: unknown) => e instanceof HttpError && e.status === 502 && e.code === 'simbrief_unavailable');
});

test('the lookup by Pilot ID and static id asks for exactly that plan, and reads the plan id', async () => {
  let url = '';
  const spy = (async (u: string) => { url = u; return new Response(JSON.stringify(ofp({ params: { units: 'kgs', request_id: '192644104', user_id: '1423851' }, fetch: { static_id: 'opc_12_ab cd&e' } }))); }) as unknown as typeof fetch;
  const r = await fetchOfp({ pilotId: 1423851, staticId: 'opc_12_ab cd&e' }, spy);
  assert.equal(url, 'https://www.simbrief.com/api/xml.fetcher.php?userid=1423851&static_id=opc_12_ab%20cd%26e&json=1');
  assert.equal(r.ofpId, '192644104');
  await fetchOfp({ pilotId: 5 }, spy);
  assert.equal(url, 'https://www.simbrief.com/api/xml.fetcher.php?userid=5&json=1');
});

test('a plan made under another static id (or none) is not the one asked for', async () => {
  for (const echoed of [{ static_id: 'opc_99_other' }, { static_id: {} }, {}]) {
    await assert.rejects(fetchOfp({ pilotId: 5, staticId: 'opc_12_mine' }, reply(ofp({ fetch: echoed }))), (e: unknown) => e instanceof HttpError && e.status === 404 && e.code === 'ofp_not_found');
  }
});

test('an empty-object id (json=1 writes {} for empty elements) is treated as absent', async () => {
  const r = await fetchOfp({ username: 'someone' }, reply(ofp({ params: { units: 'kgs', request_id: {}, user_id: {} } })));
  assert.equal(r.ofpId, null);
});

test('ofpMismatch names what differs, null when origin, destination and type all match', () => {
  const flight = { origin: 'LFPG', destination: 'EGLL', aircraftIcao: 'A320' };
  assert.equal(ofpMismatch({ origin: 'LFPG', destination: 'EGLL', aircraftIcao: 'A320' }, flight), null);
  for (const other of [{ origin: 'LFPO' }, { destination: 'EGKK' }, { aircraftIcao: 'B738' }]) {
    assert.match(ofpMismatch({ ...flight, ...other }, flight)!, /SimBrief plan is/);
  }
});

test('network failure and timeout are soft 504s', async () => {
  await fails((async () => { throw new TypeError('fetch failed'); }) as typeof fetch, 504, 'simbrief_unavailable');
  await fails((async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }) as typeof fetch, 504, 'simbrief_unavailable');
});

test('server errors, non-JSON and schema-violating bodies are soft 502s', async () => {
  await fails(reply({ oops: 1 }, 500), 502, 'simbrief_unavailable');
  await fails(reply('<html>maintenance</html>', 200), 502, 'simbrief_invalid');
  await fails(reply(ofp({ origin: { icao_code: 'paris' } })), 502, 'simbrief_invalid');
  await fails(reply(ofp({ weights: { payload: '-5' } })), 502, 'simbrief_invalid');
  await fails(reply({ origin: {} }), 502, 'simbrief_invalid');
});

test('oversized responses are refused, declared or streamed', async () => {
  await fails(reply(ofp(), 200, { 'content-length': String(50 * 1024 * 1024) }), 502, 'simbrief_invalid');
  await fails(reply(' '.repeat(5 * 1024 * 1024) + JSON.stringify(ofp())), 502, 'simbrief_invalid');
});
