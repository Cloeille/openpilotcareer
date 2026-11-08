// Only jobs that suit an aircraft are offered to it: a load that fills enough of it and a positive net at the type's standard costs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_LOAD_PCT, cannotFly, jobFits, jobMisfit, standardNet, type Job } from '@opc/shared';
import { airportList, airports, catalogType } from './catalog.ts';
import { JOB_WINDOW_MS, boardFor, windowOf } from './board.ts';
import { insertAircraft } from './fleet-extras.ts';
import { harness } from './harness.ts';

const WINDOWS = Array.from({ length: 60 }, (_, i) => 90_000 + i);
const sizeOf = (j: Job) => airports.get(j.destination)!.size;
const boards = (icaos: string[]): Job[] => icaos.flatMap((i) => WINDOWS.flatMap((w) => boardFor(airports.get(i)!, w))).filter((j) => !j.requiredAircraft);
const fitting = (icao: string, jobs: Job[]): Job[] => jobs.filter((j) => jobFits(catalogType(icao), j, sizeOf(j)));
const LARGE = ['LFPG', 'EGLL', 'KJFK', 'RJTT'];
const mediums = airportList.filter((a) => a.size === 'medium' && a.country === 'FR').slice(0, 4).map((a) => a.icao);
const smalls = airportList.filter((a) => a.size === 'small' && a.country === 'FR').slice(0, 4).map((a) => a.icao);

test('a 290-seat aircraft is never offered a small load, and every job offered to a type nets above zero', () => {
  for (const icao of ['B789', 'B77W', 'A20N', 'AT76', 'C208', 'C172']) {
    const t = catalogType(icao);
    for (const j of fitting(icao, boards([...LARGE, ...mediums, ...smalls]))) {
      assert.equal(cannotFly(t, j), null);
      assert.ok(standardNet(t, j, sizeOf(j)) > 0, `${icao} nets ${standardNet(t, j, sizeOf(j))} on ${j.id}`);
      if (j.kind === 'pax') assert.ok(j.pax * 100 >= t.seats * MIN_LOAD_PCT, `${icao} seats ${t.seats}, job ${j.pax}`);
      else assert.ok(j.payloadKg * 100 >= t.cargoKg * MIN_LOAD_PCT, `${icao} holds ${t.cargoKg}, job ${j.payloadKg}`);
    }
  }
  const onePax = { kind: 'pax', pax: 1, payloadKg: 100, distanceNm: 300, payout: 5_000 } as const;
  assert.equal(jobMisfit(catalogType('B789'), onePax, 'large')?.code, 'load_too_small');
  assert.equal(jobMisfit(catalogType('C172'), { ...onePax, pax: 2, payloadKg: 200 }, 'large'), null);
});

test('a loss-making job is refused as job_not_profitable, a too-big one as cannot_fly', () => {
  const a20n = catalogType('A20N');
  const cheap = { kind: 'pax', pax: 150, payloadKg: 15_000, distanceNm: 2_000, payout: 1_000 } as const;
  assert.equal(jobMisfit(a20n, cheap, 'large')?.code, 'job_not_profitable');
  assert.equal(jobMisfit(catalogType('C172'), cheap, 'large')?.code, 'cannot_fly');
  assert.equal(jobMisfit(a20n, { ...cheap, payout: 400_000 }, 'large'), null);
});

test('every type finds light jobs where it stands: a C172 still gets light jobs, and an airliner has several per window at a large airport', () => {
  for (const icao of [...smalls, ...mediums, ...LARGE]) assert.ok(fitting('C172', boards([icao])).length >= WINDOWS.length / 2, `C172 at ${icao}`);
  for (const t of ['B789', 'B77W']) for (const icao of LARGE) {
    const perWindow = fitting(t, boards([icao])).length / WINDOWS.length;
    assert.ok(perWindow >= 4, `${t} at ${icao}: ${perWindow} fitting jobs per window`);
  }
  assert.ok(fitting('A20N', boards(LARGE)).length / (WINDOWS.length * LARGE.length) >= 3, 'a narrowbody has jobs at large airports too');
  for (const t of ['A20N', 'B738']) for (const icao of mediums) {
    const perWindow = fitting(t, boards([icao])).length / WINDOWS.length;
    assert.ok(perWindow >= 3, `${t} at medium ${icao}: ${perWindow} fitting jobs per window`);
  }
});

test('the board stays deterministic and keeps its ids', () => {
  const o = airports.get('LFPG')!;
  const a = boardFor(o, 123_456), b = boardFor(o, 123_456);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((j) => j.id), a.map((_, i) => `LFPG-123456-${i}`));
  const within = (icao: string, pax: number, cargoKg: number): boolean => WINDOWS.every((w) => boardFor(airports.get(icao)!, w).every((j) => (j.kind === 'pax' ? j.pax <= pax : j.payloadKg <= cargoKg)));
  assert.ok(within(mediums[0]!, 200, 9_000), 'medium airports stop at narrowbody loads');
  assert.ok(within(smalls[0]!, 4, 200), 'small airports keep the light mix');
});

test('GET /jobs lists only the jobs that suit an aircraft standing at their origin, with the aircraft they fit', async () => {
  const h = await harness();
  const { token, me } = await h.register('widebody');
  const c172 = me.fleet[0].id as number;
  const b789 = insertAircraft(h.db, { companyId: me.company.id, icao: 'B789', hub: 'LFPG', value: 1, ownership: 'owned', at: h.clock.t });
  const types = new Map([[c172, catalogType('C172')], [b789, catalogType('B789')]]);
  for (let i = 0; i < 6; i++, h.clock.t += JOB_WINDOW_MS) {
    const board = (await h.call('GET', '/api/v1/jobs?airport=LFPG', { token })).body.jobs as Job[];
    assert.deepEqual(board.map((j) => j.id), boardFor(airports.get('LFPG')!, windowOf(h.clock.t)).map((j) => j.id).filter((id) => board.some((j) => j.id === id)), 'shared ids, in board order');
    for (const j of board) {
      assert.ok(j.fits && j.fits.length > 0);
      for (const [id, t] of types) assert.equal(j.fits.includes(id), jobFits(t, j, sizeOf(j)), `${t.icao} on ${j.id}`);
    }
    assert.ok(board.some((j) => j.fits!.includes(b789)) && board.some((j) => j.fits!.includes(c172)), 'both aircraft have work');
    assert.ok(!board.some((j) => j.kind === 'pax' && j.pax < 4 && !j.fits!.includes(c172)), 'a light job is offered to the C172 only if it pays');
  }
});

test('a board with none of the company\'s aircraft is judged against the whole fleet, so a remote airport can be browsed', async () => {
  const h = await harness();
  const { token } = await h.register('browser');
  const c172 = catalogType('C172');
  const board = (await h.call('GET', '/api/v1/jobs?airport=EGLL', { token })).body.jobs as Job[];
  assert.ok(board.length > 0);
  assert.ok(board.every((j) => jobFits(c172, j, sizeOf(j)) && j.fits!.length === 1));
});

test('accept refuses a board job the aircraft does not suit, with the reason; the job stays open', async () => {
  const h = await harness();
  const { token, me } = await h.register('refused');
  const b789 = insertAircraft(h.db, { companyId: me.company.id, icao: 'B789', hub: 'LFPG', value: 1, ownership: 'owned', at: h.clock.t });
  const board = boardFor(airports.get('LFPG')!, windowOf(h.clock.t));
  const t = catalogType('B789');
  const small = board.find((j) => jobMisfit(t, j, sizeOf(j))?.code === 'load_too_small')!;
  assert.ok(small, 'the board has a job too light for a B789');
  const r = await h.call('POST', `/api/v1/jobs/${small.id}/accept`, { token, body: { aircraftId: b789 } });
  assert.deepEqual([r.status, r.body.error], [422, 'load_too_small'], r.text);
  const listed = (await h.call('GET', '/api/v1/jobs?airport=LFPG', { token })).body.jobs as Job[];
  assert.ok(!listed.some((j) => j.id === small.id && j.fits?.includes(b789)));

  const fit = board.find((j) => !j.requiredAircraft && jobFits(t, j, sizeOf(j)))!;
  assert.equal((await h.call('POST', `/api/v1/jobs/${fit.id}/accept`, { token, body: { aircraftId: b789 } })).status, 201);
});

test('accept refuses a job that loses money for the aircraft, with job_not_profitable', async () => {
  const h = await harness();
  const { token, me } = await h.register('loser');
  const t = catalogType('C172');
  for (let i = 0; i < 80; i++, h.clock.t += JOB_WINDOW_MS) {
    const losing = boardFor(airports.get('LFPG')!, windowOf(h.clock.t)).find((j) => jobMisfit(t, j, sizeOf(j))?.code === 'job_not_profitable');
    if (!losing) continue;
    const r = await h.call('POST', `/api/v1/jobs/${losing.id}/accept`, { token, body: { aircraftId: me.fleet[0].id } });
    assert.deepEqual([r.status, r.body.error], [422, 'job_not_profitable'], r.text);
    return;
  }
  assert.fail('no loss-making job for a C172 at LFPG in 80 windows');
});

test('SimBrief imports are not filtered: the player made them', async () => {
  const ofp = { origin: { icao_code: 'LFPG' }, destination: { icao_code: 'EGLL' }, aircraft: { icaocode: 'B789' }, weights: { payload: '100', pax_count_actual: '1' }, fuel: { plan_ramp: '90' }, general: { route: 'DCT' }, params: { units: 'kgs' } };
  const h = await harness({ fetch: (async () => new Response(JSON.stringify(ofp), { status: 200 })) as typeof fetch });
  const { token, me } = await h.register('briefer');
  const b789 = insertAircraft(h.db, { companyId: me.company.id, icao: 'B789', hub: 'LFPG', value: 1, ownership: 'owned', at: h.clock.t });
  const r = await h.call('POST', '/api/v1/jobs/import-simbrief', { token, body: { simbriefUsername: 'briefer' } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.pax, 1);
  assert.equal(jobFits(catalogType('B789'), { ...r.body, requiredAircraft: undefined }, 'large'), false, 'a board job like it would be refused');
  const listed = (await h.call('GET', '/api/v1/jobs', { token })).body;
  assert.deepEqual(listed.imported.map((j: Job) => j.id), [r.body.id]);
  assert.equal(listed.imported[0].fits, undefined);
  const acc = await h.call('POST', `/api/v1/jobs/${r.body.id}/accept`, { token, body: { aircraftId: b789 } });
  assert.equal(acc.status, 201, acc.text);
});

test('the first job suggestion follows the same rule', async () => {
  const h = await harness();
  const { token, me } = await h.register('starter');
  const hubJobs = (await h.call('GET', '/api/v1/jobs?airport=LFPG', { token })).body.jobs as Job[];
  const r = await h.call('GET', `/api/v1/companies/${me.company.id}/first-job`, { token });
  if (r.status === 200) {
    assert.ok(jobFits(catalogType('C172'), r.body.job, sizeOf(r.body.job)));
    assert.deepEqual(r.body.job.fits, [me.fleet[0].id]);
    assert.ok(hubJobs.length > 0);
  } else assert.equal(r.body.error, 'no_flyable_job');
});
