import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_BRIDGE_LOST_MS, LIVE_MIN_INTERVAL_MS, type Job, type LiveSample } from '@opc/shared';
import { buildApp } from './app.ts';
import { airports } from './catalog.ts';
import { get } from './db.ts';
import { harness } from './harness.ts';

const sample = (over: Partial<LiveSample> = {}): LiveSample => ({
  t: Date.UTC(2026, 10, 4, 12, 0, 0), lat: 48.9, lon: 2.4, altFt: 3_500, gsKts: 110, vsFpm: 0, headingDeg: 45, fuelKg: 90,
  phase: 'airborne', paused: false, simRate: 1, flags: [], engines: [{ n1Pct: 88.5, ittC: 640, oilPsi: 62 }], ...over,
});

/** A player with an API key and one accepted (active) flight. */
async function activeFlight(h: Awaited<ReturnType<typeof harness>>, name = 'pilot') {
  const { token, me } = await h.register(name);
  const key = await h.apiKey(token);
  const job: Job = await h.flyableJob(token, me.fleet[0].id);
  const flight = (await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } })).body;
  return { token, key, job, flight: flight as { id: number }, me };
}

test('live: a sample posted with the API key is read back by the owner with remaining distance and ETA', async () => {
  const h = await harness();
  const p = await activeFlight(h);
  const url = `/api/v1/flights/${p.flight.id}/live`;
  const before = await h.call('GET', url, { token: p.token });
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, { status: 'active', sample: null, receivedAt: null, bridgeLost: false, remainingNm: null, etaAt: null }, 'no sample yet: waiting for the bridge, not lost');

  const dest = airports.get(p.job.destination)!;
  const s = sample({ lat: dest.lat, lon: dest.lon + 0.5 });
  const post = await h.call('POST', url, { token: p.key, body: s });
  assert.equal(post.status, 204, post.text);

  const r = await h.call('GET', url, { token: p.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sample, s);
  assert.equal(r.body.receivedAt, h.clock.t);
  assert.equal(r.body.bridgeLost, false);
  assert.ok(r.body.remainingNm > 10 && r.body.remainingNm < 40, `0.5° of longitude at this latitude is about 20 nm, got ${r.body.remainingNm}`);
  const hoursLeft = (r.body.etaAt - h.clock.t) / 3_600_000;
  assert.ok(Math.abs(hoursLeft - r.body.remainingNm / 110) < 0.01, 'ETA = remaining / ground speed');
});

test('live: no ETA on the ground, paused or too slow; sim rate shortens it; remaining distance stays', async () => {
  const h = await harness();
  const p = await activeFlight(h);
  const url = `/api/v1/flights/${p.flight.id}/live`;
  const read = async (over: Partial<LiveSample>) => {
    h.clock.t += LIVE_MIN_INTERVAL_MS;
    assert.equal((await h.call('POST', url, { token: p.key, body: sample(over) })).status, 204);
    return (await h.call('GET', url, { token: p.token })).body;
  };
  for (const over of [{ phase: 'taxiOut' as const, gsKts: 12 }, { paused: true }, { gsKts: 5 }]) {
    const b = await read(over);
    assert.equal(b.etaAt, null, JSON.stringify(over));
    assert.equal(typeof b.remainingNm, 'number');
  }
  const normal = await read({});
  const fast = await read({ simRate: 4 });
  assert.ok(fast.etaAt - h.clock.t < (normal.etaAt - (h.clock.t - LIVE_MIN_INTERVAL_MS)) / 3, 'at 4x the wall-clock ETA is a quarter');
});

test('live: only the owner reads it, only an API key writes it, unknown flights are 404', async () => {
  const h = await harness();
  const a = await activeFlight(h, 'alice');
  const b = await h.register('bob');
  const bKey = await h.apiKey(b.token);
  const url = `/api/v1/flights/${a.flight.id}/live`;

  assert.equal((await h.call('POST', url, { body: sample() })).status, 401, 'no credentials');
  assert.equal((await h.call('POST', url, { token: a.token, body: sample() })).status, 401, 'a session token is not an API key');
  assert.equal((await h.call('POST', url, { token: bKey, body: sample() })).status, 404, "someone else's flight");
  assert.equal((await h.call('GET', url)).status, 401);
  assert.equal((await h.call('GET', url, { token: a.key })).status, 401, 'an API key does not read');
  assert.equal((await h.call('GET', url, { token: b.token })).status, 404, "someone else's flight");
  assert.equal((await h.call('GET', '/api/v1/flights/99999/live', { token: a.token })).status, 404);
  assert.equal((await h.call('POST', '/api/v1/flights/nope/live', { token: a.key, body: sample() })).status, 404);
  assert.equal((await h.call('POST', url, { token: a.key, body: sample() })).status, 204);
  assert.equal((await h.call('GET', url, { token: b.token })).status, 404, 'still hidden after a sample exists');
});

test('live: the body is validated (zod)', async () => {
  const h = await harness();
  const p = await activeFlight(h);
  const url = `/api/v1/flights/${p.flight.id}/live`;
  const bad: unknown[] = [
    null, {}, sample({ lat: 91 }), sample({ lon: -181 }), sample({ gsKts: -1 }), sample({ headingDeg: 361 }), sample({ simRate: 0 }),
    { ...sample(), phase: 'flying' }, { ...sample(), paused: 'no' }, { ...sample(), flags: ['Not Valid'] },
    sample({ engines: Array.from({ length: 9 }, () => ({})) }), { ...sample(), engines: [{ n1Pct: 'high' }] }, { ...sample(), lat: null },
  ];
  for (const body of bad) {
    h.clock.t += LIVE_MIN_INTERVAL_MS;
    const r = await h.call('POST', url, { token: p.key, body: body as object });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, 'invalid_request');
  }
  const unknownGauges = await h.call('POST', url, { token: p.key, body: sample({ engines: [] }) });
  assert.equal(unknownGauges.status, 204, 'an aircraft without engine gauges sends an empty list');
});

test('live: one sample per second per flight; the limit is per flight and not consumed by refused samples', async () => {
  const h = await harness();
  const p = await activeFlight(h);
  const url = `/api/v1/flights/${p.flight.id}/live`;
  assert.equal((await h.call('POST', url, { token: p.key, body: sample() })).status, 204);
  h.clock.t += LIVE_MIN_INTERVAL_MS - 1;
  const limited = await h.call('POST', url, { token: p.key, body: sample({ altFt: 9_999 }) });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'rate_limited');
  assert.equal((await h.call('GET', url, { token: p.token })).body.sample.altFt, 3_500, 'the refused sample was not kept');
  h.clock.t += 1;
  assert.equal((await h.call('POST', url, { token: p.key, body: sample({ altFt: 4_000 }) })).status, 204);
  assert.equal((await h.call('GET', url, { token: p.token })).body.sample.altFt, 4_000, 'only the latest sample is kept');

  // a second flight of the same player has its own budget
  const second = await h.register('second');
  const key2 = await h.apiKey(second.token);
  const job2: Job = await h.flyableJob(second.token, second.me.fleet[0].id);
  const f2 = (await h.call('POST', `/api/v1/jobs/${job2.id}/accept`, { token: second.token, body: { aircraftId: second.me.fleet[0].id } })).body;
  assert.equal((await h.call('POST', `/api/v1/flights/${f2.id}/live`, { token: key2, body: sample() })).status, 204);
});

test('live: bridgeLost turns true after 30 s without a sample and back to false with the next one (injected clock)', async () => {
  const h = await harness();
  const p = await activeFlight(h);
  const url = `/api/v1/flights/${p.flight.id}/live`;
  const lost = async () => (await h.call('GET', url, { token: p.token })).body.bridgeLost;
  assert.equal(await lost(), false, 'never reported');
  h.clock.t += 10 * LIVE_BRIDGE_LOST_MS;
  assert.equal(await lost(), false, 'a flight whose bridge never started is waiting, not lost');

  assert.equal((await h.call('POST', url, { token: p.key, body: sample() })).status, 204);
  h.clock.t += LIVE_BRIDGE_LOST_MS;
  assert.equal(await lost(), false, 'exactly 30 s: still fine');
  h.clock.t += 1;
  assert.equal(await lost(), true, 'more than 30 s');
  const stale = (await h.call('GET', url, { token: p.token })).body;
  assert.notEqual(stale.sample, null, 'the last known sample is still shown, flagged as lost by bridgeLost');

  assert.equal((await h.call('POST', url, { token: p.key, body: sample() })).status, 204);
  assert.equal(await lost(), false, 'the bridge is back');
});

test('live: last_live_at is stored; after a server restart the sample is gone but bridgeLost still works', async () => {
  const h = await harness();
  const p = await activeFlight(h);
  const url = `/api/v1/flights/${p.flight.id}/live`;
  const at = h.clock.t;
  await h.call('POST', url, { token: p.key, body: sample() });
  assert.equal(get<{ last_live_at: number }>(h.db, 'SELECT last_live_at FROM flights WHERE id = ?', p.flight.id)!.last_live_at, at);

  const restarted = await buildApp({ db: h.db, now: () => h.clock.t, ai: false });
  const read = async () => {
    const r = await restarted.inject({ method: 'GET', url, headers: { authorization: `Bearer ${p.token}` } });
    return JSON.parse(r.body);
  };
  h.clock.t += 5_000;
  assert.deepEqual(await read(), { status: 'active', sample: null, receivedAt: at, bridgeLost: false, remainingNm: null, etaAt: null });
  h.clock.t += LIVE_BRIDGE_LOST_MS;
  assert.equal((await read()).bridgeLost, true);
});

test('live: a closed flight takes no samples (409) and reports no live state', async () => {
  const h = await harness();
  const p = await activeFlight(h);
  const url = `/api/v1/flights/${p.flight.id}/live`;
  await h.call('POST', url, { token: p.key, body: sample() });
  assert.equal((await h.call('POST', `/api/v1/flights/${p.flight.id}/cancel`, { token: p.token })).status, 200);
  h.clock.t += 2_000;
  const post = await h.call('POST', url, { token: p.key, body: sample() });
  assert.equal(post.status, 409);
  assert.equal(post.body.error, 'flight_closed');
  const r = await h.call('GET', url, { token: p.token });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.status, r.body.sample, r.body.bridgeLost, r.body.remainingNm, r.body.etaAt], ['cancelled', null, false, null, null]);
});

test('live: the telemetry-verify flow is untouched (flight with live samples still settles)', async () => {
  const h = await harness();
  const p = await activeFlight(h);
  await h.call('POST', `/api/v1/flights/${p.flight.id}/live`, { token: p.key, body: sample() });
  const r = await h.call('POST', `/api/v1/flights/${p.flight.id}/telemetry-verify`, { token: p.key, body: h.goodReport(p.job) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.verification, 'verified');
});
