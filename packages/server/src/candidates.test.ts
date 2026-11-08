import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENCY_SEARCH_DAYS, DAY_MS, dayNo, type AgencyView, type CandidatesView } from '@opc/shared';
import { all, get, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';
import { NAME_POOLS, nameFrom, nameGroupOf, type NameGroup } from './names.ts';
import { CANDIDATE_CAP, grantStarterCrew } from './staff-people.ts';

const V1 = '/api/v1';
const HOUR = 3_600_000;

/** A player whose hub is `hub`, one AT76 there and a line to `other`, with a fat balance. */
async function world(hub: string, other: string) {
  const h = await harness();
  const u = await h.register('amy', hub);
  const cid = u.me.company.id as number;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub, value: 1_000_000, ownership: 'owned', at: h.clock.t });
  run(h.db, 'UPDATE companies SET balance = 50000000 WHERE id = ?', cid);
  const call = (method: 'GET' | 'POST', url: string, b?: unknown) => h.call(method, `${V1}${url}`, { token: u.token, ...(b === undefined ? {} : { body: b }) });
  const made = await call('POST', '/lines', { a: hub, b: other, freqPerDay: 3, days: Array(7).fill(true), windowStart: '06:00', windowEnd: '18:00', aircraftIds: [ac] });
  assert.equal(made.status, 201, made.text);
  const list = async (q: string) => (await call('GET', `/staff/candidates?${q}`)).body as CandidatesView;
  const hire = (candidateId: string) => call('POST', '/staff/hire', { candidateId });
  const people = () => all<{ name: string; base: string; candidate_id: string | null }>(h.db, 'SELECT name, base, candidate_id FROM staff WHERE company_id = ? ORDER BY id', cid);
  return { h, cid, call, list, hire, people };
}

/** `name` is a first and a last name of the pool of `group`. */
const fromPool = (name: string, group: NameGroup): boolean => {
  const [first, ...last] = name.replace(' (interim)', '').split(' ');
  return NAME_POOLS[group].first.includes(first!) && NAME_POOLS[group].last.includes(last.join(' '));
};

test('every pool has 30 to 60 first and last names, each one Latin-script word; the country maps to its pool and an unknown or missing one to the international pool', () => {
  for (const [g, p] of Object.entries(NAME_POOLS)) {
    for (const list of [p.first, p.last]) {
      assert.ok(list.length >= 30 && list.length <= 60, `${g}: ${list.length} names`);
      assert.equal(new Set(list).size, list.length, `${g}: no duplicates`);
      assert.ok(list.every((n) => /^[\p{Script=Latin}'-]+$/u.test(n)), `${g}: Latin script`);
    }
  }
  assert.equal(Object.keys(NAME_POOLS).length, 20);
  const groups = { FR: 'fr', US: 'en', GB: 'en', AU: 'en', IE: 'en', DE: 'de', AT: 'de', CH: 'de', ES: 'es', MX: 'es', BR: 'pt', PT: 'pt', IT: 'it', NL: 'nl', BE: 'nl', SE: 'nordic', FI: 'nordic', PL: 'cee', CZ: 'cee',
    RU: 'ru', UA: 'ru', TR: 'tr', AE: 'ar', MA: 'ar', JO: 'ar', JP: 'jp', CN: 'zh', TW: 'zh', SG: 'zh', KR: 'kr', IN: 'in', TH: 'sea', VN: 'sea', ID: 'sea', NG: 'africa', ZA: 'africa', GR: 'gr', ZZ: 'intl', XX: 'intl' };
  for (const [country, group] of Object.entries(groups)) assert.equal(nameGroupOf(country), group, country);
  assert.equal(nameGroupOf(undefined), 'intl');
  assert.equal(nameGroupOf(''), 'intl');
});

test('a name comes from the pool of the country, the same stream giving the same person', () => {
  const seq = (): (() => number) => { let i = 0; return () => ((i++ * 0.37) % 1); };
  assert.equal(nameFrom(seq(), 'JP'), nameFrom(seq(), 'JP'));
  for (let k = 0; k < 200; k++) {
    let x = k * 7919;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    assert.ok(fromPool(nameFrom(rand, 'JP'), 'jp'));
    assert.ok(fromPool(nameFrom(rand, 'FR'), 'fr'));
    assert.ok(fromPool(nameFrom(rand, 'ZZ'), 'intl'));
  }
});

test('the market never runs dry: three times in a row every listed candidate is hired and 6 to 10 new ones are listed, none already hired', async () => {
  const w = await world('LFPG', 'LFLL');
  const seen = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const v = await w.list('family=cabin&base=LFPG');
    assert.ok(v.market >= 6 && v.market <= 10 && v.candidates.length === v.market, `round ${round}: ${v.market} on the market`);
    for (const c of v.candidates) {
      assert.ok(!seen.has(c.id), `${c.id} was offered again`);
      seen.add(c.id);
      assert.equal((await w.hire(c.id)).status, 201);
    }
  }
  assert.equal(w.people().length, seen.size);
  assert.deepEqual([...seen].map((id) => Number(id.split('.')[4])).sort((a, b) => a - b), [...seen].map((_, i) => i), 'the first free indexes, one after the other');
  const again = await w.list('family=cabin&base=LFPG');
  assert.ok(again.market >= 6 && again.candidates.every((c) => !seen.has(c.id)));
});

test('a company with 1000 hired people at a base still has a full market there', async () => {
  const w = await world('LFPG', 'LFLL');
  const day = dayNo(w.h.clock.t);
  for (let i = 0; i < 1000; i++) {
    run(w.h.db, "INSERT INTO staff (company_id, family, name, role, base, hired_at, starts_at, salary, reliability, morale, candidate_id) VALUES (?, 'cabin', 'x', 'cabin', 'LFPG', 0, 0, 1, 80, 80, ?)", w.cid, `${day}.LFPG.cabin.-.${i}`);
  }
  const v = await w.list('family=cabin&base=LFPG');
  assert.ok(v.market >= 6 && v.market <= 10);
  assert.ok(v.candidates.every((c) => Number(c.id.split('.')[4]) >= 1000));
  assert.equal((await w.hire(v.candidates[0]!.id)).status, 201);
});

test('hire rebuilds the candidate from the id alone: a high index is accepted, one past the cap, a padded index or an unknown family is a 404, and it is the same person the market shows', async () => {
  const w = await world('LFPG', 'LFLL');
  const day = dayNo(w.h.clock.t);
  const first = (await w.list('family=cabin&base=LFPG')).candidates[0]!;
  const high = `${day}.LFPG.cabin.-.${CANDIDATE_CAP - 1}`;
  assert.equal((await w.hire(high)).status, 201);
  assert.ok(w.people().some((p) => p.candidate_id === high));
  for (const id of [`${day}.LFPG.cabin.-.${CANDIDATE_CAP}`, `${day}.LFPG.cabin.-.99999999`, `${day}.LFPG.cabin.-.007`, `${day}.LFPG.pirate.-.0`, `${day}.LFPG.pilot.-.0`, `${day}.LFPG.cabin.AT76.0`, `${day}.LFLL.cabin.-.0`]) {
    assert.equal((await w.hire(id)).status, 404, id);
  }
  assert.equal((await w.hire(first.id)).status, 201);
  assert.equal(w.people().find((p) => p.candidate_id === first.id)!.name, first.name, 'the hired person is the listed one');
});

test('same day, same inputs: the same candidates, and a new day brings others', async () => {
  const w = await world('LFPG', 'LFLL');
  const a = await w.list('family=pilot&base=LFPG&qual=AT76'), b = await w.list('family=pilot&base=LFPG&qual=AT76');
  assert.deepEqual(a, b);
  const other = await world('LFPG', 'LFLL');
  assert.deepEqual((await other.list('family=pilot&base=LFPG&qual=AT76')).candidates.map((c) => c.id), a.candidates.map((c) => c.id));
  w.h.clock.t += DAY_MS;
  assert.notDeepEqual((await w.list('family=pilot&base=LFPG&qual=AT76')).candidates.map((c) => c.name), a.candidates.map((c) => c.name));
});

test('names follow the country of the base: JP and FR candidates, agency pilots, interims and the starter crew', async () => {
  const jp = await world('RJTT', 'RJBB');
  const jpList = (await jp.list('family=cabin&base=RJTT')).candidates;
  assert.ok(jpList.length >= 6 && jpList.every((c) => fromPool(c.name, 'jp')), jpList.map((c) => c.name).join(', '));
  const jpPilots = (await jp.list('family=pilot&base=RJTT&qual=AT76')).candidates;
  assert.ok(jpPilots.every((c) => fromPool(c.name, 'jp')));

  const fr = await world('LFPG', 'LFLL');
  const frList = (await fr.list('family=cabin&base=LFPG')).candidates;
  assert.ok(frList.every((c) => fromPool(c.name, 'fr')), frList.map((c) => c.name).join(', '));

  const interim = await jp.call('POST', '/staff/interim', { family: 'cabin', days: 2 });
  assert.equal(interim.status, 201, interim.text);
  assert.ok(fromPool(interim.body.member.name, 'jp') && interim.body.member.name.endsWith(' (interim)'), interim.body.member.name);

  grantStarterCrew(jp.h.db, jp.cid, jp.h.clock.t);
  const starters = jp.people().filter((p) => p.candidate_id === null && !p.name.endsWith('(interim)'));
  assert.ok(starters.length > 0 && starters.every((p) => fromPool(p.name, 'jp')), starters.map((p) => p.name).join(', '));
  assert.equal(get<{ n: number }>(jp.h.db, 'SELECT COUNT(*) AS n FROM staff WHERE company_id = ? AND name LIKE ?', jp.cid, '% (interim)')!.n, 1);
});

test('the recruiter agency shortlists pilots named after the base country', async () => {
  const w = await world('RJTT', 'RJBB');
  w.h.clock.t += 2 * HOUR;
  await w.call('GET', '/network');
  const m = await w.call('POST', '/agency/missions', { base: 'RJTT', qual: 'AT76', count: 2 });
  assert.equal(m.status, 201, m.text);
  w.h.clock.t += AGENCY_SEARCH_DAYS * DAY_MS;
  const v = (await w.call('GET', '/agency/options')).body as AgencyView;
  const list = v.mission!.shortlist!;
  assert.equal(list.length, 3);
  assert.ok(list.every((c) => fromPool(c.name, 'jp')), list.map((c) => c.name).join(', '));
});
