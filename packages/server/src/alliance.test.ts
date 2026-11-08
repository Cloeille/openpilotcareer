import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALLIANCE_DUES_PCT, ALLIANCE_MAX_MEMBERS, ALLIANCE_NOTICE_MS, categoryOf, duesFor, type AllianceView, type MemberView } from '@opc/shared';
import { allianceDues, memberView } from './alliance.ts';
import { all, get, MIGRATIONS, openDb, run } from './db.ts';
import { runBilling } from './finance.ts';
import { post } from './ledger.ts';
import { harness } from './harness.ts';

const V1 = '/api/v1';
const DAY = 86_400_000;
type H = Awaited<ReturnType<typeof harness>>;
type User = Awaited<ReturnType<H['register']>>;

/** The five fields of C23, and nothing else. */
const ALLOWED = ['fleet', 'name', 'online', 'reputation', 'username'];

async function world(o: { ai?: boolean } = {}) {
  const h = await harness({ ai: o.ai ?? false });
  const amy = await h.register('amy'), ben = await h.register('ben'), cy = await h.register('cyd');
  const id = (u: User): number => u.me.company.id as number;
  const name = (u: User): string => u.me.company.name as string;
  const call = (u: User, method: 'GET' | 'POST', url: string, body?: unknown, company?: number) =>
    h.call(method, `${V1}${url}`, { token: u.token, ...(body === undefined ? {} : { body }), ...(company === undefined ? {} : { company }) });
  const found = (u: User, club = 'Skyline Club') => call(u, 'POST', '/alliance', { name: club });
  const invite = (u: User, who: User) => call(u, 'POST', '/alliance/invite', { name: name(who) });
  const ballot = (u: User, vote: number, choice: 'yes' | 'no') => call(u, 'POST', `/alliance/votes/${vote}/ballot`, { choice });
  const join = (u: User, vote: number) => call(u, 'POST', `/alliance/invitations/${vote}/join`);
  /** Amy founds, Ben is invited (her ballot is a yes: unanimous) and joins. */
  const pair = async () => {
    assert.equal((await found(amy)).status, 201);
    const v = (await invite(amy, ben)).body.votes[0];
    assert.equal(v.status, 'accepted');
    assert.equal((await join(ben, v.id)).status, 200);
  };
  const txs = (u: User, kind: string) => all<{ amount: number; at: number; memo: string }>(h.db, 'SELECT amount, at, memo FROM transactions WHERE company_id = ? AND kind = ? ORDER BY id', id(u), kind);
  const balance = (u: User): number => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', id(u))!.balance;
  /** The clock moves; sessions are kept alive (they last 30 days). */
  const advance = (days: number): void => { h.clock.t += days * DAY; run(h.db, 'UPDATE sessions SET expires_at = ?', h.clock.t + 30 * DAY); };
  return { h, amy, ben, cy, id, name, call, found, invite, ballot, join, pair, txs, balance, advance };
}

// ---------------------------------------------------------------- C23: what a member sees of another

test('a member sees five fields of another company and nothing else, whatever the row holds', async () => {
  const w = await world();
  // Give Ben everything that must stay his: a distinctive balance, staff, a line, a column nobody planned for.
  w.h.db.exec('ALTER TABLE companies ADD COLUMN secret TEXT');
  w.h.db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  run(w.h.db, 'UPDATE companies SET balance = 7654321, secret = ?, code = ?, callsign = ? WHERE id = ?', 'hunter2-secret', 'BNX', 'BENCALL', w.id(w.ben));
  run(w.h.db, "UPDATE users SET email = 'ben@private.example' WHERE username = 'ben'");
  await w.pair();

  const res = await w.call(w.amy, 'GET', '/alliance');
  assert.equal(res.status, 200, res.text);
  const view = res.body as AllianceView;
  assert.deepEqual(view.members.map((m) => m.username), ['amy', 'ben']);
  for (const m of view.members) assert.deepEqual(Object.keys(m).sort(), ALLOWED);
  assert.deepEqual(Object.keys(view).sort(), ['dues', 'leavesAt', 'members', 'name', 'votes']);
  const ben = view.members.find((m) => m.username === 'ben')!;
  assert.deepEqual(ben, { name: w.name(w.ben), username: 'ben', fleet: 1, reputation: 50, online: true });

  const passHashes = all<{ pass_hash: string }>(w.h.db, 'SELECT pass_hash FROM users').map((u) => u.pass_hash);
  for (const secret of ['7654321', 'hunter2-secret', 'BNX', 'BENCALL', 'ben@private.example', 'balance', 'email', 'staff', 'ledger', 'routes', ...passHashes]) {
    assert.ok(!res.text.includes(secret), `the alliance view leaks ${secret}`);
  }
  // the same function is the only way a member's data leaves: its output is built field by field
  assert.deepEqual(Object.keys(memberView(w.h.db, w.id(w.ben), w.h.clock.t)).sort(), ALLOWED);
});

test('online is the presence signal: a member who made a request in the last five minutes is online', async () => {
  const w = await world();
  await w.pair();
  w.advance(1 / 24); // an hour: nobody has made a request since they joined
  const stale = (await w.call(w.amy, 'GET', '/alliance')).body.members as MemberView[]; // Amy's own request refreshes her presence, not Ben's
  assert.deepEqual(stale.map((m) => [m.username, m.online]), [['amy', true], ['ben', false]]);
  await w.call(w.ben, 'GET', '/alliance');
  const fresh = (await w.call(w.amy, 'GET', '/alliance')).body.members as MemberView[];
  assert.deepEqual(fresh.map((m) => m.online), [true, true]);
});

test('reputation is shown on the stored 0 to 100 scale, rounded to a tenth, and the fleet counts aircraft she still has', async () => {
  const w = await world();
  await w.pair();
  run(w.h.db, 'UPDATE companies SET reputation = 61.37 WHERE id = ?', w.id(w.ben));
  run(w.h.db, 'UPDATE aircraft SET returned_at = 1 WHERE company_id = ?', w.id(w.ben));
  const ben = (await w.call(w.amy, 'GET', '/alliance')).body.members.find((m: MemberView) => m.username === 'ben') as MemberView;
  assert.deepEqual([ben.reputation, ben.fleet], [61.4, 0]);
});

// ---------------------------------------------------------------- B.1: 404 for a stranger, 401 for an API key

test('a non-member gets 404 on every alliance route (never 403), an API key or no token 401, and another player\'s company in the header is the usual 403', async () => {
  const w = await world();
  await w.pair();
  const stranger = w.cy;
  const probes: Array<['GET' | 'POST', string, unknown?]> = [
    ['GET', '/alliance'], ['POST', '/alliance/invite', { name: w.name(w.ben) }], ['POST', '/alliance/votes/1/ballot', { choice: 'yes' }], ['POST', '/alliance/leave'],
  ];
  for (const [method, url, body] of probes) {
    const r = await w.call(stranger, method, url, body);
    assert.deepEqual([url, r.status, r.body.error, r.body.message], [url, 404, 'not_in_alliance', 'not found'], r.text);
  }
  assert.equal((await w.call(stranger, 'POST', '/alliance/votes/abc/ballot', { choice: 'yes' })).status, 404, 'a malformed id is a 404 too');
  // joining is for a company that was voted in: for anyone else the invitation does not exist, and there is none to list
  assert.deepEqual([(await w.join(stranger, 1)).status, (await w.call(stranger, 'GET', '/alliance/invitations')).body], [404, []]);
  // a player's other company is not the member company: the header scopes the answer
  const second = await w.h.call('POST', `${V1}/me/companies`, { token: w.amy.token, body: { name: 'Amy Cargo', hub: 'LFPG' } });
  assert.equal(second.status, 201, second.text);
  assert.equal((await w.call(w.amy, 'GET', '/alliance', undefined, second.body.company.id)).status, 404);
  assert.equal((await w.call(w.amy, 'GET', '/alliance', undefined, w.id(w.ben))).status, 403, 'the header check is the existing ownership rule and says nothing about alliances');
  const key = await w.h.apiKey(w.amy.token);
  for (const [method, url, body] of probes) {
    for (const token of [key, undefined]) {
      const r = await w.h.call(method, `${V1}${url}`, { ...(token ? { token } : {}), ...(body === undefined ? {} : { body }) });
      assert.equal(r.status, 401, `${method} ${url}`);
    }
  }
  assert.equal((await w.h.call('GET', `${V1}/alliance/invitations`, { token: key })).status, 401);
});

test('a vote of another alliance does not exist for a member, and a stranger never sees who is being voted on', async () => {
  const w = await world();
  const dan = await w.h.register('dani'), eve = await w.h.register('evan');
  await w.found(w.amy, 'Alpha Club');
  assert.equal((await w.found(dan, 'Delta Club')).status, 201);
  const vote = (await w.invite(w.amy, w.ben)).body.votes[0];
  const v2 = (await w.call(dan, 'POST', '/alliance/invite', { name: w.name(eve) })).body.votes[0];
  assert.equal((await w.ballot(dan, vote.id, 'no')).status, 404, 'Alpha\'s vote is not Dan\'s');
  assert.deepEqual((await w.ballot(dan, vote.id, 'no')).body.error, 'vote_not_found');
  assert.equal((await w.join(eve, vote.id)).status, 404, 'an invitation belongs to its candidate');
  assert.equal((await w.join(w.ben, v2.id)).status, 404);
  assert.deepEqual((await w.call(w.cy, 'GET', '/alliance/invitations')).body, []);
  assert.equal(all(w.h.db, 'SELECT * FROM alliance_ballots WHERE company_id = ?', w.id(dan)).length, 1, 'Dan\'s only ballot is his own yes');
});

// ---------------------------------------------------------------- admission is unanimous, one ballot per company

test('admission is unanimous: one refusal refuses, the candidate joins only a vote every member accepted, and a company has one ballot', async () => {
  const w = await world();
  await w.pair();
  const open = (await w.invite(w.amy, w.cy)).body.votes[0];
  assert.deepEqual([open.status, open.yes, open.no, open.members, open.mine], ['open', 1, 0, 2, 'yes'], 'the proposer\'s yes is counted; Ben has not answered');
  assert.deepEqual([(await w.call(w.cy, 'GET', '/alliance/invitations')).body, (await w.join(w.cy, open.id)).status], [[], 404], 'Cy cannot join a vote that is not unanimous');
  assert.equal((await w.invite(w.ben, w.cy)).body.error, 'already_invited');

  const refused = (await w.ballot(w.ben, open.id, 'no')).body.votes[0];
  assert.deepEqual([refused.status, refused.yes, refused.no, refused.mine], ['refused', 1, 1, 'no']);
  assert.equal((await w.ballot(w.ben, open.id, 'yes')).body.error, 'already_voted', 'a ballot is final');
  assert.equal((await w.ballot(w.amy, open.id, 'no')).status, 409, 'and a refused vote takes no more ballots');
  assert.equal((await w.join(w.cy, open.id)).status, 404);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM alliance_ballots WHERE vote_id = ?', open.id)!.n, 2);
  assert.throws(() => run(w.h.db, "INSERT INTO alliance_ballots (vote_id, company_id, choice) VALUES (?, ?, 'no')", open.id, w.id(w.amy)), /UNIQUE|PRIMARY/, 'one ballot per company and vote is the primary key');

  // a refused company can be proposed again: a new vote, new ballots
  const again = (await w.invite(w.amy, w.cy)).body.votes;
  assert.equal(again.length, 1);
  assert.notEqual(again[0].id, open.id);
  assert.equal((await w.ballot(w.ben, again[0].id, 'yes')).body.votes[0].status, 'accepted');
  assert.deepEqual((await w.call(w.cy, 'GET', '/alliance/invitations')).body, [{ id: again[0].id, alliance: 'Skyline Club' }], 'the candidate sees the alliance\'s name and nothing else');
  const joined = await w.join(w.cy, again[0].id);
  assert.equal(joined.status, 200, joined.text);
  assert.deepEqual(joined.body.members.map((m: MemberView) => m.username), ['amy', 'ben', 'cyd']);
  assert.equal(joined.body.votes.length, 0, 'the vote is over');
  assert.equal((await w.join(w.cy, again[0].id)).status, 404, 'joining twice');
});

test('a member who joins while a vote is open must say yes too, and a member in notice no longer votes', async () => {
  const w = await world();
  const dan = await w.h.register('dani');
  await w.pair();
  const vote = (await w.invite(w.amy, dan)).body.votes[0];
  assert.equal((await w.ballot(w.ben, vote.id, 'yes')).body.votes[0].status, 'accepted');
  // Cy is voted in, meanwhile Dan's vote needs Cy's yes as well
  const vc = (await w.invite(w.amy, w.cy)).body.votes.find((v: { candidate: string }) => v.candidate === w.name(w.cy));
  await w.ballot(w.ben, vc.id, 'yes');
  await w.join(w.cy, vc.id);
  const v = (await w.call(w.amy, 'GET', '/alliance')).body.votes[0];
  assert.deepEqual([v.candidate, v.status, v.members], [w.name(dan), 'open', 3]);
  assert.equal((await w.ballot(w.cy, vote.id, 'yes')).body.votes[0].status, 'accepted');
  // Ben gives notice: he proposes and votes no more, and the vote is made by the two who stay
  await w.call(w.ben, 'POST', '/alliance/leave');
  assert.deepEqual([(await w.ballot(w.ben, vote.id, 'no')).body.error, (await w.invite(w.ben, w.cy)).body.error], ['leaving', 'leaving']);
  assert.equal((await w.call(w.amy, 'GET', '/alliance')).body.votes[0].members, 2);
});

test('an alliance holds ALLIANCE_MAX_MEMBERS companies, no more', async () => {
  const w = await world();
  await w.pair();
  const extra: User[] = [];
  for (let i = 0; i < ALLIANCE_MAX_MEMBERS - 2; i++) extra.push(await w.h.register(`extra${i}`));
  for (const u of extra) {
    const v = (await w.invite(w.amy, u)).body.votes.find((x: { candidate: string }) => x.candidate === w.name(u));
    await w.ballot(w.ben, v.id, 'yes');
    for (const e of extra) if (e !== u && get(w.h.db, 'SELECT 1 AS x FROM alliance_members WHERE company_id = ?', w.id(e))) await w.ballot(e, v.id, 'yes');
    assert.equal((await w.join(u, v.id)).status, 200);
  }
  assert.equal(((await w.call(w.amy, 'GET', '/alliance')).body as AllianceView).members.length, ALLIANCE_MAX_MEMBERS);
  const full = await w.invite(w.amy, w.cy);
  assert.deepEqual([full.status, full.body.error], [409, 'alliance_full']);
});

// ---------------------------------------------------------------- C24 and the group: who may belong

test('AI companies are never members: they cannot be invited, and the refusal does not say why', async () => {
  const w = await world({ ai: true });
  const aiName = get<{ name: string }>(w.h.db, 'SELECT name FROM companies WHERE user_id IS NULL ORDER BY id LIMIT 1')!.name;
  await w.pair();
  const r = await w.call(w.amy, 'POST', '/alliance/invite', { name: aiName });
  assert.deepEqual([r.status, r.body.error], [409, 'not_invitable']);
  const same = await w.call(w.amy, 'POST', '/alliance/invite', { name: w.name(w.ben) }); // a company already in an alliance answers in the same words
  assert.deepEqual([same.status, same.body.error], [409, 'not_invitable']);
  assert.deepEqual([(await w.call(w.amy, 'POST', '/alliance/invite', { name: 'No Such Air' })).status], [404]);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM alliance_members m JOIN companies c ON c.id = m.company_id WHERE c.user_id IS NULL')!.n, 0);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM alliance_votes WHERE closed_at IS NULL')!.n, 0, 'no vote was opened for it');
});

test('a subsidiary cannot join or found an alliance on its own: the parent represents the group', async () => {
  const w = await world();
  await w.pair();
  const sub = await w.call(w.cy, 'POST', '/group/subsidiaries', { name: 'Cy Cargo', hub: 'LFPG', code: 'CYC', activity: 'cargo' });
  assert.equal(sub.status, 201, sub.text);
  const subId = sub.body.id as number;
  // a member proposes the subsidiary: refused, in the words any non-invitable company gets
  const r = await w.call(w.amy, 'POST', '/alliance/invite', { name: 'Cy Cargo' });
  assert.deepEqual([r.status, r.body.error], [409, 'not_invitable']);
  // the subsidiary cannot found one (its parent could)
  const f = await w.call(w.cy, 'POST', '/alliance', { name: 'Cargo Club' }, subId);
  assert.deepEqual([f.status, f.body.error], [409, 'is_subsidiary']);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM alliance_members WHERE company_id = ?', subId)!.n, 0);
  // the parent is represented in the alliance, the subsidiary is not a member: it sees a 404 like any stranger
  assert.equal((await w.call(w.cy, 'GET', '/alliance', undefined, subId)).status, 404);
  assert.equal((await w.found(w.cy, 'Cy Club')).status, 201, 'the parent itself may found one');
});

// ---------------------------------------------------------------- 30 days' notice

test('leaving takes 30 days from the notice: still a member during them, gone after, and the notice cannot be given twice', async () => {
  const w = await world();
  await w.pair();
  const t0 = w.h.clock.t;
  const left = await w.call(w.ben, 'POST', '/alliance/leave');
  assert.equal(left.status, 200, left.text);
  assert.equal(left.body.leavesAt, t0 + ALLIANCE_NOTICE_MS);
  assert.deepEqual(left.body.members.map((m: MemberView) => m.username), ['amy', 'ben']);
  assert.equal((await w.call(w.ben, 'POST', '/alliance/leave')).body.error, 'already_leaving');
  w.advance(29);
  assert.equal((await w.call(w.ben, 'GET', '/alliance')).status, 200, 'day 29: still in');
  w.advance(2);
  assert.equal((await w.call(w.ben, 'GET', '/alliance')).status, 404, 'day 31: out, and a 404 like any stranger');
  assert.deepEqual((await w.call(w.amy, 'GET', '/alliance')).body.members.map((m: MemberView) => m.username), ['amy']);
  assert.equal((await w.found(w.ben, 'Second Club')).status, 201, 'a company that has left can found or join another');
});

// ---------------------------------------------------------------- dues in the month's billing

test('the dues are 2 % of last month\'s revenue, posted once on the 1st through the ledger, and a replay or a second request changes nothing', async () => {
  const w = await world();
  await w.pair();
  const nov = w.h.clock.t;
  post(w.h.db, w.id(w.amy), nov, 'line_revenue', 100_000, 'seed');
  post(w.h.db, w.id(w.cy), nov, 'line_revenue', 100_000, 'seed'); // not a member: pays nothing
  w.advance(30); // 4 Dec
  const before = w.balance(w.amy);
  const view = await w.call(w.amy, 'GET', '/alliance');
  const dec = w.txs(w.amy, 'alliance_dues');
  assert.deepEqual(dec.map((t) => [t.amount, t.at, t.memo]), [[-2000, Date.UTC(2026, 11, 1), 'Skyline Club alliance dues 2 %']]);
  assert.equal(duesFor(100_000), 100_000 * ALLIANCE_DUES_PCT / 100);
  assert.deepEqual(view.body.dues, { revenue: 100_000, amount: 2000 }, 'the view says what the billing took');
  assert.equal(w.balance(w.amy) < before + 1, true);
  const after = w.balance(w.amy);
  for (let i = 0; i < 3; i++) await w.call(w.amy, 'GET', '/alliance');
  assert.equal(runBilling(w.h.db, w.id(w.amy), w.h.clock.t), 0, 'the month is already billed');
  assert.deepEqual([w.txs(w.amy, 'alliance_dues').length, w.balance(w.amy)], [1, after]);
  assert.equal(w.txs(w.cy, 'alliance_dues').length, 0, 'a company outside pays no dues');
  assert.equal(w.txs(w.ben, 'alliance_dues').length, 0, 'a member with no revenue pays nothing');
  // the books agree: the balance is the sum of the postings
  assert.equal(get<{ s: number }>(w.h.db, 'SELECT SUM(amount) AS s FROM transactions WHERE company_id = ?', w.id(w.amy))!.s, w.balance(w.amy));

  // a missed stretch is caught up month by month, each month on the revenue of the one before
  post(w.h.db, w.id(w.amy), Date.UTC(2026, 11, 10), 'line_revenue', 50_000, 'seed'); // December
  w.advance(75); // into February
  await w.call(w.amy, 'GET', '/alliance');
  assert.deepEqual(w.txs(w.amy, 'alliance_dues').map((t) => [t.amount, t.at]), [[-2000, Date.UTC(2026, 11, 1)], [-1000, Date.UTC(2027, 0, 1)]], 'January is 2 % of December; February, of an empty January, is nothing');
});

test('the dues are a running cost of their own category, and a company that joins after the 1st pays from the next month', async () => {
  const w = await world();
  assert.equal(categoryOf('alliance_dues'), 'other');
  await w.found(w.amy);
  const nov = Date.UTC(2026, 10, 20);
  post(w.h.db, w.id(w.ben), nov, 'line_revenue', 200_000, 'seed');
  w.advance((Date.UTC(2026, 11, 10, 12) - w.h.clock.t) / DAY); // Ben is voted in on the 10th of December
  await w.invite(w.amy, w.ben);
  const v = (await w.call(w.amy, 'GET', '/alliance')).body.votes[0];
  await w.join(w.ben, v.id);
  assert.deepEqual(allianceDues(w.h.db, w.id(w.ben), Date.UTC(2026, 11, 1)), [], 'not a member on 1 December');
  post(w.h.db, w.id(w.ben), Date.UTC(2026, 11, 12), 'line_revenue', 300_000, 'seed');
  assert.deepEqual(allianceDues(w.h.db, w.id(w.ben), Date.UTC(2027, 0, 1)).map((c) => c.amount), [-6000], '2 % of December\'s 300 000');
});

test('a notice that is still running owes the month\'s dues; the month after it ends owes none', async () => {
  const w = await world();
  await w.pair();
  post(w.h.db, w.id(w.ben), w.h.clock.t, 'line_revenue', 100_000, 'seed'); // November
  await w.call(w.ben, 'POST', '/alliance/leave'); // notice until 4 December
  w.advance(30); // 4 Dec: the notice just ran out, but the 1st of December came before it did
  await w.call(w.ben, 'GET', '/me');
  assert.equal(w.txs(w.ben, 'alliance_dues').length, 1, 'a member on 1 December pays December');
  post(w.h.db, w.id(w.ben), Date.UTC(2026, 11, 10), 'line_revenue', 100_000, 'seed');
  w.advance(30); // 3 Jan
  await w.call(w.ben, 'GET', '/me');
  assert.equal(w.txs(w.ben, 'alliance_dues').length, 1, 'a company that has left pays no more');
});

// ---------------------------------------------------------------- company lifecycle

test('deleting a member leaves the alliance cleanly: its ballots go with it, the others stay, and the last member takes the alliance, its votes and ballots away', async () => {
  const w = await world();
  await w.pair();
  const vote = (await w.invite(w.amy, w.cy)).body.votes[0];
  await w.ballot(w.ben, vote.id, 'yes');
  const second = await w.h.call('POST', `${V1}/me/companies`, { token: w.ben.token, body: { name: 'Ben Spare', hub: 'LFPG' } });
  const count = (table: string): number => get<{ n: number }>(w.h.db, `SELECT COUNT(*) AS n FROM ${table}`)!.n;
  // Ben's second company is no member: deleting it touches nothing
  assert.equal((await w.h.call('DELETE', `${V1}/companies/${second.body.company.id}`, { token: w.ben.token, body: { password: 'correct horse' } })).status, 204);
  assert.deepEqual([count('alliance_members'), count('alliance_ballots')], [2, 3], 'Amy\'s yes on Ben\'s vote, Amy\'s and Ben\'s on Cy\'s');
  // Ben's company is deleted: Amy keeps the alliance, the vote loses his ballot and is open again
  assert.equal((await w.h.call('DELETE', `${V1}/me`, { token: w.ben.token, body: { password: 'correct horse' } })).status, 204);
  assert.deepEqual([count('alliances'), count('alliance_members'), count('alliance_ballots'), count('alliance_votes')], [1, 1, 1, 1], 'Ben\'s own admission vote went with him (he was its candidate), and so did the ballot on it');
  assert.deepEqual((await w.call(w.amy, 'GET', '/alliance')).body.votes.map((v: { status: string; members: number }) => [v.status, v.members]), [['accepted', 1]], 'the vote is read from the members who are left');
  // the last member goes: nothing of the alliance is left
  assert.equal((await w.h.call('DELETE', `${V1}/me`, { token: w.amy.token, body: { password: 'correct horse' } })).status, 204);
  assert.deepEqual(['alliances', 'alliance_members', 'alliance_votes', 'alliance_ballots'].map(count), [0, 0, 0, 0]);
  assert.deepEqual(all(w.h.db, 'PRAGMA foreign_key_check'), []);
});

test('a candidate that is deleted takes its vote with it', async () => {
  const w = await world();
  await w.found(w.amy);
  await w.invite(w.amy, w.cy);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM alliance_votes')!.n, 1);
  assert.equal((await w.h.call('DELETE', `${V1}/me`, { token: w.cy.token, body: { password: 'correct horse' } })).status, 204);
  assert.deepEqual(['alliance_votes', 'alliance_ballots'].map((t) => get<{ n: number }>(w.h.db, `SELECT COUNT(*) AS n FROM ${t}`)!.n), [0, 0]);
  assert.equal((await w.call(w.amy, 'GET', '/alliance')).body.votes.length, 0);
});

// ---------------------------------------------------------------- migration

test('the migration adds the alliance tables, found by its content: one ballot per company and vote, one live vote per candidate, and the last member drops the alliance', () => {
  const at = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE alliances'));
  assert.ok(at > 0, 'found by content, not by position');
  const file = join(mkdtempSync(join(tmpdir(), 'opc-alliance-')), 'prev.sqlite');
  const raw = new DatabaseSync(file);
  for (let i = 0; i < at; i++) raw.exec(MIGRATIONS[i]!);
  raw.exec(`PRAGMA user_version = ${at}`);
  raw.exec(`INSERT INTO users (id, username, pass_hash, created_at) VALUES (1, 'a', 'h', 1), (2, 'b', 'h', 1);
    INSERT INTO companies (id, user_id, name, balance, reputation, created_at) VALUES (1, 1, 'A Air', 1, 50, 1), (2, 2, 'B Air', 1, 50, 1), (3, NULL, 'Robo', 1, 50, 1);`);
  raw.close();
  const db = openDb(file);
  assert.equal(get<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version, MIGRATIONS.length);
  assert.deepEqual(all(db, 'SELECT company_id FROM alliance_members'), [], 'existing companies are in no alliance');
  run(db, "INSERT INTO alliances (id, name, founded_at) VALUES (1, 'Club', 1)");
  run(db, 'INSERT INTO alliance_members (alliance_id, company_id, since) VALUES (1, 1, 1), (1, 2, 1)');
  run(db, 'INSERT INTO alliance_votes (id, alliance_id, candidate_id, created_at) VALUES (1, 1, 3, 1)');
  assert.throws(() => run(db, 'INSERT INTO alliance_votes (alliance_id, candidate_id, created_at) VALUES (1, 3, 2)'), /UNIQUE/, 'one live vote per candidate');
  run(db, 'UPDATE alliance_votes SET closed_at = 5 WHERE id = 1');
  run(db, 'INSERT INTO alliance_votes (alliance_id, candidate_id, created_at) VALUES (1, 3, 6)');
  run(db, "INSERT INTO alliance_ballots (vote_id, company_id, choice) VALUES (1, 1, 'yes')");
  assert.throws(() => run(db, "INSERT INTO alliance_ballots (vote_id, company_id, choice) VALUES (1, 1, 'no')"), /UNIQUE|PRIMARY/);
  assert.throws(() => run(db, "INSERT INTO alliance_ballots (vote_id, company_id, choice) VALUES (1, 2, 'maybe')"), /CHECK/);
  run(db, 'DELETE FROM companies WHERE id = 1');
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM alliances')!.n, 1, 'one member is left');
  assert.equal(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM alliance_ballots')!.n, 0, 'the ballot of the deleted company went with it');
  run(db, 'DELETE FROM companies WHERE id = 2');
  assert.deepEqual(['alliances', 'alliance_members', 'alliance_votes', 'alliance_ballots'].map((t) => get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t}`)!.n), [0, 0, 0, 0]);
  assert.deepEqual(all(db, 'PRAGMA foreign_key_check'), []);
});
