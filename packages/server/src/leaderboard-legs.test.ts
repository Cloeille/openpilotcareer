import { test } from 'node:test';
import assert from 'node:assert/strict';
import { all, get, run } from './db.ts';
import { insertAircraft } from './fleet-extras.ts';
import { leaderboard, snapshot } from './game.ts';
import { harness } from './harness.ts';

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0); // the harness clock: 4 Nov 2026
const HOUR = 3_600_000;

async function world() {
  const h = await harness();
  const u = await h.register('amy', 'LFPG');
  const cid = u.me.company.id as number;
  const ac = insertAircraft(h.db, { companyId: cid, icao: 'AT76', hub: 'LFPG', value: 1_000_000, ownership: 'owned', at: NOW });
  const lineId = run(h.db, `INSERT INTO lines (company_id, a, b, created_at, freq_per_day, days, window_start_min, window_end_min, turnaround_min, flight_base) VALUES (?, 'LFLL', 'LFPG', 1, 3, 127, 360, 1080, 30, 1100)`, cid).id;
  let no = 1100;
  const leg = (arrAt: number, status: string) => run(h.db, 'INSERT INTO scheduled_flights (line_id, company_id, aircraft_id, flight_no, dep_at, arr_at, origin, dest, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', lineId, cid, ac, no++, arrAt - HOUR, arrAt, 'LFPG', 'LFLL', status);
  const flown = (season: string, status = 'verified') => run(h.db, `INSERT INTO flights (company_id, aircraft_id, aircraft_icao, job_id, source, kind, origin, destination, distance_nm, payload_kg, pax, payout, status, accepted_at, season) VALUES (?, ?, 'AT76', ?, 'board', 'cargo', 'LFPG', 'EGLL', 200, 300, 0, 3000, ?, 40, ?)`, cid, ac, `J${no++}`, status, season);
  const board = (season: string) => leaderboard(h.db, season, NOW).rows.find((r) => r.companyId === cid)!.flights;
  const stored = (season: string) => get<{ flights: number }>(h.db, 'SELECT flights FROM season_stats WHERE season = ? AND company_id = ?', season, cid)?.flights;
  return { h, cid, leg, flown, board, stored };
}

test('the Vols column adds a company\'s done line legs of the season to its flown flights; scheduled and cancelled legs do not count', async () => {
  const w = await world();
  w.flown('2026-11');
  w.flown('2026-11', 'rejected');
  for (let i = 0; i < 3; i++) w.leg(NOW - (i + 1) * HOUR, 'done');
  w.leg(NOW + 6 * HOUR, 'scheduled');
  w.leg(NOW - 8 * HOUR, 'cancelled');
  assert.equal(w.board('2026-11'), 4);
  snapshot(w.h.db, w.cid, NOW);
  assert.equal(w.stored('2026-11'), 4, 'the snapshot writes the number the live board shows');
});

test('a leg counts in the season it landed in: November\'s leg is not in October\'s figure and the reverse, midnight UTC included', async () => {
  const w = await world();
  w.leg(Date.UTC(2026, 9, 31, 23, 59, 59), 'done');
  w.leg(Date.UTC(2026, 10, 1, 0, 0, 0), 'done');
  w.flown('2026-10');
  snapshot(w.h.db, w.cid, Date.UTC(2026, 9, 31, 23, 59, 59));
  snapshot(w.h.db, w.cid, NOW);
  assert.equal(w.stored('2026-10'), 2, 'October: one flown flight and the leg landed on the 31st');
  assert.equal(w.stored('2026-11'), 1, 'November: only the leg landed on the 1st at 00:00Z');
  assert.equal(w.board('2026-10'), 2, 'the closed season is read from season_stats');
  assert.equal(w.board('2026-11'), 1);
  const plan = all<{ detail: string }>(w.h.db, `EXPLAIN QUERY PLAN SELECT COUNT(*) FROM scheduled_flights l WHERE l.company_id = ? AND l.status = 'done' AND l.arr_at >= 1 AND l.arr_at < 2`, w.cid).map((r) => r.detail).join(' ');
  assert.match(plan, /scheduled_company_landed/, 'the count is an index range, not a scan of the company\'s legs');
});

test('a company without a leg or a flight shows 0, the fresh-season case', async () => {
  const w = await world();
  assert.equal(w.board('2026-11'), 0);
});
