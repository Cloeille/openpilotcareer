import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './http.ts';
import { fetchLatestOfp } from './simbrief.ts';

const ofp = (over: Record<string, unknown> = {}) => ({
  origin: { icao_code: 'LFPG' }, destination: { icao_code: 'EGLL' }, aircraft: { icaocode: 'A320' },
  weights: { payload: '18000', pax_count_actual: '150' }, fuel: { plan_ramp: '5200' }, general: { route: 'LFPG DCT EGLL' }, params: { units: 'kgs' }, ...over,
});
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })) as typeof fetch;
const fails = async (f: typeof fetch, status: number, code: string) => {
  await assert.rejects(fetchLatestOfp('someone', f), (e: unknown) => e instanceof HttpError && e.status === status && e.code === code, `${status} ${code}`);
};

test('parses a SimBrief OFP into a job source (kg units)', async () => {
  assert.deepEqual(await fetchLatestOfp('someone', reply(ofp())), {
    origin: 'LFPG', destination: 'EGLL', aircraftIcao: 'A320', payloadKg: 18000, pax: 150, plannedFuelKg: 5200, route: 'LFPG DCT EGLL',
  });
});

test('converts pounds to kilograms', async () => {
  const r = await fetchLatestOfp('someone', reply(ofp({ params: { units: 'lbs' }, weights: { payload: '1000', pax_count_actual: '0' }, fuel: { plan_ramp: '2000' } })));
  assert.equal(r.payloadKg, 454);
  assert.equal(r.plannedFuelKg, 907);
});

test('requests the documented endpoint with the encoded username, a timeout signal and no redirects', async () => {
  let seen: { url: string; init?: RequestInit } | null = null;
  const spy = (async (url: string, init?: RequestInit) => { seen = { url, ...(init ? { init } : {}) }; return new Response(JSON.stringify(ofp())); }) as unknown as typeof fetch;
  await fetchLatestOfp('a b&c', spy);
  assert.equal(seen!.url, 'https://www.simbrief.com/api/xml.fetcher.php?username=a%20b%26c&json=1');
  assert.ok(seen!.init?.signal instanceof AbortSignal);
  assert.equal(seen!.init?.redirect, 'error');
});

test('unknown SimBrief user is a soft 404 with SimBrief\'s message', async () => {
  await assert.rejects(
    fetchLatestOfp('ghost', reply({ fetch: { userid: '', status: 'Error: Unknown UserID', time: '0.0003' } }, 400)),
    (e: unknown) => e instanceof HttpError && e.status === 404 && e.code === 'simbrief_not_found' && /Unknown UserID/.test(e.message),
  );
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
