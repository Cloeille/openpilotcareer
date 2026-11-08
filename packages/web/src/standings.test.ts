import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_REALISM, realismView, type CompanyProfile, type Leaderboard, type LeaderboardRow } from '@opc/shared';
import { duel, duelScore, hubOf, isFreshSeason, kindOf, previousSeason, recapOf, seasonDay, sortStandings, withGain } from './standings.ts';

const row = (rank: number, companyId: number, o: Partial<LeaderboardRow> = {}): LeaderboardRow => ({ rank, companyId, name: 'C' + companyId, isAI: false, hub: null, netWorth: 1000 - rank * 100, flights: 10, reputation: 50, ...o });
const lb = (season: string, rows: LeaderboardRow[], seasons = ['2026-11', '2026-10', '2026-09']): Leaderboard => ({ season, seasons, rows });
const profile = (o: Partial<CompanyProfile> = {}): CompanyProfile => ({ id: 1, name: 'x', balance: 0, reputation: 50, flights: 100, hours: 80, revenue: 200000, netWorth: 0, isAI: false, code: null, callsign: null, liveryColor: null, startMode: null, realism: realismView(NEUTRAL_REALISM), hubs: [], fleet: [], personality: null, seasons: [], ...o });

test('season gain is net worth minus the previous snapshot; null without one', () => {
  const s = withGain([row(1, 1, { netWorth: 900 }), row(2, 2, { netWorth: 500 })], [row(1, 1, { netWorth: 700 })]);
  assert.deepEqual(s.map((x) => x.gain), [200, null]);
  assert.deepEqual(withGain([row(1, 1)], null).map((x) => x.gain), [null]);
});

test('sorting keeps the server rank and orders ties by it; missing gains go last', () => {
  const s = withGain([row(1, 1, { flights: 5 }), row(2, 2, { flights: 9 }), row(3, 3, { flights: 9 })], [row(1, 1, { netWorth: 0 }), row(2, 2, { netWorth: 0 })]);
  assert.deepEqual(sortStandings(s, 'flights').map((x) => x.companyId), [2, 3, 1]);
  assert.deepEqual(sortStandings(s, 'gain').map((x) => x.companyId), [1, 2, 3]);
  assert.deepEqual(sortStandings(s, 'flights').map((x) => x.rank), [2, 3, 1]);
});

test('the hub column reads the row hub for a player and an AI alike; a dash when the company has none', () => {
  const rows = withGain([row(1, 1, { hub: 'RJTT' }), row(2, 2, { isAI: true, hub: 'LFPG' }), row(3, 3)], null);
  assert.deepEqual(rows.map(hubOf), ['RJTT', 'LFPG', '–']);
});

test('a fresh season is one where nobody has flown', () => {
  assert.equal(isFreshSeason([row(1, 1, { flights: 0 }), row(2, 2, { flights: 0 })]), true);
  assert.equal(isFreshSeason([row(1, 1, { flights: 0 }), row(2, 2)]), false);
  assert.equal(isFreshSeason([]), false);
});

test('day of the season and its length', () => {
  assert.deepEqual(seasonDay(Date.UTC(2026, 10, 5, 12)), { day: 5, length: 30 });
  assert.deepEqual(seasonDay(Date.UTC(2028, 1, 29, 23)), { day: 29, length: 29 });
  assert.deepEqual(seasonDay(Date.UTC(2026, 11, 31, 23, 59)), { day: 31, length: 31 });
});

test('previous season is the next one listed', () => {
  assert.equal(previousSeason(lb('2026-11', []), '2026-11'), '2026-10');
  assert.equal(previousSeason(lb('2026-09', []), '2026-09'), null);
  assert.equal(previousSeason(lb('x', []), 'unknown'), '2026-11');
});

test('who a company is: you, a pilot, or an AI of known style', () => {
  assert.equal(kindOf(row(1, 7), 7), 'you');
  assert.equal(kindOf(row(1, 8), 7), 'pilot');
  assert.equal(kindOf(row(1, 9, { isAI: true }), 7), null);
  assert.equal(kindOf(row(1, 9, { isAI: true }), 7, profile({ personality: { style: 'cautious', preferred: [] } })), 'cautious');
});

test('duel: a winner per line, ties, bars relative to the larger value, no winner when a figure is missing', () => {
  const me = { standing: withGain([row(7, 1, { netWorth: 800, flights: 47, reputation: 4.6 })], [row(1, 1, { netWorth: 547 })])[0]!, profile: profile({ hours: 50, flights: 10, revenue: 1000 }) };
  const them = { standing: withGain([row(6, 2, { netWorth: 890, flights: 118, reputation: 4.6 })], null)[0]!, profile: profile({ hours: 80, flights: 0, revenue: 0 }) };
  const rows = duel(me, them);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.worth!.winner, 'b');
  assert.equal(by.worth!.aShare, 800 / 890);
  assert.equal(by.worth!.bShare, 1);
  assert.equal(by.reputation!.winner, 'tie');
  assert.equal(by.gain!.winner, null);
  assert.equal(by.revenuePerFlight!.winner, null);
  assert.equal(by.hours!.winner, 'b');
  assert.deepEqual(duelScore(rows), { a: 0, b: 3 });
});

test('recap: rank out of the field, gain and reputation change against the season before, podium', () => {
  const oct = lb('2026-10', [row(1, 5, { netWorth: 3000 }), row(2, 6, { netWorth: 2000 }), row(3, 1, { netWorth: 1500, flights: 268, reputation: 4.7 }), row(4, 8)]);
  const sep = lb('2026-09', [row(1, 1, { netWorth: 1000, reputation: 4.6 })]);
  const r = recapOf(oct, sep, 1)!;
  assert.equal(r.rank, 3);
  assert.equal(r.of, 4);
  assert.equal(r.gain, 500);
  assert.equal(r.reputationDelta, 0.1);
  assert.deepEqual(r.podium.map((p) => p.companyId), [5, 6, 1]);
  assert.equal(recapOf(oct, null, 1)!.gain, null);
  assert.equal(recapOf(oct, sep, 99), null);
});
