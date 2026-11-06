import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_COMPANIES_PER_USER, STARTING_BALANCE } from '@opc/shared';
import { harness } from './harness.ts';

const V1 = '/api/v1';

/** Registers a pilot and gives them a second company (hub EGLL); returns both ids. */
async function twoCompanies(h: Awaited<ReturnType<typeof harness>>, name: string) {
  const a = await h.register(name);
  const r = await h.call('POST', `${V1}/me/companies`, { token: a.token, body: { name: `${name} Cargo`, hub: 'EGLL' } });
  assert.equal(r.status, 201, r.text);
  return { token: a.token, first: a.me.company.id as number, second: r.body.company.id as number, firstFleet: a.me.fleet[0].id as number, secondFleet: r.body.fleet[0].id as number };
}

test('a player creates more companies: same starting grant, own hub and fleet, listed in order; the active company defaults to the oldest', async () => {
  const h = await harness();
  const p = await twoCompanies(h, 'multi');
  const created = (await h.call('GET', `${V1}/me`, { token: p.token, company: p.second })).body;
  assert.equal(created.company.id, p.second);
  assert.equal(created.company.balance, STARTING_BALANCE);
  assert.deepEqual(created.hubs, ['EGLL']);
  assert.equal(created.fleet.length, 1);
  assert.deepEqual(created.companies.map((c: { id: number }) => c.id), [p.first, p.second]);
  assert.equal((await h.call('GET', `${V1}/me`, { token: p.token })).body.company.id, p.first, 'no header: the oldest company');
  assert.deepEqual((await h.call('GET', `${V1}/me/companies`, { token: p.token })).body.map((c: { name: string }) => c.name), ['multi Aviation', 'multi Cargo']);
  const ledger = (await h.call('GET', `${V1}/me/transactions`, { token: p.token, company: p.second })).body;
  assert.deepEqual(ledger.map((t: { kind: string }) => t.kind), ['grant']);
  assert.equal((await h.call('POST', `${V1}/me/companies`, { token: p.token, body: { name: 'Bad Hub', hub: 'ZZZZ' } })).status, 422);
  assert.equal((await h.call('POST', `${V1}/me/companies`, { token: p.token, body: { name: 'x', hub: 'EGLL' } })).status, 400);
  assert.equal((await h.call('POST', `${V1}/me/companies`, { body: { name: 'Nobody Air', hub: 'EGLL' } })).status, 401);
});

test('company cap: a player can own at most MAX_COMPANIES_PER_USER, and a failed create leaves no company behind', async () => {
  const h = await harness();
  const a = await h.register('capped');
  for (let i = 1; i < MAX_COMPANIES_PER_USER; i++) assert.equal((await h.call('POST', `${V1}/me/companies`, { token: a.token, body: { name: `Capped ${i}`, hub: 'LFPG' } })).status, 201);
  const over = await h.call('POST', `${V1}/me/companies`, { token: a.token, body: { name: 'One Too Many', hub: 'LFPG' } });
  assert.equal(over.status, 409);
  assert.equal(over.body.error, 'limit_reached');
  assert.equal((await h.call('GET', `${V1}/me/companies`, { token: a.token })).body.length, MAX_COMPANIES_PER_USER);
  const b = await h.register('uncapped');
  assert.equal((await h.call('POST', `${V1}/me/companies`, { token: b.token, body: { name: 'Fine Air', hub: 'LFPG' } })).status, 201, 'the cap is per player');
});

test('rename: validated, case-insensitively unique (409 name_taken), keeping own name or changing its case is fine', async () => {
  const h = await harness();
  const p = await twoCompanies(h, 'renamer');
  await h.register('rival');
  const rename = (id: number, name: unknown, token = p.token) => h.call('PATCH', `${V1}/companies/${id}`, { token, body: { name } });
  const ok = await rename(p.second, 'Skyline Freight');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, 'Skyline Freight');
  assert.equal(ok.body.id, p.second);
  assert.equal((await h.call('GET', `${V1}/companies/${p.second}`)).body.name, 'Skyline Freight', 'the public profile and leaderboard show the new name');
  assert.ok((await h.call('GET', `${V1}/leaderboard`)).body.rows.some((r: { name: string }) => r.name === 'Skyline Freight'));
  assert.equal((await rename(p.second, 'SKYLINE freight')).status, 200, 'only its own case changes');
  const clash = await rename(p.second, 'RIVAL aviation');
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'name_taken');
  assert.equal((await rename(p.second, 'renamer aviation')).status, 409, 'nor the name of your other company');
  assert.equal((await rename(p.second, '  ')).status, 400);
  assert.equal((await rename(p.second, 'x')).status, 400);
  assert.equal((await rename(p.second, 42)).status, 400);
  assert.equal((await h.call('GET', `${V1}/companies/${p.second}`)).body.name, 'SKYLINE freight', 'failed renames changed nothing');
  assert.equal((await h.call('PATCH', `${V1}/companies/${p.second}`, { body: { name: 'Anon Air' } })).status, 401);
  assert.equal((await h.call('PATCH', `${V1}/companies/abc`, { token: p.token, body: { name: 'Nope Air' } })).status, 404);
});

test('ownership: acting as, or renaming, a company that is not yours is 403 on every company-scoped route; nothing changes', async () => {
  const h = await harness();
  const mine = await h.register('owner');
  const theirs = await twoCompanies(h, 'victim');
  const flightJob = await h.flyableJob(theirs.token, theirs.firstFleet);
  const flight = (await h.call('POST', `${V1}/jobs/${flightJob.id}/accept`, { token: theirs.token, body: { aircraftId: theirs.firstFleet } })).body;
  const before = JSON.stringify((await h.call('GET', `${V1}/me`, { token: theirs.token })).body);
  const dbCounts = () => JSON.stringify(h.db.prepare("SELECT (SELECT COUNT(*) FROM companies) c, (SELECT COUNT(*) FROM aircraft) a, (SELECT COUNT(*) FROM hubs) h, (SELECT COUNT(*) FROM transactions) t, (SELECT COUNT(*) FROM custom_aircraft) k, (SELECT COUNT(*) FROM flights WHERE status = 'active') f").get());
  const counts = dbCounts();

  const attacks: [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?][] = [
    ['me', 'GET', '/me'],
    ['transactions', 'GET', '/me/transactions'],
    ['flights', 'GET', '/me/flights'],
    ['export csv', 'GET', '/me/export?format=flights.csv'],
    ['hubs', 'POST', '/me/hubs', { icao: 'EGLL' }],
    ['fleet', 'POST', '/me/fleet', { icao: 'C172', hub: 'EGLL' }],
    ['custom aircraft', 'POST', '/me/custom-aircraft', { icao: 'ZZZ1', name: 'X', category: 'piston-single', engines: 1, wtc: 'L', seats: 2, cargoKg: 0, cruiseKts: 100, rangeNm: 400 }],
    ['custom aircraft delete', 'DELETE', '/me/custom-aircraft/ZZZ1'],
    ['job board', 'GET', '/jobs'],
    ['simbrief import', 'POST', '/jobs/import-simbrief', { simbriefUsername: 'someone' }],
    ['accept', 'POST', `/jobs/${flightJob.id}/accept`, { aircraftId: theirs.secondFleet }],
    ['cancel', 'POST', `/flights/${flight.id}/cancel`],
    ['complete', 'POST', `/flights/${flight.id}/complete`],
    ['rename', 'PATCH', `/companies/${theirs.first}`, { name: 'Hijacked' }],
    ['list companies', 'GET', '/me/companies'],
    ['create company', 'POST', '/me/companies', { name: 'Hijack Two', hub: 'LFPG' }],
  ];
  for (const target of [theirs.first, theirs.second, 999_999]) {
    for (const [what, method, url, body] of attacks) {
      const r = await h.call(method, `${V1}${url}`, { token: mine.token, company: target, ...(body === undefined ? {} : { body }) });
      assert.equal(r.status, 403, `${what} as company ${target}: ${r.text}`);
      assert.equal(r.body.error, 'not_your_company');
    }
  }
  // PATCH names the company in the path: the header is the active company, the path is what gets renamed; both must be yours
  assert.equal((await h.call('PATCH', `${V1}/companies/${theirs.first}`, { token: mine.token, body: { name: 'Hijacked' } })).status, 403, 'rename by path, no header');
  assert.equal((await h.call('PATCH', `${V1}/companies/999999`, { token: mine.token, body: { name: 'Ghost Air' } })).status, 403, 'nonexistent looks the same as foreign');

  // malformed header values are a 400, not a silent fallback to the default company
  for (const bad of ['abc', '-1', '1.5', '1 ', '', '0x1']) assert.equal((await h.call('GET', `${V1}/me`, { token: mine.token, rawCompany: bad })).status, 400, `header "${bad}"`);

  assert.equal(JSON.stringify((await h.call('GET', `${V1}/me`, { token: theirs.token })).body), before, "the victim's company is unchanged");
  assert.equal(dbCounts(), counts, 'no row anywhere changed');
});

test('a flight belongs to its company: another company of the same player cannot cancel or complete it', async () => {
  const h = await harness();
  const p = await twoCompanies(h, 'flyer');
  const job = await h.flyableJob(p.token, p.firstFleet);
  const flight = (await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: p.token, company: p.first, body: { aircraftId: p.firstFleet } })).body;
  assert.equal(flight.companyId, p.first);
  assert.equal((await h.call('POST', `${V1}/flights/${flight.id}/cancel`, { token: p.token, company: p.second })).status, 404);
  assert.equal((await h.call('POST', `${V1}/flights/${flight.id}/complete`, { token: p.token, company: p.second })).status, 404);
  assert.equal((await h.call('POST', `${V1}/jobs/${job.id}/accept`, { token: p.token, company: p.second, body: { aircraftId: p.firstFleet } })).status, 404, "company 2 cannot use company 1's aircraft");
  assert.equal((await h.call('POST', `${V1}/flights/${flight.id}/cancel`, { token: p.token, company: p.first })).status, 200);
});

test('companies are isolated: fleet, hubs, flights, ledger, custom aircraft; the job claim follows the company that took it', async () => {
  const h = await harness();
  const p = await twoCompanies(h, 'iso');
  const as = (company: number) => ({ token: p.token, company });

  // company 1 buys an aircraft, a hub and defines a custom type; company 2 sees none of it
  assert.equal((await h.call('POST', `${V1}/me/fleet`, { ...as(p.first), body: { icao: 'C172', hub: 'LFPG' } })).status, 201);
  assert.equal((await h.call('POST', `${V1}/me/hubs`, { ...as(p.first), body: { icao: 'EGKK' } })).status, 201);
  assert.equal((await h.call('POST', `${V1}/me/custom-aircraft`, { ...as(p.first), body: { icao: 'ZZZ1', name: 'Homebuilt', category: 'piston-single', engines: 1, wtc: 'L', seats: 2, cargoKg: 50, cruiseKts: 90, rangeNm: 300 } })).status, 201);
  const one = (await h.call('GET', `${V1}/me`, as(p.first))).body;
  const two = (await h.call('GET', `${V1}/me`, as(p.second))).body;
  assert.equal(one.fleet.length, 2);
  assert.equal(two.fleet.length, 1);
  assert.deepEqual(one.hubs, ['EGKK', 'LFPG']);
  assert.deepEqual(two.hubs, ['EGLL']);
  assert.equal(one.customAircraft.length, 1);
  assert.equal(two.customAircraft.length, 0);
  assert.ok(one.company.balance < STARTING_BALANCE);
  assert.equal(two.company.balance, STARTING_BALANCE, 'spending in one company never touches the other');
  assert.equal((await h.call('POST', `${V1}/me/fleet`, { ...as(p.second), body: { icao: 'C172', hub: 'LFPG' } })).status, 422, "LFPG is not company 2's hub");
  assert.equal((await h.call('GET', `${V1}/me/transactions?limit=100`, as(p.second))).body.length, 1);

  // both companies fly; each has its own flights, ledger and stats; the pilot's rank counts both
  const key = await h.apiKey(p.token);
  const results: Record<number, number> = {};
  for (const [company, fleetId] of [[p.first, p.firstFleet], [p.second, p.secondFleet]] as const) {
    const job = await h.flyableJob(p.token, fleetId, company);
    const accepted = await h.call('POST', `${V1}/jobs/${job.id}/accept`, { ...as(company), body: { aircraftId: fleetId } });
    assert.equal(accepted.status, 201, accepted.text);
    const v = await h.call('POST', `${V1}/flights/${accepted.body.id}/telemetry-verify`, { token: key, body: h.goodReport(job) });
    assert.equal(v.body.verification, 'verified', v.text);
    results[company] = accepted.body.id;
  }
  assert.deepEqual((await h.call('GET', `${V1}/me/flights`, as(p.first))).body.map((f: { id: number }) => f.id), [results[p.first]]);
  assert.deepEqual((await h.call('GET', `${V1}/me/flights`, as(p.second))).body.map((f: { id: number }) => f.id), [results[p.second]]);
  for (const company of [p.first, p.second]) {
    const me = (await h.call('GET', `${V1}/me`, as(company))).body;
    const ledger = (await h.call('GET', `${V1}/me/transactions?limit=200`, as(company))).body as { amount: number; flightId: number | null }[];
    assert.equal(me.company.flights, 1);
    assert.equal(ledger.reduce((s, t) => s + t.amount, 0), me.company.balance, 'each ledger sums to its own balance');
    assert.ok(ledger.every((t) => t.flightId === null || t.flightId === results[company]), 'no foreign flight in the ledger');
  }
  const me = (await h.call('GET', `${V1}/me`, as(p.first))).body;
  assert.equal(me.pilot.flights, 2, 'pilot flights = sum over companies');
  assert.equal(me.pilot.hours, Math.round((me.companies[0].hours + me.companies[1].hours) * 10) / 10);
  assert.ok(me.pilot.hours > 0);

  // leaderboard: each company ranks on its own
  const rows = (await h.call('GET', `${V1}/leaderboard`)).body.rows as { companyId: number }[];
  assert.equal(rows.filter((r) => [p.first, p.second].includes(r.companyId)).length, 2);
});

test('pilot rank is derived over all companies: flights and hours split across companies still add up', async () => {
  const h = await harness();
  const p = await twoCompanies(h, 'ranker');
  h.db.prepare('UPDATE companies SET flights = 2, hours = 3 WHERE id = ?').run(p.first);
  h.db.prepare('UPDATE companies SET flights = 2, hours = 3 WHERE id = ?').run(p.second);
  const me = (await h.call('GET', `${V1}/me`, { token: p.token, company: p.second })).body;
  assert.deepEqual(me.pilot, { rank: 'Private Pilot', hours: 6, flights: 4 }, '4 flights and 6 h earn Private Pilot (5 h, 3 flights), though neither company does alone');
  assert.equal(me.company.flights, 2, 'company stats stay per company');
});

test('API key spans the player\'s companies: lists active flights of all, verifies a second company\'s flight, still cannot touch another player\'s', async () => {
  const h = await harness();
  const p = await twoCompanies(h, 'keys');
  const other = await h.register('outsider');
  const key = await h.apiKey(p.token);
  const outsiderKey = await h.apiKey(other.token);
  const pick = await h.flyableJob(p.token, p.secondFleet, p.second);
  const flight = (await h.call('POST', `${V1}/jobs/${pick.id}/accept`, { token: p.token, company: p.second, body: { aircraftId: p.secondFleet } })).body;
  const active = (await h.call('GET', `${V1}/flights/active`, { token: key })).body;
  assert.deepEqual(active.map((f: { id: number; companyId: number }) => [f.id, f.companyId]), [[flight.id, p.second]], 'the key sees company 2\'s flight with its company id');
  assert.equal((await h.call('GET', `${V1}/flights/active`, { token: outsiderKey })).body.length, 0);
  const report = h.goodReport(pick);
  assert.equal((await h.call('POST', `${V1}/flights/${flight.id}/telemetry-verify`, { token: outsiderKey, body: report })).status, 404, "another player's key cannot report on it");
  const before = (await h.call('GET', `${V1}/me`, { token: p.token, company: p.second })).body.company;
  const v = await h.call('POST', `${V1}/flights/${flight.id}/telemetry-verify`, { token: key, body: report });
  assert.equal(v.status, 200, v.text);
  assert.equal(v.body.verification, 'verified');
  assert.equal(v.body.flight.companyId, p.second);
  const after = (await h.call('GET', `${V1}/me`, { token: p.token, company: p.second })).body.company;
  assert.equal(after.balance, before.balance + v.body.flight.net, 'paid into company 2');
  assert.equal(after.flights, 1);
  assert.equal((await h.call('GET', `${V1}/me`, { token: p.token, company: p.first })).body.company.flights, 0, 'company 1 untouched');
  assert.equal((await h.call('GET', `${V1}/me`, { token: key })).status, 401, 'a key still cannot read the account');
  assert.equal((await h.call('GET', `${V1}/flights/active`, { token: key, company: p.first })).status, 200, 'the company header means nothing to a key (it is not used)');
});

test('export covers every company of the player and no one else\'s; account deletion removes all of them', async () => {
  const h = await harness();
  const p = await twoCompanies(h, 'exp');
  await h.register('bystander');
  const d = (await h.call('GET', `${V1}/me/export`, { token: p.token })).body;
  assert.equal(d.schemaVersion, 2);
  assert.deepEqual(d.companies.map((c: { company: { id: number } }) => c.company.id), [p.first, p.second]);
  assert.ok(d.companies.every((c: { fleet: unknown[]; transactions: unknown[] }) => c.fleet.length === 1 && c.transactions.length === 1));
  const csv = await h.call('GET', `${V1}/me/export?format=transactions.csv`, { token: p.token, company: p.second });
  assert.equal(csv.text.trim().split('\r\n').length, 2, 'CSV exports follow the active company');
  assert.equal((await h.call('DELETE', `${V1}/me`, { token: p.token, body: { password: 'correct horse' } })).status, 204);
  assert.equal((h.db.prepare('SELECT COUNT(*) n FROM companies').get() as { n: number }).n, 1, 'only the bystander\'s company remains');
  assert.equal((h.db.prepare('SELECT COUNT(*) n FROM aircraft').get() as { n: number }).n, 1);
});

test('CORS: preflight allows PATCH and the X-OPC-Company header', async () => {
  const h = await harness();
  const r = await h.app.inject({ method: 'OPTIONS', url: '/api/v1/companies/1', headers: { origin: 'https://app.example', 'access-control-request-method': 'PATCH' } });
  assert.equal(r.statusCode, 204);
  assert.match(String(r.headers['access-control-allow-methods']), /PATCH/);
  assert.match(String(r.headers['access-control-allow-headers']), /x-opc-company/);
});
