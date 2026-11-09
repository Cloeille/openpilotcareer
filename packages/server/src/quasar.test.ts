import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPRESS_AIRCRAFT, EXPRESS_MAX_NM, EXPRESS_MIN_NM, aircraftPrice, aircraftValue, blockHours, cannotFly, cannotFlyCause, expressPayout, fuelBurnKg, jobMisfit, jobPayout, settle, standardNet, type Job } from '@opc/shared';
import { boardFor } from './board.ts';
import { insertAircraft } from './fleet-extras.ts';
import { airportList, aircraftTypes, catalogType, searchAircraftTypes } from './catalog.ts';
import { harness } from './harness.ts';

const QASR = catalogType('QASR');
const largeAirports = airportList.filter((a) => a.size === 'large');
const sampleBoards = (n = 40): Job[] => largeAirports.slice(0, n).flatMap((a) => boardFor(a, 1000));
const express = (jobs: Job[]): Job[] => jobs.filter((j) => j.requiredAircraft);
const netOf = (j: Job): number => settle({ payout: j.payout, distanceNm: j.distanceNm, aircraft: QASR, status: 'verified', destSize: 'large', destIsHub: false }).net;

test('the catalogue has the curated Quasar, not a derived one', () => {
  assert.equal(QASR.derived, false);
  assert.deepEqual([QASR.name, QASR.category, QASR.engines, QASR.wtc, QASR.seats, QASR.cargoKg, QASR.cruiseKts, QASR.rangeNm],
    ['Flying Fries Quasar', 'spaceplane', 4, 'H', 0, 2000, 5000, 9999]);
  assert.equal(aircraftTypes.get('QASR'), QASR);
  assert.equal(searchAircraftTypes('quasar')[0]?.icao, 'QASR');
});

test('the Quasar costs a fortune to buy, burns no fuel, and its flight hour costs what a large widebody flight hour does', () => {
  assert.deepEqual([aircraftPrice(QASR), aircraftValue(QASR)], [10_000_000, 8_000_000], '2 t x 5000 kts, like every type; resale is 80 %');
  const hours = blockHours(QASR, 8000);
  assert.ok(hours > 1.5 && hours < 2.5, `block hours ${hours}`);
  const s = settle({ payout: 0, distanceNm: 8000, aircraft: QASR, status: 'verified', destSize: 'large', destIsHub: false });
  assert.equal(s.fuelCost, 0, 'fuel regeneration');
  const perHour = (icao: string): number => settle({ payout: 0, distanceNm: 1000, aircraft: catalogType(icao), status: 'verified', destSize: 'large', destIsHub: false, blockHours: 1 }).maintenance;
  assert.ok(perHour('QASR') > 0.8 * perHour('A35K') && perHour('QASR') < 1.2 * perHour('B77W'), `Quasar ${perHour('QASR')} / h, A35K ${perHour('A35K')}, B77W ${perHour('B77W')}`);
  for (const j of express(sampleBoards())) assert.ok(netOf(j) > 0, `${j.distanceNm} nm nets ${netOf(j)}`);
});

test('an express job never loses money: standard net, and the net at the 660 kt players really fly, grow with the distance', () => {
  const job = (distanceNm: number): Job => ({ id: 'x', source: 'board', kind: 'cargo', origin: 'LFPG', destination: 'KJFK', distanceNm, payloadKg: 2000, pax: 0, payout: expressPayout(distanceNm), requiredAircraft: EXPRESS_AIRCRAFT });
  const real = (d: number, landingFpm = -300): number => settle({ payout: expressPayout(d), distanceNm: d, aircraft: QASR, status: 'verified', destSize: 'large', destIsHub: false, blockHours: d / 660 + 0.3, landingFpm }).net;
  let last = 0;
  for (const d of [EXPRESS_MIN_NM, 300, 1010, 3000, 8000]) {
    const std = standardNet(QASR, job(d), 'large');
    assert.ok(std > 0 && real(d) > 0 && real(d, -950) > 0, `${d} nm: standard ${std}, real ${real(d)}, with a hard landing ${real(d, -950)}`);
    assert.ok(std > last, 'the net grows with the distance');
    assert.equal(jobMisfit(QASR, job(d), 'large'), null, 'express jobs obey the same net > 0 rule as any board job');
    last = std;
  }
  assert.ok(standardNet(QASR, job(300), 'large') >= 10_000, `300 nm nets ${standardNet(QASR, job(300), 'large')}`);
  assert.ok(real(300) >= 10_000, `a 300 nm hop nets ${real(300)} at 660 kt`);
  assert.ok(real(300, -950) >= 7_000, 'and still pays well after a hard landing, which doubles the upkeep');
  assert.equal(jobMisfit(QASR, { ...job(300), payout: 1_000 }, 'large')?.code, 'job_not_profitable', 'the exemption is gone: a losing express job is a misfit');
  for (const j of express(sampleBoards())) assert.ok(standardNet(QASR, j, 'large') >= 9_000 && j.distanceNm <= EXPRESS_MAX_NM, `${j.distanceNm} nm`);
});

test('express payout: a short hop pays about 10 000, a long one the premium of a widebody long-haul flight', () => {
  const short = expressPayout(300), long = expressPayout(5000);
  assert.ok(short >= 12_000 && short <= 17_000, `300 nm pays ${short}: 10 k net after the 2 250 landing fee and the upkeep`);
  const b77w = settle({ payout: jobPayout('pax', 3000, 320 * 100), distanceNm: 3000, aircraft: catalogType('B77W'), status: 'verified', destSize: 'large', destIsHub: false }).net;
  const longNet = settle({ payout: long, distanceNm: 5000, aircraft: QASR, status: 'verified', destSize: 'large', destIsHub: false }).net;
  assert.ok(longNet > 0.8 * b77w && longNet < 1.2 * b77w, `a 5 000 nm express nets ${longNet}, a 777 long-haul ${b77w}`);
  assert.ok(expressPayout(200) < short && short < expressPayout(1000) && expressPayout(1000) / 1000 < long / 5000, 'rises with the distance, and so does the rate per nm');
  assert.ok(expressPayout(5000) > 5 * jobPayout('cargo', 5000, 2000), 'far above the regular cargo rate');
});

test('the board offers a few spaceplane express jobs, only at large airports, only for a QASR, deterministically', () => {
  const jobs = sampleBoards();
  const found = express(jobs);
  assert.ok(found.length >= 20, `${found.length} express jobs on 40 large boards`);
  for (const j of found) {
    assert.equal(j.requiredAircraft, EXPRESS_AIRCRAFT);
    assert.deepEqual([j.kind, j.payloadKg, j.pax, j.source], ['cargo', 2000, 0, 'board']);
    assert.ok(j.distanceNm >= EXPRESS_MIN_NM && j.distanceNm <= QASR.rangeNm, `${j.distanceNm} nm`);
    assert.equal(j.payout, expressPayout(j.distanceNm));
    assert.equal(airportList.find((a) => a.icao === j.origin)!.size, 'large');
    assert.equal(airportList.find((a) => a.icao === j.destination)!.size, 'large');
  }
  assert.ok(found.some((j) => j.distanceNm < 1000) && found.some((j) => j.distanceNm >= 4000), 'short hops and intercontinental ones');
  for (const a of largeAirports.slice(0, 40)) assert.ok(express(boardFor(a, 1000)).length <= 2, 'rare');
  const ids = jobs.map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(sampleBoards().map((j) => j.payout), jobs.map((j) => j.payout), 'a pure function of airport and window');
  const small = airportList.filter((a) => a.size !== 'large').slice(0, 300);
  assert.equal(small.flatMap((a) => express(boardFor(a, 1000))).length, 0, 'no runway for it');
});

test('no other type can take an express job', () => {
  const job = express(sampleBoards())[0]!;
  for (const icao of ['A388', 'B748', 'C172', 'A20N']) {
    assert.equal(cannotFlyCause(catalogType(icao), job), 'type', icao);
    assert.match(cannotFly(catalogType(icao), job)!, /requires a QASR/);
  }
  assert.equal(cannotFly(QASR, { ...job, distanceNm: 8000 }), null);
});

test('a Quasar flight 5x slower than expected, with a fuel burn of 5005 kg and a -700 fpm landing, is verified: no fuel, no hard landing, no reputation lost', async () => {
  const h = await harness();
  const p = await h.register('slowquasar');
  const cid = p.me.company.id as number;
  const aircraftId = insertAircraft(h.db, { companyId: cid, icao: 'QASR', hub: 'LFPG', value: aircraftPrice(QASR), ownership: 'owned', at: h.clock.t });
  const job = (express((await h.call('GET', '/api/v1/jobs', { token: p.token })).body.jobs as Job[])).sort((a, b) => a.distanceNm - b.distanceNm)[0]!;
  const accepted = await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: p.token, body: { aircraftId } });
  assert.equal(accepted.status, 201, accepted.text);
  const reputation = (): number => (h.db.prepare('SELECT reputation FROM companies WHERE id = ?').get(cid) as { reputation: number }).reputation;
  const before = reputation();
  const key = await h.apiKey(p.token);
  const takeoff = h.clock.t + 60_000, landed = takeoff + 5 * (job.distanceNm / 5000 + 0.1) * 3_600_000;
  h.clock.t = landed + 60_000;
  const r = await h.call('POST', `/api/v1/flights/${accepted.body.id}/telemetry-verify`, { token: key, body: {
    takeoffAt: new Date(takeoff).toISOString(), landedAt: new Date(landed).toISOString(), departureIcao: job.origin, arrivalIcao: job.destination, aircraftIcao: 'QASR',
    payloadKg: 2000, fuelUsedKg: 5005, landingFpm: -700, distanceNm: job.distanceNm + 2, source: 'simconnect',
  } });
  assert.equal(r.body.verification, 'verified', r.text);
  assert.equal(r.body.flight.fuelCost, 0);
  assert.equal(r.body.flight.landing.hard, false, '-700 fpm is not hard for a spaceplane');
  assert.ok(reputation() >= before, 'a completed flight never lowers reputation');
  assert.ok(r.body.flight.net > 0);
});

test('an express job is refused to a C172, flown and paid with a Quasar, and the designator QASR cannot be redefined', async () => {
  const h = await harness();
  const p = await h.register('quasarpilot');
  const cid = p.me.company.id as number;
  const listed = async (): Promise<Job[]> => express((await h.call('GET', '/api/v1/jobs', { token: p.token })).body.jobs as Job[]);
  assert.equal((await listed()).length, 0, 'a company with no Quasar is not offered express jobs');
  const aircraftId = insertAircraft(h.db, { companyId: cid, icao: 'QASR', hub: 'LFPG', value: aircraftPrice(QASR), ownership: 'owned', at: h.clock.t });
  const job = (await listed()).sort((a, b) => a.distanceNm - b.distanceNm)[0]!;
  assert.ok(job, 'LFPG is a large airport: its board offers express jobs');
  assert.deepEqual(job.fits, [aircraftId], 'only the Quasar suits it');
  const fleet = p.me.fleet as { id: number }[];
  const refused = await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: p.token, body: { aircraftId: fleet[0]!.id } });
  assert.deepEqual([refused.status, refused.body.error], [422, 'cannot_fly']);
  assert.match(refused.body.message, /requires a QASR/);

  const accepted = await h.call('POST', `/api/v1/jobs/${job.id}/accept`, { token: p.token, body: { aircraftId } });
  assert.equal(accepted.status, 201, accepted.text);

  const key = await h.apiKey(p.token);
  const takeoff = h.clock.t + 60_000, landed = takeoff + (job.distanceNm / 5000 + 0.1) * 3_600_000; // at 5000 kts
  h.clock.t = landed + 60_000;
  const r = await h.call('POST', `/api/v1/flights/${accepted.body.id}/telemetry-verify`, { token: key, body: {
    takeoffAt: new Date(takeoff).toISOString(), landedAt: new Date(landed).toISOString(), departureIcao: job.origin, arrivalIcao: job.destination, aircraftIcao: 'QASR',
    payloadKg: 2000, fuelUsedKg: fuelBurnKg(QASR, job.distanceNm), landingFpm: -200, distanceNm: job.distanceNm + 2, source: 'simconnect',
  } });
  assert.equal(r.body.verification, 'verified', r.text);
  assert.equal(r.body.flight.revenue, job.payout);
  assert.equal(r.body.flight.fuelCost, 0);
  assert.ok(r.body.flight.net > 0);
  assert.deepEqual([r.body.flight.hardLandingFpm, r.body.flight.fuelRegenerated, r.body.flight.landing], [900, true, { fpm: -200, hard: false }]);

  const def = { icao: 'QASR', name: 'Fake', category: 'piston-single', engines: 1, wtc: 'L', seats: 2, cargoKg: 20, cruiseKts: 90, rangeNm: 300 };
  assert.equal((await h.call('POST', '/api/v1/me/custom-aircraft', { token: p.token, body: def })).status, 409);
});
