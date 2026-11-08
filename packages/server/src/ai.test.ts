import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cannotFly, settle, type Job } from '@opc/shared';
import { AI_COMPANIES, TICK_MS, catchUp, runTick, seedAi, tickOf } from './ai.ts';
import { airports } from './catalog.ts';
import { openDb, tx, all, get, run } from './db.ts';
import { finishFlight, openBoard, startFlight, typeFor, leaderboard, companyProfile, type AircraftRow, type FlightRow } from './game.ts';
import { catchUpLines } from './lines.ts';
import { harness } from './harness.ts';

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);

const world = () => {
  const db = openDb(':memory:');
  seedAi(db, T0);
  return db;
};
const snapshotState = (db: ReturnType<typeof openDb>) => JSON.stringify({
  companies: all(db, 'SELECT id, balance, reputation, flights, hours, revenue FROM companies ORDER BY id'),
  aircraft: all(db, 'SELECT * FROM aircraft ORDER BY id'),
  claims: all(db, 'SELECT job_id, company_id FROM job_claims ORDER BY job_id'),
  tx: get(db, 'SELECT COUNT(*) n, SUM(amount) s FROM transactions'),
});

test('seeding creates the AI companies once, each with personality, hub and starter aircraft', () => {
  const db = world();
  seedAi(db, T0 + 1000);
  const rows = all<{ name: string; personality: string; user_id: number | null }>(db, 'SELECT name, personality, user_id FROM companies ORDER BY id');
  assert.equal(rows.length, AI_COMPANIES.length);
  assert.ok(rows.every((r) => r.user_id === null && JSON.parse(r.personality).style));
  assert.ok(new Set(rows.map((r) => JSON.parse(r.personality).style)).size === 2, 'both aggressive and cautious exist');
  assert.equal((get(db, 'SELECT COUNT(*) n FROM aircraft') as { n: number }).n, AI_COMPANIES.length);
});

test('a tick is idempotent by tick index: replaying it changes nothing', () => {
  const db = world();
  const tick = tickOf(T0);
  assert.equal(runTick(db, tick), true);
  const once = snapshotState(db);
  assert.equal(runTick(db, tick), false);
  assert.equal(snapshotState(db), once);
  assert.notEqual(once, snapshotState(world()), 'the tick actually did something');
});

test('ticks are deterministic: two fresh servers play identical games', () => {
  const a = world(), b = world();
  for (let t = tickOf(T0); t < tickOf(T0) + 10; t++) { runTick(a, t); runTick(b, t); }
  assert.equal(snapshotState(a), snapshotState(b));
});

test('catchUp plays only the due ticks and is a no-op when up to date', () => {
  const db = world();
  const first = catchUp(db, T0 + 2 * TICK_MS);
  assert.ok(first >= 3, `warm-up + due ticks played, got ${first}`);
  assert.equal(catchUp(db, T0 + 2 * TICK_MS + 1000), 0);
  assert.equal(catchUp(db, T0 + 3 * TICK_MS), 1);
  // after a long outage the backlog is bounded, never replayed from the start
  assert.ok(catchUp(db, T0 + 1000 * TICK_MS) <= 12);
});

test('AI takes jobs from the shared board with the same ledger rules; money is conserved per company', () => {
  const db = world();
  for (let t = tickOf(T0) - 8; t <= tickOf(T0) + 20; t++) runTick(db, t);
  const flights = get<{ n: number }>(db, "SELECT COUNT(*) n FROM flights WHERE status = 'verified'")!.n;
  assert.ok(flights > 20, `AI flew ${flights} flights`);
  for (const c of all<{ id: number; balance: number }>(db, 'SELECT id, balance FROM companies')) {
    const sum = get<{ s: number }>(db, 'SELECT SUM(amount) s FROM transactions WHERE company_id = ?', c.id)!.s;
    assert.equal(sum, c.balance, `ledger of company ${c.id}`);
    assert.ok(c.balance >= 0, 'AI never overspends');
  }
  const dup = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM (SELECT job_id FROM flights GROUP BY job_id HAVING COUNT(*) > 1)')!.n;
  assert.equal(dup, 0, 'no job flown twice');
  const orphan = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM flights f WHERE NOT EXISTS (SELECT 1 FROM job_claims c WHERE c.job_id = f.job_id)')!.n;
  assert.equal(orphan, 0, 'every flight holds a claim');
});

test('AI companies grow: they buy aircraft and finish the season ahead of their start', () => {
  const db = world();
  // v3: an AI aircraft on a line is flown by the line clock, so the world plays both clocks as the app does (a 6 h AI tick, then the 15 min line ticks up to its end)
  for (let t = tickOf(T0) - 8; t <= tickOf(T0) + 60; t++) { runTick(db, t); catchUpLines(db, (t + 1) * TICK_MS - 1); }
  const fleet = get<{ n: number }>(db, 'SELECT COUNT(*) n FROM aircraft')!.n;
  assert.ok(fleet > AI_COMPANIES.length, `fleet grew to ${fleet}`);
  const lb = leaderboard(db, '2026-11', T0 + 60 * TICK_MS);
  assert.equal(lb.rows.length, AI_COMPANIES.length);
  assert.ok(lb.rows.every((r) => r.isAI && r.netWorth > 400_000), 'every AI is worth more than its starting capital');
  assert.deepEqual(lb.rows.map((r) => r.rank), lb.rows.map((_, i) => i + 1));
  assert.ok(lb.rows.every((r, i) => i === 0 || lb.rows[i - 1]!.netWorth >= r.netWorth), 'sorted by net worth');
});

test('aggressive and cautious companies behave differently', () => {
  const db = world();
  for (let t = tickOf(T0) - 8; t <= tickOf(T0) + 40; t++) runTick(db, t);
  const byStyle = (style: string) => all<{ id: number; personality: string }>(db, 'SELECT id, personality FROM companies').filter((c) => JSON.parse(c.personality).style === style)
    .reduce((s, c) => s + get<{ n: number }>(db, 'SELECT COUNT(*) n FROM flights WHERE company_id = ?', c.id)!.n, 0);
  assert.notEqual(byStyle('aggressive'), byStyle('cautious'));
});

test('a company profile shows personality, fleet and season history', () => {
  const db = world();
  for (let t = tickOf(T0) - 8; t <= tickOf(T0) + 10; t++) runTick(db, t);
  const id = (get(db, 'SELECT id FROM companies ORDER BY id LIMIT 1') as { id: number }).id;
  const p = companyProfile(db, id);
  assert.ok(p.isAI && p.personality && p.hubs.length === 1 && p.fleet.length >= 1);
  assert.equal(p.seasons[0]?.season, '2026-11');
});

test('concurrency: many companies claiming the same job - exactly one wins, the rest get job_taken', () => {
  const db = world();
  const lowId = (get(db, 'SELECT MIN(id) id FROM companies') as { id: number }).id;
  const aircraft = get<AircraftRow>(db, 'SELECT * FROM aircraft WHERE company_id = ?', lowId)!;
  const job = openBoard(db, aircraft.location, T0).find((j) => !cannotFly(typeFor(db, lowId, aircraft.icao), j))!;
  assert.ok(job);
  const rivals = all<AircraftRow>(db, 'SELECT * FROM aircraft ORDER BY id');
  let won = 0, lost = 0;
  for (const a of rivals) {
    try {
      tx(db, () => { run(db, 'UPDATE aircraft SET location = ? WHERE id = ?', job.origin, a.id); startFlight(db, a.company_id, job, { ...a, location: job.origin }, T0); });
      won++;
    } catch (e) {
      assert.equal((e as { code?: string }).code, 'job_taken');
      lost++;
    }
  }
  assert.equal(won, 1);
  assert.equal(lost, rivals.length - 1);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM job_claims WHERE job_id = ?', job.id)!.n, 1);
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) n FROM flights WHERE job_id = ?', job.id)!.n, 1, 'a failed claim leaves no flight behind');
});

test('claims are enforced by the database even outside the transaction helper (unique key)', () => {
  const db = world();
  const [a, b] = all<{ id: number }>(db, 'SELECT id FROM companies ORDER BY id LIMIT 2');
  run(db, 'INSERT INTO job_claims (job_id, company_id, claimed_at) VALUES (?, ?, ?)', 'X-1-0', a!.id, T0);
  assert.throws(() => run(db, 'INSERT INTO job_claims (job_id, company_id, claimed_at) VALUES (?, ?, ?)', 'X-1-0', b!.id, T0), /UNIQUE/);
});

test('AI claims remove jobs from the player board and a player cannot take them', async () => {
  const h = await harness({ ai: false });
  seedAi(h.db, h.clock.t);
  const p = await h.register('racer');
  for (let t = tickOf(h.clock.t) - 8; t <= tickOf(h.clock.t); t++) runTick(h.db, t);
  const claimed = all<{ job_id: string }>(h.db, "SELECT job_id FROM job_claims WHERE job_id LIKE 'EGLL-%' OR job_id LIKE 'KJFK-%'");
  assert.ok(claimed.length > 0, 'AI took jobs at its hubs');
  const board = (await h.call('GET', '/api/v1/jobs?airport=KJFK', { token: p.token })).body.jobs as Job[];
  const pool = new Set(claimed.map((c) => c.job_id));
  assert.ok(board.every((j) => !pool.has(j.id)));
  const stolen = claimed.find((c) => c.job_id.startsWith(`KJFK-${Math.floor(h.clock.t / (6 * 3_600_000))}-`));
  if (stolen) assert.equal((await h.call('POST', `/api/v1/jobs/${stolen.job_id}/accept`, { token: p.token, body: { aircraftId: p.me.fleet[0].id } })).status, 422);
});

test('API requests lazily run due ticks and the leaderboard lists AI companies next to the player', async () => {
  const h = await harness({ ai: true });
  const p = await h.register('lazy');
  h.clock.t += 5 * TICK_MS;
  const lb = (await h.call('GET', '/api/v1/leaderboard')).body;
  assert.equal(lb.season, '2026-11');
  assert.ok(lb.rows.some((r: { name: string }) => r.name === 'lazy Aviation'));
  assert.equal(lb.rows.filter((r: { isAI: boolean }) => r.isAI).length, AI_COMPANIES.length);
  const ticks = (get(h.db, 'SELECT COUNT(*) n FROM ai_ticks') as { n: number }).n;
  await h.call('GET', '/api/v1/leaderboard');
  assert.equal((get(h.db, 'SELECT COUNT(*) n FROM ai_ticks') as { n: number }).n, ticks, 'no tick replay on a repeated request');
  assert.ok(ticks >= 5);
  const first = lb.rows[0];
  const profile = (await h.call('GET', `/api/v1/companies/${first.companyId}`)).body;
  assert.equal(profile.name, first.name);
  assert.equal((await h.call('GET', '/api/v1/companies/99999')).status, 404);
  assert.equal((await h.call('GET', '/api/v1/leaderboard?season=nope')).status, 400);
  void p;
});

test('leaderboard keeps the past: a finished season is served from its snapshot', async () => {
  const h = await harness({ ai: true });
  await h.register('seasonal');
  h.clock.t += 20 * TICK_MS;
  await h.call('GET', '/api/v1/leaderboard');
  const frozen = (await h.call('GET', '/api/v1/leaderboard')).body;
  h.clock.t = Date.UTC(2026, 11, 2);
  const dec = (await h.call('GET', '/api/v1/leaderboard')).body;
  assert.equal(dec.season, '2026-12');
  assert.deepEqual(dec.seasons.slice(0, 2), ['2026-12', '2026-11']);
  const nov = (await h.call('GET', '/api/v1/leaderboard?season=2026-11')).body;
  assert.ok(nov.rows.length >= AI_COMPANIES.length);
  assert.ok(nov.rows.some((r: { flights: number }) => r.flights > 0));
  void frozen;
});

test('every leaderboard row carries its company\'s main hub, a player\'s and an AI\'s, in the current season and a past one; null without a hub', async () => {
  const h = await harness({ ai: true });
  const jal = await h.register('jal', 'RJTT');
  const bare = await h.register('bare', 'LFPG');
  run(h.db, 'DELETE FROM hubs WHERE company_id = ?', bare.me.company.id);
  run(h.db, 'INSERT INTO hubs (company_id, icao) VALUES (?, ?)', jal.me.company.id, 'EGLL');
  const hubs = async (season?: string) => new Map(((await h.call('GET', `/api/v1/leaderboard${season ? `?season=${season}` : ''}`)).body.rows as { companyId: number; isAI: boolean; hub: string | null }[]).map((r) => [r.companyId, r]));
  const now = await hubs();
  assert.equal(now.get(jal.me.company.id)!.hub, 'EGLL', 'the first of its hubs by ICAO, as me.hubs[0]');
  assert.equal(now.get(bare.me.company.id)!.hub, null);
  const ai = [...now.values()].find((r) => r.isAI)!;
  assert.equal(ai.hub, (await h.call('GET', `/api/v1/companies/${ai.companyId}`)).body.hubs[0]);
  assert.ok([...now.values()].filter((r) => r.isAI).every((r) => r.hub));
  for (const c of [jal.me.company.id, bare.me.company.id, ai.companyId]) run(h.db, "INSERT INTO season_stats (season, company_id, net_worth, flights, reputation) VALUES ('2026-10', ?, 1, 0, 50)", c);
  const past = await hubs('2026-10');
  assert.deepEqual([...past.values()].map((r) => [r.companyId, r.hub]).sort(), [[jal.me.company.id, 'EGLL'], [bare.me.company.id, null], [ai.companyId, ai.hub]].sort());
});

test('player and AI share one profit formula: a manually driven flight equals settle()', () => {
  const db = world();
  const ai = get<AircraftRow>(db, 'SELECT * FROM aircraft ORDER BY id LIMIT 1')!;
  const job = openBoard(db, ai.location, T0).find((j) => !cannotFly(typeFor(db, ai.company_id, ai.icao), j))!;
  assert.ok(job, 'a job the first AI starter can fly exists at its hub');
  const f = tx(db, () => finishFlight(db, startFlight(db, ai.company_id, job, ai, T0), 'verified', T0)) as FlightRow;
  const expected = settle({ payout: job.payout, distanceNm: job.distanceNm, aircraft: typeFor(db, ai.company_id, ai.icao), status: 'verified', destSize: airports.get(job.destination)!.size, destIsHub: false });
  assert.equal(f.net, expected.net);
  assert.equal(f.revenue, expected.revenue);
});
