import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_JOB_RESERVATION_MS, FUEL_PRICE_PER_KG, START_MODES, fuelPriceFactor, type Job } from '@opc/shared';
import { TICK_MS, runTick, seedAi, tickOf } from './ai.ts';
import { boardFor, windowOf } from './board.ts';
import { airports } from './catalog.ts';
import { all, get, MIGRATIONS, openDb, run, tx } from './db.ts';
import { harness } from './harness.ts';
import { applyBailout, jobsNearby, wearEnabled } from './start.ts';
import { reserve } from './reservations.ts';

const V1 = '/api/v1';
type H = Awaited<ReturnType<typeof harness>>;

/** A player with no company yet (the v2 registration). */
async function newcomer(h: H, name: string) {
  const r = await h.call('POST', `${V1}/auth/register`, { body: { username: name, password: 'correct horse', onboarding: true } });
  assert.equal(r.status, 201, r.text);
  return { token: r.body.token as string, reg: r.body };
}

/** Founds an onboarding company and gives it a C172 (the finance lot's lease/rental does this for real). */
async function founded(h: H, name: string, o: { hub?: string; code?: string; mode?: 'airliner' | 'hardcore'; aircraft?: string | null } = {}) {
  const n = await newcomer(h, name);
  const hub = o.hub ?? 'LFPG';
  const r = await h.call('POST', `${V1}/me/companies`, { token: n.token, body: { name: `${name} Air`, hub, code: o.code ?? name.slice(0, 3).toUpperCase(), callsign: `${name}CALL`.toUpperCase(), startMode: o.mode ?? 'hardcore' } });
  assert.equal(r.status, 201, r.text);
  const id = r.body.company.id as number;
  if (o.aircraft !== null) run(h.db, 'INSERT INTO aircraft (company_id, icao, location, value) VALUES (?, ?, ?, 80000)', id, o.aircraft ?? 'C172', hub);
  return { ...n, id, me: r.body };
}

test('migration 3: identity, onboarding, reservations and bailout tables exist and the version advances', () => {
  const db = openDb(':memory:');
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  const cols = all<{ name: string }>(db, 'PRAGMA table_info(companies)').map((c) => c.name);
  for (const c of ['code', 'callsign', 'livery_color', 'start_mode', 'realism']) assert.ok(cols.includes(c), c);
  for (const t of ['onboarding', 'job_reservations', 'bailouts']) assert.ok(get(db, 'SELECT 1 AS x FROM sqlite_master WHERE name = ?', t), t);
});

test('a player with no company: /me and every company-scoped route answer 409 no_company; account routes still work', async () => {
  const h = await harness();
  const n = await newcomer(h, 'ghost');
  assert.equal(n.reg.onboarding.completed, false);
  assert.equal(n.reg.company, undefined, 'no company was created');
  const t = n.token;
  for (const [m, url, body] of [
    ['GET', '/me'], ['GET', '/me/transactions'], ['GET', '/me/flights'], ['GET', '/jobs'], ['POST', '/me/hubs', { icao: 'LFPG' }], ['POST', '/me/fleet', { icao: 'C172', hub: 'LFPG' }],
    ['POST', '/me/custom-aircraft', {}], ['DELETE', '/me/custom-aircraft/ZZZ1'], ['POST', '/jobs/import-simbrief', { simbriefUsername: 'x' }], ['POST', '/jobs/LFPG-1-0/accept', { aircraftId: 1 }],
    ['POST', '/flights/1/cancel'], ['POST', '/flights/1/complete'], ['GET', '/me/export?format=flights.csv'], ['GET', '/me/export?format=transactions.csv'],
  ] as const) {
    const r = await h.call(m, `${V1}${url}`, { token: t, ...(body ? { body } : {}) });
    assert.equal(r.status, 409, `${m} ${url}: ${r.text}`);
    assert.equal(r.body.error, 'no_company', `${m} ${url}`);
  }
  assert.equal((await h.call('GET', `${V1}/me`, { token: t, company: 5 })).status, 409, 'a company header with no company is still no_company, not a crash');
  assert.deepEqual((await h.call('GET', `${V1}/me/companies`, { token: t })).body, []);
  assert.equal((await h.call('GET', `${V1}/me/export`, { token: t })).status, 200);
  assert.equal((await h.call('GET', `${V1}/me/api-keys`, { token: t })).status, 200);
  assert.equal((await h.call('POST', `${V1}/me/api-keys`, { token: t, body: { label: 'pc' } })).status, 201);
  assert.equal((await h.call('POST', `${V1}/auth/logout`, { token: t })).status, 204);
  const login = await h.call('POST', `${V1}/auth/login`, { body: { username: 'ghost', password: 'correct horse' } });
  assert.equal(login.status, 200, 'login works without a company');
  assert.equal(login.body.onboarding.completed, false);
  assert.equal((await h.call('GET', `${V1}/me`)).status, 401, 'still 401 without a session');
});

test('legacy registration is unchanged: company + starter aircraft, and the onboarding counts as completed', async () => {
  const h = await harness();
  const a = await h.register('legacy');
  assert.equal(a.me.company.balance, 400_000);
  assert.equal(a.me.fleet.length, 1);
  assert.deepEqual([a.me.company.code, a.me.company.callsign, a.me.company.liveryColor, a.me.company.startMode], [null, null, null, null]);
  assert.equal(a.me.company.realism.payModifierPct, 0);
  const o = await h.call('GET', `${V1}/onboarding`, { token: a.token });
  assert.deepEqual(o.body, { completed: true, step: 1, startMode: null, companyId: null, draft: {} });
  assert.equal((await h.call('GET', `${V1}/onboarding`)).status, 401);
});

test('PUT /onboarding keeps step, start mode and a draft (max 8 KB); validation and completed-state rules', async () => {
  const h = await harness();
  const n = await newcomer(h, 'drafter');
  const t = n.token;
  assert.deepEqual((await h.call('GET', `${V1}/onboarding`, { token: t })).body, { completed: false, step: 1, startMode: null, companyId: null, draft: {} });
  const put = await h.call('PUT', `${V1}/onboarding`, { token: t, body: { step: 2, startMode: 'airliner', draft: { name: 'Azur', hub: 'LFMN' } } });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual(put.body, { completed: false, step: 2, startMode: 'airliner', companyId: null, draft: { name: 'Azur', hub: 'LFMN' } });
  assert.deepEqual((await h.call('GET', `${V1}/onboarding`, { token: t })).body, put.body, 'persisted');
  assert.equal((await h.call('PUT', `${V1}/onboarding`, { token: t, body: { step: 4 } })).body.draft.name, 'Azur', 'a partial update keeps the rest');
  for (const bad of [{ step: 7 }, { step: 0 }, { startMode: 'easy' }, { draft: { x: 'y'.repeat(9000) } }, { draft: [1] }]) assert.equal((await h.call('PUT', `${V1}/onboarding`, { token: t, body: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await h.call('PUT', `${V1}/onboarding`, { body: {} })).status, 401);
  assert.equal((await h.call('POST', `${V1}/onboarding/complete`, { token: t })).status, 409, 'cannot complete without a company');
  // another player's onboarding is separate
  const other = await newcomer(h, 'other');
  assert.equal((await h.call('GET', `${V1}/onboarding`, { token: other.token })).body.step, 1);
});

test('founding a company with a start mode: the mode capital, NO aircraft, a free first hub, identity stored, onboarding linked', async () => {
  const h = await harness();
  const f = await founded(h, 'azur', { hub: 'LFMN', mode: 'airliner', code: 'AZR', aircraft: null });
  const c = f.me.company;
  assert.equal(c.balance, START_MODES.airliner.capital);
  assert.deepEqual(f.me.fleet, []);
  assert.deepEqual(f.me.hubs, ['LFMN']);
  assert.deepEqual([c.code, c.callsign, c.liveryColor, c.startMode], ['AZR', 'AZURCALL', null, 'airliner']);
  assert.equal(c.realism.preset, 'balanced', 'the mode suggests balanced');
  const ledger = (await h.call('GET', `${V1}/me/transactions`, { token: f.token })).body;
  assert.deepEqual(ledger.map((x: { kind: string; amount: number }) => [x.kind, x.amount]), [['grant', 2_500_000]], 'the hub cost nothing');
  const o = (await h.call('GET', `${V1}/onboarding`, { token: f.token })).body;
  assert.deepEqual([o.companyId, o.startMode, o.completed, o.step], [f.id, 'airliner', false, 3]);
  // hardcore + livery colour
  const g = await newcomer(h, 'cessna');
  const r = await h.call('POST', `${V1}/me/companies`, { token: g.token, body: { name: 'Petit Avion', hub: 'LFTZ', code: 'pta', callsign: 'petit', liveryColor: '#f59e0b', startMode: 'hardcore' } });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.body.company.balance, r.body.company.code, r.body.company.callsign, r.body.company.liveryColor, r.body.company.realism.preset], [45_000, 'PTA', 'PETIT', '#F59E0B', 'hardcore']);
  assert.equal(r.body.company.realism.toggles.wearAndFailures, true);
});

test('founding validation: code/callsign required with a start mode, formats, unknown hub, name clash; legacy body still works', async () => {
  const h = await harness();
  const n = await newcomer(h, 'valid');
  const t = n.token;
  const post = (body: object) => h.call('POST', `${V1}/me/companies`, { token: t, body });
  assert.equal((await post({ name: 'No Code', hub: 'LFPG', startMode: 'airliner' })).status, 400);
  assert.equal((await post({ name: 'Bad Code', hub: 'LFPG', code: 'AB', callsign: 'BADCODE', startMode: 'airliner' })).status, 400);
  assert.equal((await post({ name: 'Bad Call', hub: 'LFPG', code: 'ABC', callsign: 'A1', startMode: 'airliner' })).status, 400);
  assert.equal((await post({ name: 'Bad Livery', hub: 'LFPG', code: 'ABC', callsign: 'ABCDE', liveryColor: 'red', startMode: 'airliner' })).status, 400);
  assert.equal((await post({ name: 'Bad Hub', hub: 'ZZZZ', code: 'ABC', callsign: 'ABCDE', startMode: 'airliner' })).status, 422);
  assert.equal((await post({ name: 'Bad Mode', hub: 'LFPG', code: 'ABC', callsign: 'ABCDE', startMode: 'easy' })).status, 400);
  assert.equal((await h.call('GET', `${V1}/me/companies`, { token: t })).body.length, 0, 'failed attempts leave nothing behind');
  const legacy = await post({ name: 'Old Way', hub: 'EGLL' });
  assert.equal(legacy.status, 201, legacy.text);
  assert.deepEqual([legacy.body.company.balance, legacy.body.fleet.length, legacy.body.company.startMode], [400_000, 1, null]);
});

test('airline code: unique per server (409 code_taken), availability endpoint, immutable once set', async () => {
  const h = await harness();
  const a = await founded(h, 'first', { code: 'FST', aircraft: null });
  assert.deepEqual((await h.call('GET', `${V1}/airlines/code/FST`, { token: a.token })).body, { available: false });
  assert.deepEqual((await h.call('GET', `${V1}/airlines/code/fst`, { token: a.token })).body, { available: false }, 'case-insensitive');
  assert.deepEqual((await h.call('GET', `${V1}/airlines/code/XYZ`, { token: a.token })).body, { available: true });
  assert.equal((await h.call('GET', `${V1}/airlines/code/AB`, { token: a.token })).status, 400);
  assert.equal((await h.call('GET', `${V1}/airlines/code/XYZ`)).status, 401);
  const b = await newcomer(h, 'second');
  const clash = await h.call('POST', `${V1}/me/companies`, { token: b.token, body: { name: 'Second Air', hub: 'EGLL', code: 'fst', callsign: 'SECOND', startMode: 'airliner' } });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'code_taken');
  assert.equal((await h.call('GET', `${V1}/me/companies`, { token: b.token })).body.length, 0);
  // immutable: PATCH may rename but refuses code/callsign
  const ren = await h.call('PATCH', `${V1}/companies/${a.id}`, { token: a.token, body: { name: 'First Renamed' } });
  assert.equal(ren.status, 200);
  assert.deepEqual([ren.body.code, ren.body.callsign], ['FST', 'FIRSTCALL']);
  const tamper = await h.call('PATCH', `${V1}/companies/${a.id}`, { token: a.token, body: { name: 'First Renamed', code: 'NEW' } });
  assert.equal(tamper.status, 409);
  assert.equal(tamper.body.error, 'immutable');
  assert.equal((await h.call('PATCH', `${V1}/companies/${a.id}`, { token: a.token, body: { callsign: 'OTHER' } })).status, 409);
  assert.equal((await h.call('GET', `${V1}/airlines/code/NEW`, { token: a.token })).body.available, true);
});

test('going back a step replaces the unfinished onboarding company (its code is free again); a flown company is never replaced', async () => {
  const h = await harness();
  const f = await founded(h, 'redo', { code: 'RDO', mode: 'airliner', hub: 'LFMN', aircraft: null });
  const again = await h.call('POST', `${V1}/me/companies`, { token: f.token, body: { name: 'Redo Better', hub: 'LFPG', code: 'RDX', callsign: 'REDO', startMode: 'airliner' } });
  assert.equal(again.status, 201, again.text);
  assert.deepEqual(again.body.companies.map((c: { name: string }) => c.name), ['Redo Better'], 'one company, the old one is gone');
  assert.equal((await h.call('GET', `${V1}/airlines/code/RDO`, { token: f.token })).body.available, true);
  // changing the start mode drops the company too
  const sw = await h.call('PUT', `${V1}/onboarding`, { token: f.token, body: { startMode: 'hardcore' } });
  assert.deepEqual([sw.body.startMode, sw.body.companyId], ['hardcore', null]);
  assert.equal((await h.call('GET', `${V1}/me/companies`, { token: f.token })).body.length, 0);
  // once a flight exists the company is real
  const g = await founded(h, 'flown', { code: 'FLN' });
  run(h.db, `INSERT INTO flights (company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at)
    VALUES (?, (SELECT id FROM aircraft WHERE company_id = ?), 'C172', 'x', 'board', 'pax', 'LFPG', 'EGLL', 195, 100, 1, 1000, 'cancelled', 1)`, g.id, g.id);
  const blocked = await h.call('PUT', `${V1}/onboarding`, { token: g.token, body: { startMode: 'airliner' } });
  assert.equal(blocked.status, 409);
  assert.equal((await h.call('GET', `${V1}/me/companies`, { token: g.token })).body.length, 1);
});

test('POST /onboarding/complete needs the company and at least one aircraft; afterwards the onboarding is closed until a new start', async () => {
  const h = await harness();
  const f = await founded(h, 'finisher', { aircraft: null });
  const early = await h.call('POST', `${V1}/onboarding/complete`, { token: f.token });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'no_aircraft');
  run(h.db, "INSERT INTO aircraft (company_id, icao, location, value) VALUES (?, 'C172', 'LFPG', 1)", f.id);
  const done = await h.call('POST', `${V1}/onboarding/complete`, { token: f.token });
  assert.equal(done.status, 200, done.text);
  assert.deepEqual([done.body.completed, done.body.companyId, done.body.startMode], [true, f.id, 'hardcore']);
  assert.equal((await h.call('POST', `${V1}/onboarding/complete`, { token: f.token })).status, 200, 'idempotent');
  assert.equal((await h.call('PUT', `${V1}/onboarding`, { token: f.token, body: { step: 2 } })).status, 409, 'closed');
  // a new additional company from the switcher reopens it
  const next = await h.call('PUT', `${V1}/onboarding`, { token: f.token, body: { startMode: 'airliner' } });
  assert.deepEqual([next.status, next.body.completed, next.body.step, next.body.companyId, next.body.startMode], [200, false, 1, null, 'airliner']);
  assert.equal((await h.call('GET', `${V1}/me/companies`, { token: f.token })).body.length, 1, 'the finished company stays');
  const second = await h.call('POST', `${V1}/me/companies`, { token: f.token, body: { name: 'Second Base', hub: 'EGLL', code: 'SEC', callsign: 'SECOND', startMode: 'airliner' } });
  assert.equal(second.status, 201);
  assert.equal(second.body.companies.length, 2);
  assert.equal((await h.call('GET', `${V1}/onboarding`, { token: f.token })).body.companyId, second.body.company.id);
});

test('hub suggestions: at most 6 per mode, sized for the mode, real board counts and AI companies based there; search; validation', async () => {
  const h = await harness({ ai: true });
  const t = (await newcomer(h, 'scout')).token;
  const air = (await h.call('GET', `${V1}/onboarding/hubs?mode=airliner`, { token: t })).body;
  assert.ok(air.length > 0 && air.length <= 6);
  assert.ok(air.every((x: { size: string }) => x.size === 'large'));
  assert.deepEqual(Object.keys(air[0]).sort(), ['aiCompaniesBased', 'city', 'icao', 'jobsNearby', 'name', 'noteKey', 'note', 'parkingMonthly', 'size'].sort());
  assert.equal(air[0].parkingMonthly, 3900);
  const lfmn = air.find((x: { icao: string }) => x.icao === 'LFMN');
  assert.equal(lfmn.jobsNearby, jobsNearby(airports.get('LFMN')!, h.clock.t), 'counted on the real deterministic boards');
  assert.ok(lfmn.jobsNearby > 0);
  const egll = air.find((x: { icao: string }) => x.icao === 'EGLL');
  assert.equal(egll.aiCompaniesBased, 1, 'Aurora Airways is based at EGLL');
  assert.equal(lfmn.aiCompaniesBased, 0);
  const hc = (await h.call('GET', `${V1}/onboarding/hubs?mode=hardcore`, { token: t })).body;
  assert.ok(hc.length > 0 && hc.length <= 6 && hc.every((x: { size: string; parkingMonthly: number }) => x.size === 'small' && x.parkingMonthly === 450));
  const found = (await h.call('GET', `${V1}/onboarding/hubs?mode=airliner&q=nice`, { token: t })).body;
  assert.equal(found[0].icao, 'LFMN');
  assert.ok(found.every((x: { size: string }) => x.size === 'large'));
  assert.deepEqual((await h.call('GET', `${V1}/onboarding/hubs?mode=hardcore&q=zzzzqqq`, { token: t })).body, []);
  assert.equal((await h.call('GET', `${V1}/onboarding/hubs?mode=easy`, { token: t })).status, 400);
  assert.equal((await h.call('GET', `${V1}/onboarding/hubs`, { token: t })).status, 400);
  assert.equal((await h.call('GET', `${V1}/onboarding/hubs?mode=airliner`)).status, 401);
  assert.equal(jobsNearby(airports.get('LFMN')!, h.clock.t), jobsNearby(airports.get('LFMN')!, h.clock.t + 3_600_000), 'stable within a UTC day');
});

test('realism: preset or toggles; one changed toggle switches to custom; ownership and no_company; invalid bodies', async () => {
  const h = await harness();
  const a = await founded(h, 'real', { code: 'RLA' });
  const b = await founded(h, 'rival', { code: 'RLB' });
  const url = `${V1}/companies/${a.id}/realism`;
  const set = await h.call('PUT', url, { token: a.token, body: { preset: 'relaxed' } });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual([set.body.preset, set.body.payModifierPct, set.body.repModifierPct], ['relaxed', -5, -10]);
  assert.deepEqual([set.body.enforced.delayPenalties, set.body.enforced.realWeatherRequired, set.body.enforced.wearAndFailures], [false, false, true]);
  const tog = await h.call('PUT', url, { token: a.token, body: { toggles: { wearAndFailures: true } } });
  assert.equal(tog.body.preset, 'custom');
  assert.equal(tog.body.toggles.wearAndFailures, true);
  assert.equal(tog.body.payModifierPct, -5 + 10, 'sum of the active toggles');
  const same = await h.call('PUT', url, { token: a.token, body: { toggles: { wearAndFailures: true } } });
  assert.equal(same.body.preset, 'custom');
  const back = await h.call('PUT', url, { token: a.token, body: { preset: 'hardcore' } });
  assert.deepEqual([back.body.preset, back.body.payModifierPct, back.body.repModifierPct], ['hardcore', 30, 30]);
  const noChange = await h.call('PUT', url, { token: a.token, body: { toggles: { realFuelPrice: true } } });
  assert.equal(noChange.body.preset, 'hardcore', 'setting a toggle to the value it already has keeps the preset');
  assert.equal((await h.call('GET', `${V1}/me`, { token: a.token })).body.company.realism.preset, 'hardcore', 'shown on the company');
  assert.equal((await h.call('GET', url, { token: a.token })).body.preset, 'hardcore');
  for (const bad of [{}, { preset: 'custom' }, { preset: 'nope' }, { toggles: { unknown: true } }, { toggles: { pauseTolerance: 'yes' } }, { preset: 'balanced', toggles: {} }]) {
    assert.equal((await h.call('PUT', url, { token: a.token, body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await h.call('PUT', url, { token: b.token, body: { preset: 'relaxed' } })).status, 403, "another player's company");
  assert.equal((await h.call('GET', url, { token: b.token })).status, 403);
  assert.equal((await h.call('PUT', url, { body: { preset: 'relaxed' } })).status, 401);
  assert.equal((await h.call('PUT', `${V1}/companies/abc/realism`, { token: a.token, body: { preset: 'relaxed' } })).status, 404);
  const ghost = await newcomer(h, 'ghost2');
  assert.equal((await h.call('PUT', url, { token: ghost.token, body: { preset: 'relaxed' } })).status, 409, 'no company yet');
  assert.equal(wearEnabled(h.db, a.id), true);
  await h.call('PUT', url, { token: a.token, body: { preset: 'relaxed' } });
  assert.equal(wearEnabled(h.db, a.id), false);
  assert.equal(wearEnabled(h.db, 99999), false, 'unknown company: off');
});

test('realism modifiers apply to every paid flight: pay and reputation (verified and manual) and the real fuel price', async () => {
  const h = await harness();
  const pay = async (name: string, preset: 'relaxed' | 'balanced' | 'hardcore' | null, hub = 'LFPG') => {
    const p = await h.register(name, hub);
    if (preset) assert.equal((await h.call('PUT', `${V1}/companies/${p.me.company.id}/realism`, { token: p.token, body: { preset } })).status, 200);
    return p;
  };
  const fly = async (p: Awaited<ReturnType<typeof pay>>) => {
    const key = await h.apiKey(p.token);
    const job = await h.flyableJob(p.token, p.me.fleet[0].id);
    const acc = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: p.token, body: { aircraftId: p.me.fleet[0].id } });
    assert.equal(acc.status, 201, acc.text);
    const rep0 = (await h.call('GET', `${V1}/me`, { token: p.token })).body.company.reputation as number;
    const report = h.goodReport(job);
    const res = await h.call('POST', `${V1}/flights/${acc.body.id}/telemetry-verify`, { token: key, body: report });
    assert.equal(res.body.verification, 'verified', res.text);
    const rep1 = (await h.call('GET', `${V1}/me`, { token: p.token })).body.company.reputation as number;
    return { job, flight: res.body.flight, report, acceptedAt: acc.body.acceptedAt as number, repGain: Math.round((rep1 - rep0) * 1000) / 1000 };
  };

  const plain = await fly(await pay('plain', null));
  assert.equal(plain.flight.revenue, plain.job.payout, 'no realism: unchanged');
  assert.equal(plain.flight.fuelCost, Math.round(plain.report.fuelUsedKg * FUEL_PRICE_PER_KG));
  assert.equal(plain.repGain, 0.1);

  const hard = await fly(await pay('hard', 'hardcore'));
  assert.equal(hard.flight.revenue, Math.round(hard.job.payout * 1.3), '+30 % pay');
  assert.equal(hard.repGain, 0.1, 'rounded to one decimal by the API, so +30 % of 0.1 shows as 0.1; the ledger below is exact');
  const factor = fuelPriceFactor(hard.job.origin, hard.acceptedAt);
  assert.equal(hard.flight.fuelCost, Math.round(hard.report.fuelUsedKg * FUEL_PRICE_PER_KG * factor), 'real fuel price: per airport and day');
  assert.ok(factor >= 0.75 && factor <= 1.25);

  const relaxed = await fly(await pay('relaxed', 'relaxed'));
  assert.equal(relaxed.flight.revenue, Math.round(relaxed.job.payout * 0.95), '-5 % pay');
  assert.equal(relaxed.flight.fuelCost, Math.round(relaxed.report.fuelUsedKg * FUEL_PRICE_PER_KG), 'flat fuel price without the toggle');

  const bal = await fly(await pay('bal', 'balanced'));
  assert.equal(bal.flight.revenue, Math.round(bal.job.payout * 1.1), '+10 % pay');

  // manual completion: unverified pay is 60 % and the modifier applies on top
  const m = await pay('manual', 'hardcore');
  const job = await h.flyableJob(m.token, m.me.fleet[0].id);
  const acc = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: m.token, body: { aircraftId: m.me.fleet[0].id } });
  h.clock.t += 24 * 3_600_000;
  const done = await h.call('POST', `${V1}/flights/${acc.body.id}/complete`, { token: m.token });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.revenue, Math.round(job.payout * 0.6 * 1.3));

  // exact reputation from the stored value (the API rounds)
  const exact = (name: string) => get<{ reputation: number }>(h.db, 'SELECT c.reputation FROM companies c JOIN users u ON u.id = c.user_id WHERE u.username = ?', name)!.reputation;
  assert.ok(Math.abs(exact('hard') - (50 + 0.1 * 1.3)) < 1e-9);
  assert.ok(Math.abs(exact('relaxed') - (50 + 0.1 * 0.9)) < 1e-9);
  assert.ok(Math.abs(exact('plain') - 50.1) < 1e-9);
});

test('pauseTolerance: the bridge long_pause flag is ignored for a company that has it; other flags still reject', async () => {
  const h = await harness();
  const p = await h.register('pauser');
  const key = await h.apiKey(p.token);
  const cid = p.me.company.id as number;
  const attempt = async (flags: string[]) => {
    const job = await h.flyableJob(p.token, p.me.fleet[0].id);
    const acc = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: p.token, body: { aircraftId: p.me.fleet[0].id } });
    assert.equal(acc.status, 201, acc.text);
    return h.call('POST', `${V1}/flights/${acc.body.id}/telemetry-verify`, { token: key, body: { ...h.goodReport(job), flags } });
  };
  const neutral = await attempt(['long_pause']);
  assert.equal(neutral.body.verification, 'rejected');
  assert.match(neutral.body.reason, /long_pause/);
  await h.call('PUT', `${V1}/companies/${cid}/realism`, { token: p.token, body: { preset: 'hardcore' } });
  assert.equal((await attempt(['long_pause'])).body.verification, 'rejected', 'hardcore has no pause tolerance');
  await h.call('PUT', `${V1}/companies/${cid}/realism`, { token: p.token, body: { preset: 'balanced' } });
  assert.equal((await attempt(['long_pause'])).body.verification, 'verified', 'balanced tolerates pauses');
  const mixed = await attempt(['long_pause', 'slew_detected']);
  assert.equal(mixed.body.verification, 'rejected');
  assert.doesNotMatch(mixed.body.reason, /long_pause/);
  assert.match(mixed.body.reason, /slew_detected/);
});

test('first job: a flyable board job of the hub, reserved 2 h, stable across calls, hidden from and refused to others, expires', async () => {
  const h = await harness();
  const a = await founded(h, 'pilota', { hub: 'LFPG', mode: 'hardcore', code: 'PLA' });
  const url = `${V1}/companies/${a.id}/first-job`;
  const r1 = await h.call('GET', url, { token: a.token });
  assert.equal(r1.status, 200, r1.text);
  const job = r1.body.job as Job;
  assert.equal(job.origin, 'LFPG');
  assert.equal(r1.body.reservedUntil, h.clock.t + FIRST_JOB_RESERVATION_MS);
  assert.ok(job.kind === 'pax' ? job.pax <= 4 : job.payloadKg <= 60);
  h.clock.t += 30 * 60_000;
  const r2 = await h.call('GET', url, { token: a.token });
  assert.deepEqual(r2.body, r1.body, 'same job and same deadline while the reservation lasts');

  // another player with the same hub and a C172: the job is neither listed nor acceptable
  const b = await founded(h, 'pilotb', { hub: 'LFPG', code: 'PLB' });
  const aircraftB = get<{ id: number }>(h.db, 'SELECT id FROM aircraft WHERE company_id = ?', b.id)!.id;
  const board = (await h.call('GET', `${V1}/jobs`, { token: b.token })).body.jobs as Job[];
  assert.ok(!board.some((j) => j.id === job.id), 'not on the other board');
  const own = (await h.call('GET', `${V1}/jobs`, { token: a.token })).body.jobs as Job[];
  assert.ok(own.some((j) => j.id === job.id), 'still on the reserving company board');
  const steal = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: b.token, body: { aircraftId: aircraftB } });
  assert.equal(steal.status, 409);
  assert.equal(steal.body.error, 'job_reserved');
  assert.equal(get(h.db, 'SELECT 1 AS x FROM job_claims WHERE job_id = ?', job.id), undefined);
  // another company asking for its own first job at the same hub gets a different one
  const rb = await h.call('GET', `${V1}/companies/${b.id}/first-job`, { token: b.token });
  assert.notEqual(rb.body.job.id, job.id);

  // ownership
  assert.equal((await h.call('GET', url, { token: b.token })).status, 403);
  assert.equal((await h.call('GET', url)).status, 401);
  assert.equal((await h.call('GET', `${V1}/companies/abc/first-job`, { token: a.token })).status, 404);

  // the owner accepts it; the reservation is consumed
  const aircraftA = get<{ id: number }>(h.db, 'SELECT id FROM aircraft WHERE company_id = ?', a.id)!.id;
  const mine = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: a.token, body: { aircraftId: aircraftA } });
  assert.equal(mine.status, 201, mine.text);
  assert.equal(get(h.db, 'SELECT 1 AS x FROM job_reservations WHERE job_id = ?', job.id), undefined);
  assert.equal((await h.call('GET', `${V1}/companies/${a.id}/first-job`, { token: a.token })).status, 409, 'its only aircraft is flying: nothing to reserve');
});

test('first job: no aircraft is 409; a reservation outlives the 6 h board window for its owner; an expired one frees the job', async () => {
  const h = await harness();
  const c = await founded(h, 'noplane', { aircraft: null });
  const none = await h.call('GET', `${V1}/companies/${c.id}/first-job`, { token: c.token });
  assert.equal(none.status, 409);
  assert.equal(none.body.error, 'no_aircraft');

  const a = await founded(h, 'edgea', { hub: 'LFPG', code: 'EDA' });
  h.clock.t = Date.UTC(2026, 10, 4, 17, 30); // 30 min before the board refreshes
  const r = await h.call('GET', `${V1}/companies/${a.id}/first-job`, { token: a.token });
  const job = r.body.job as Job;
  h.clock.t = Date.UTC(2026, 10, 4, 18, 30);
  assert.notEqual(windowOf(h.clock.t), Number(job.id.split('-')[1]), 'the board moved on');
  const again = await h.call('GET', `${V1}/companies/${a.id}/first-job`, { token: a.token });
  assert.equal(again.body.job.id, job.id, 'still the same job');
  const aircraft = get<{ id: number }>(h.db, 'SELECT id FROM aircraft WHERE company_id = ?', a.id)!.id;
  const acc = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: a.token, body: { aircraftId: aircraft } });
  assert.equal(acc.status, 201, acc.text);

  // expiry: after 2 h another company may take the job
  const b = await founded(h, 'edgeb', { hub: 'LFPG', code: 'EDB' });
  h.clock.t = Date.UTC(2026, 10, 5, 7, 0);
  const rb = await h.call('GET', `${V1}/companies/${b.id}/first-job`, { token: b.token });
  const held = rb.body.job as Job;
  const c2 = await founded(h, 'edgec', { hub: 'LFPG', code: 'EDC' });
  const c2plane = get<{ id: number }>(h.db, 'SELECT id FROM aircraft WHERE company_id = ?', c2.id)!.id;
  assert.equal((await h.call('POST', `${V1}/jobs/${held.id}/accept`, { token: c2.token, body: { aircraftId: c2plane } })).status, 409);
  h.clock.t += FIRST_JOB_RESERVATION_MS + 1;
  if (windowOf(h.clock.t) === Number(held.id.split('-')[1])) {
    const open = (await h.call('GET', `${V1}/jobs`, { token: c2.token })).body.jobs as Job[];
    assert.ok(open.some((j) => j.id === held.id), 'back on the board once the reservation lapsed');
  }
  const afterB = await h.call('GET', `${V1}/companies/${b.id}/first-job`, { token: b.token });
  assert.equal(afterB.status, 200, 'the owner can ask again after expiry');
  assert.ok(afterB.body.reservedUntil > h.clock.t);
});

test('a reservation blocks the AI tick: reserved jobs are never claimed by an AI company, the same board is flown without it', () => {
  const T = Date.UTC(2026, 10, 4, 12);
  const world = () => { const db = openDb(':memory:'); seedAi(db, T); return db; };
  const tick = tickOf(T);
  const at = tick * TICK_MS;
  const egllIds = boardFor(airports.get('EGLL')!, windowOf(at)).map((j) => j.id);

  const free = world();
  runTick(free, tick);
  const claimedFree = all<{ job_id: string }>(free, "SELECT job_id FROM job_claims WHERE job_id LIKE 'EGLL-%'").map((c) => c.job_id);
  assert.ok(claimedFree.length > 0, 'control: Aurora Airways flies a job out of EGLL when nothing is reserved');

  const blocked = world();
  // job_reservations.company_id is UNIQUE: hold each job through its own reserving company
  for (const [i, id] of egllIds.entries()) {
    const c = run(blocked, 'INSERT INTO companies (name, balance, reputation, created_at) VALUES (?, 0, 50, 1)', `Holder ${i}`).id;
    reserve(blocked, c, id, at + FIRST_JOB_RESERVATION_MS);
  }
  runTick(blocked, tick);
  assert.deepEqual(all(blocked, "SELECT job_id FROM job_claims WHERE job_id LIKE 'EGLL-%'"), [], 'the AI took none of the reserved EGLL jobs');

  const expired = world();
  for (const [i, id] of egllIds.entries()) {
    const c = run(expired, 'INSERT INTO companies (name, balance, reputation, created_at) VALUES (?, 0, 50, 1)', `Holder ${i}`).id;
    reserve(expired, c, id, at - 1);
  }
  runTick(expired, tick);
  assert.ok(all(expired, "SELECT job_id FROM job_claims WHERE job_id LIKE 'EGLL-%'").length > 0, 'a lapsed reservation no longer blocks the AI');
});

test('bankruptcyBailout: clears a negative balance once per season when the toggle is on; off, positive or already used: nothing', async () => {
  const h = await harness();
  const p = await h.register('broke');
  const id = p.me.company.id as number;
  const set = (preset: 'relaxed' | 'hardcore') => h.call('PUT', `${V1}/companies/${id}/realism`, { token: p.token, body: { preset } });
  const bal = () => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', id)!.balance;
  const T = Date.UTC(2026, 10, 15);
  await set('relaxed'); // bailout on
  assert.equal(applyBailout(h.db, id, T), 0, 'positive balance: nothing to clear');
  run(h.db, 'UPDATE companies SET balance = -120000 WHERE id = ?', id);
  await set('hardcore'); // bailout off
  assert.equal(applyBailout(h.db, id, T), 0, 'toggle off');
  assert.equal(bal(), -120_000);
  await set('relaxed');
  assert.equal(tx(h.db, () => applyBailout(h.db, id, T)), 120_000);
  assert.equal(bal(), 0);
  const line = all<{ kind: string; amount: number; balance_after: number }>(h.db, "SELECT kind, amount, balance_after FROM transactions WHERE company_id = ? AND kind = 'bailout'", id);
  assert.deepEqual(line.map((l) => ({ ...l })), [{ kind: 'bailout', amount: 120_000, balance_after: 0 }]);
  run(h.db, 'UPDATE companies SET balance = -5000 WHERE id = ?', id);
  assert.equal(applyBailout(h.db, id, T + 86_400_000), 0, 'once per season');
  assert.equal(bal(), -5000);
  assert.equal(applyBailout(h.db, id, Date.UTC(2026, 11, 2)), 5000, 'next season it works again');
  assert.equal(applyBailout(h.db, id, Date.UTC(2026, 11, 3)), 0);
  assert.equal(applyBailout(h.db, 99999, T), 0, 'unknown company');
});

test('AI companies and pre-v2 companies stay neutral: no modifier, no wear, no bailout', async () => {
  const h = await harness({ ai: true });
  const lb = (await h.call('GET', `${V1}/leaderboard`)).body.rows.find((r: { isAI: boolean }) => r.isAI);
  const prof = (await h.call('GET', `${V1}/companies/${lb.companyId}`)).body;
  assert.equal(prof.id, lb.companyId);
  assert.equal(wearEnabled(h.db, lb.companyId), false);
  assert.equal(applyBailout(h.db, lb.companyId, h.clock.t), 0);
});
