import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, DEFAULT_NOTICE_DAYS, MAX_INTERIM_DAYS, START_NOW_FEE, type LineProblemView } from '@opc/shared';
import { all, get, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';
import { crewShortage } from './staff.ts';

const HOUR = 3_600_000;
const body = (over: Record<string, unknown> = {}) => ({ a: 'LFPG', b: 'LFLL', freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [] as number[], ...over });

/** A player at LFPG with one AT76 (2 pilots and 2 cabin crew needed) and a line, nobody employed: the line is interrupted for crew once its first legs have been cancelled. */
async function world() {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: h.clock.t });
  run(h.db, 'UPDATE companies SET balance = 5000000 WHERE id = ?', cid);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, b?: unknown) => h.call(method, url, { token: u.token, ...(b === undefined ? {} : { body: b }) });
  const made = await call('POST', '/api/v1/lines', body({ aircraftIds: [ac] }));
  assert.equal(made.status, 201, made.text);
  const lineId = made.body.id as number;
  const advance = async (ms: number) => { h.clock.t += ms; await call('GET', '/api/v1/network'); };
  const balance = () => get<{ balance: number }>(h.db, 'SELECT balance FROM companies WHERE id = ?', cid)!.balance;
  const legs = () => all<{ id: number; status: string; dep_at: number; cancel_cause: string | null }>(h.db, 'SELECT * FROM scheduled_flights ORDER BY dep_at, id');
  const tx = (kind: string) => all<{ amount: number; memo: string }>(h.db, 'SELECT amount, memo FROM transactions WHERE company_id = ? AND kind = ? ORDER BY id', cid, kind);
  const status = async () => ((await call('GET', `/api/v1/lines/${lineId}`)).body.line as { status: string }).status;
  const problem = async () => (await call('GET', `/api/v1/lines/${lineId}/problem`)).body as LineProblemView;
  const resolve = (b: Record<string, unknown>) => call('POST', `/api/v1/lines/${lineId}/resolve`, b);
  const shortage = () => crewShortage(h.db, cid, ['AT76'], ['LFPG', 'LFLL'], h.clock.t);
  await advance(2 * HOUR);
  assert.equal(await status(), 'interrupted', 'no crew: the line is interrupted');
  return { h, cid, call, advance, balance, legs, tx, status, problem, resolve, shortage, lineId };
}

test('interim: one click books every missing position until the default notice, the preview is the bill, the line flies at once, and a second click has nothing to cover', async () => {
  const w = await world();
  const p = await w.problem();
  assert.ok(p.options.interim, 'the preview is offered');
  const it = p.options.interim!;
  assert.equal(it.people, 4, '2 pilots and 2 cabin crew');
  assert.deepEqual(it.perSlot.map((s) => [s.family, s.type, s.defaulted]), [['pilot', 'AT76', true], ['pilot', 'AT76', true], ['cabin', null, true], ['cabin', null, true]]);
  assert.ok(it.perSlot.every((s) => s.until === w.h.clock.t + DEFAULT_NOTICE_DAYS * DAY_MS && s.cost > 0), 'nobody is coming: the default notice');
  assert.equal(it.until, w.h.clock.t + DEFAULT_NOTICE_DAYS * DAY_MS);
  assert.equal(it.cost, it.perSlot.reduce((t, s) => t + s.cost, 0));
  assert.equal(p.options.startNow, null, 'nobody in notice to start now');

  const before = w.balance();
  const res = await w.resolve({ option: 'interim' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.status, 'active', 'the engine derives the status from the crew the interims make');
  assert.equal(before - w.balance(), it.cost, 'the preview is exactly what is paid');
  assert.equal(w.tx('interim').length, 4, 'one ledger line per interim, on the existing interim kind');
  assert.deepEqual(w.shortage(), []);
  assert.equal((await w.resolve({ option: 'interim' })).body.error, 'nothing_to_cover');
  assert.equal((await w.resolve({ option: 'interim' })).status, 409);
  assert.equal(w.balance(), before - it.cost, 'the second click paid nothing');
  assert.equal((await w.problem()).options.interim, null);

  await w.advance(DAY_MS);
  assert.ok(w.legs().filter((l) => l.status === 'done').length > 0, 'and the interims fly the next legs');
});

test('interim: a slot ends when the earliest hire in notice for the same type arrives, one slot at a time; the rest default; MAX_INTERIM_DAYS caps', async () => {
  const w = await world();
  const t0 = w.h.clock.t;
  // 1 pilot due in 3 days, 1 pilot due in 40 days (beyond the cap); nobody for cabin
  const hire = (id: number, days: number) => run(w.h.db, 'UPDATE staff SET starts_at = ? WHERE id = ?', t0 + days * DAY_MS, id);
  const mk = async (family: string, qual: string | null) => {
    const q = qual ? `&qual=${qual}` : '';
    const c = (await w.call('GET', `/api/v1/staff/candidates?family=${family}&base=LFPG${q}`)).body.candidates as { id: string }[];
    const r = await w.call('POST', '/api/v1/staff/hire', { candidateId: c[0]!.id });
    assert.equal(r.status, 201, r.text);
    return r.body.member.id as number;
  };
  hire(await mk('pilot', 'AT76'), 3);
  hire(await mk('pilot', 'AT76'), 40);
  const it = (await w.problem()).options.interim!;
  const pilots = it.perSlot.filter((s) => s.family === 'pilot');
  assert.deepEqual(pilots.map((s) => [s.until, s.defaulted]), [[t0 + 3 * DAY_MS, false], [t0 + MAX_INTERIM_DAYS * DAY_MS, false]], 'soonest arrival first, then the next one, capped at 30 days');
  assert.ok(it.perSlot.filter((s) => s.family === 'cabin').every((s) => s.until === t0 + DEFAULT_NOTICE_DAYS * DAY_MS && s.defaulted));
  assert.equal(it.until, t0 + MAX_INTERIM_DAYS * DAY_MS);
  assert.ok(pilots[0]!.cost < pilots[1]!.cost, 'a shorter bridge is cheaper');
});

test('recruit with interim: the line is back at once, the bridge ends exactly when the recruits start (no gap, no overlap, no double crew cost), and the preview shows both costs', async () => {
  const w = await world();
  const t0 = w.h.clock.t;
  const p = await w.problem();
  const r = p.options.recruit!;
  assert.equal(r.candidates, 4);
  assert.ok(r.premium > 0 && r.bridge && r.bridge.people === 4, JSON.stringify(r));
  assert.ok(r.bridge!.perSlot.every((s) => s.until === t0 + DEFAULT_NOTICE_DAYS * DAY_MS && !s.defaulted), 'the recruits arrive after the notice: the bridge ends then');
  const before = w.balance();
  const res = await w.resolve({ option: 'recruit', withInterim: true });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.status, 'active');
  assert.equal(before - w.balance(), r.premium + r.bridge!.cost, 'premiums plus the bridge, as previewed');
  const people = all<{ id: number; family: string; contract: string; starts_at: number; ends_at: number | null }>(w.h.db, 'SELECT id, family, contract, starts_at, ends_at FROM staff ORDER BY id');
  const interims = people.filter((s) => s.contract === 'cdd'), hires = people.filter((s) => s.contract === 'cdi');
  assert.equal(interims.length, 4);
  assert.equal(hires.length, 4);
  for (const i of interims) assert.equal(i.ends_at, hires.find((x) => x.family === i.family)!.starts_at, 'the interim ends exactly when a recruit of his family starts');
  assert.equal((await w.resolve({ option: 'recruit', withInterim: true })).body.error, 'nothing_to_recruit');

  // the two instants around the hand-over: the same people count, nobody paid twice, the line never loses its crew
  for (const at of [t0 + DEFAULT_NOTICE_DAYS * DAY_MS - 1, t0 + DEFAULT_NOTICE_DAYS * DAY_MS]) {
    const on = people.filter((s) => s.starts_at <= at && (s.ends_at === null || s.ends_at > at));
    assert.equal(on.filter((s) => s.family === 'pilot').length, 2, `2 pilots at ${at}`);
    assert.equal(on.filter((s) => s.family === 'cabin').length, 2, `2 cabin crew at ${at}`);
    assert.deepEqual(crewShortage(w.h.db, w.cid, ['AT76'], ['LFPG', 'LFLL'], at), []);
  }
});

test('injected clock: interrupted for crew, interim booked, next legs scheduled and flown, the interim ends when the recruits start, and the line never stops again', async () => {
  const w = await world();
  const t0 = w.h.clock.t;
  const cancelledForCrew = w.legs().filter((l) => l.status === 'cancelled' && l.cancel_cause === 'no_crew');
  assert.ok(cancelledForCrew.length > 0, 'legs were lost before the bridge');
  assert.equal((await w.resolve({ option: 'recruit', withInterim: true })).status, 200);

  const book = w.legs().length;
  await w.advance(DAY_MS);
  const flown = w.legs().filter((l) => l.status === 'done' && l.dep_at > t0);
  assert.ok(flown.length >= 3, `${flown.length} legs flown with the interims`);
  assert.equal(w.legs().filter((l) => l.dep_at > t0 && l.dep_at < w.h.clock.t && l.status === 'cancelled').length, 0, 'not one leg lost after the bridge (the leg due at the booking instant was resolved just before it)');
  assert.ok(w.legs().length >= book);

  // across the hand-over, one tick at a time around it, then a week after
  const handOver = t0 + DEFAULT_NOTICE_DAYS * DAY_MS;
  w.h.clock.t = handOver - 2 * HOUR;
  await w.call('GET', '/api/v1/network');
  assert.equal(await w.status(), 'active');
  await w.advance(4 * HOUR);
  assert.equal(await w.status(), 'active', 'the recruits have started: still in service');
  await w.advance(7 * DAY_MS);
  assert.equal(await w.status(), 'active');
  assert.equal(w.legs().filter((l) => l.dep_at > t0 && l.cancel_cause === 'no_crew').length, 0, 'no leg ever lacks a crew, at the hand-over or after (a duty_limit stop is the rest rules on a two-pilot crew, not a gap)');
  // the interims are off the payroll and off the roster; the recruits are the crew
  const left = all<{ contract: string }>(w.h.db, 'SELECT contract FROM staff WHERE ends_at IS NOT NULL AND ends_at <= ?', w.h.clock.t);
  assert.deepEqual(left.map((x) => x.contract), ['cdd', 'cdd', 'cdd', 'cdd']);
  assert.equal(w.tx('payroll').length, 0, 'no payroll posting: nobody was paid twice for the same seat');
});

test('start now: a hire in notice starts at once for START_NOW_FEE, 409 when started or left, 402 when funds are short; the line leaves "interrupted" without a forced write', async () => {
  const w = await world();
  const hired = (await w.resolve({ option: 'recruit' }));
  assert.equal(hired.status, 200, hired.text);
  assert.equal(hired.body.status, 'interrupted', 'recruiting alone leaves the line down for the notice');
  const p = await w.problem();
  assert.equal(p.options.interim!.people, 4, 'the interim is offered too');
  assert.deepEqual(p.options.interim!.perSlot.map((s) => s.defaulted), [false, false, false, false], 'bridged until the recruits arrive');
  assert.equal(p.options.startNow!.people, 4);
  assert.equal(p.options.startNow!.cost, 4 * START_NOW_FEE, 'both costs come from the server');
  assert.equal(p.options.recruit!.candidates, 0, 'the hires in notice already fill every position: nothing more to recruit');
  assert.equal((await w.resolve({ option: 'recruit' })).body.error, 'already_recruited');

  const pending = all<{ id: number; starts_at: number }>(w.h.db, 'SELECT id, starts_at FROM staff ORDER BY id');
  const one = pending[0]!.id;
  const before = w.balance();
  const r = await w.call('POST', `/api/v1/staff/${one}/start-now`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.fee, START_NOW_FEE);
  assert.equal(w.balance(), before - START_NOW_FEE);
  assert.equal(r.body.balanceAfter, w.balance());
  assert.equal(r.body.member.state, 'free');
  assert.equal(get<{ starts_at: number }>(w.h.db, 'SELECT starts_at FROM staff WHERE id = ?', one)!.starts_at, w.h.clock.t);
  assert.deepEqual(w.tx('start_now').map((x) => x.amount), [-START_NOW_FEE]);
  const again = await w.call('POST', `/api/v1/staff/${one}/start-now`);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_started');
  assert.equal(w.balance(), before - START_NOW_FEE, 'refused: nothing paid');

  // the other pending people: fire one, it has left; a short balance is a 402
  const gone = pending[1]!.id;
  assert.equal((await w.call('DELETE', `/api/v1/staff/${gone}`)).status, 200);
  const left = await w.call('POST', `/api/v1/staff/${gone}/start-now`);
  assert.equal(left.status, 409);
  assert.equal(left.body.error, 'already_left');
  run(w.h.db, 'UPDATE companies SET balance = ? WHERE id = ?', START_NOW_FEE - 1, w.cid);
  const poor = await w.call('POST', `/api/v1/staff/${pending[2]!.id}/start-now`);
  assert.equal(poor.status, 402);
  assert.equal(poor.body.error, 'insufficient_funds');
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM staff WHERE id = ? AND starts_at > ?', pending[2]!.id, w.h.clock.t)!.n, 1, 'still in notice');
  assert.equal((await w.call('POST', '/api/v1/staff/999999/start-now')).status, 404);
});

test('start now from the line panel: every missing position has a hire in notice, one click starts them all and the line is back; a position nobody is coming for refuses', async () => {
  const w = await world();
  assert.equal((await w.resolve({ option: 'start_now' })).body.error, 'start_now_unavailable', 'nobody in notice');
  await w.resolve({ option: 'recruit' });
  run(w.h.db, 'UPDATE companies SET balance = 1000000 WHERE id = ?', w.cid);
  const before = w.balance();
  const res = await w.resolve({ option: 'start_now' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.status, 'active');
  assert.equal(before - w.balance(), 4 * START_NOW_FEE);
  assert.equal(w.tx('start_now').length, 4);
  assert.equal((await w.resolve({ option: 'start_now' })).body.error, 'nothing_to_cover');
  await w.advance(DAY_MS);
  assert.ok(w.legs().some((l) => l.status === 'done'), 'flying');
});

test('hiring with startNow pays the premium and the fee, and the hire is employed now; a refused fee leaves no hire behind', async () => {
  const w = await world();
  const cands = (await w.call('GET', '/api/v1/staff/candidates?family=cabin&base=LFPG')).body.candidates as { id: string; premium: number }[];
  const before = w.balance();
  const r = await w.call('POST', '/api/v1/staff/hire', { candidateId: cands[0]!.id, startNow: true });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.startsAt, w.h.clock.t);
  assert.equal(r.body.member.state, 'free');
  assert.equal(before - w.balance(), cands[0]!.premium + START_NOW_FEE);
  run(w.h.db, 'UPDATE companies SET balance = ? WHERE id = ?', cands[1]!.premium + 10, w.cid);
  const poor = await w.call('POST', '/api/v1/staff/hire', { candidateId: cands[1]!.id, startNow: true });
  assert.ok(poor.status === 402 || poor.status === 409, poor.text);
  assert.equal(get<{ n: number }>(w.h.db, 'SELECT COUNT(*) AS n FROM staff WHERE candidate_id = ?', cands[1]!.id)!.n, 0, 'rolled back whole');
  assert.equal(w.balance(), cands[1]!.premium + 10);
});
