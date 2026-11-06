import type { CompanyProfile, Leaderboard, LeaderboardRow } from '@opc/shared';

export type SortKey = 'worth' | 'gain' | 'flights' | 'reputation';
export const SORT_KEYS: readonly SortKey[] = ['worth', 'gain', 'flights', 'reputation'];

/** A leaderboard row plus the season gain: net worth now minus net worth at the end of the previous season (null for a company that did not exist then). */
export type Standing = LeaderboardRow & { gain: number | null };

/** The season listed right after `season` in `lb.seasons` (newest first), if any. */
export const previousSeason = (lb: Pick<Leaderboard, 'seasons'>, season: string): string | null => lb.seasons[lb.seasons.indexOf(season) + 1] ?? null;

export function withGain(rows: LeaderboardRow[], prev: LeaderboardRow[] | null): Standing[] {
  const before = new Map(prev?.map((r) => [r.companyId, r.netWorth]));
  return rows.map((r) => ({ ...r, gain: before.has(r.companyId) ? r.netWorth - before.get(r.companyId)! : null }));
}

const SORT_VALUE: Record<SortKey, (s: Standing) => number> = { worth: (s) => s.netWorth, gain: (s) => s.gain ?? -Infinity, flights: (s) => s.flights, reputation: (s) => s.reputation };
/** Best first; ties keep the official rank order. The `rank` field itself is never rewritten: it is the net-worth rank the server gives. */
export const sortStandings = (rows: Standing[], key: SortKey): Standing[] => [...rows].sort((a, b) => SORT_VALUE[key](b) - SORT_VALUE[key](a) || a.rank - b.rank);

/** A new season: nobody has flown yet. */
export const isFreshSeason = (rows: LeaderboardRow[]): boolean => rows.length > 0 && rows.every((r) => r.flights === 0);

/** Day of the (UTC) month and its length: "day 5 of 30". */
export function seasonDay(now: number): { day: number; length: number } {
  const d = new Date(now);
  return { day: d.getUTCDate(), length: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() };
}

export type Kind = 'you' | 'pilot' | 'cautious' | 'aggressive';
/** Who a company is. The AI style comes from its profile; until that loads an AI row is `null`. */
export const kindOf = (row: Pick<LeaderboardRow, 'companyId' | 'isAI'>, meId: number, profile?: Pick<CompanyProfile, 'personality'>): Kind | null =>
  row.companyId === meId ? 'you' : !row.isAI ? 'pilot' : (profile?.personality?.style ?? null);

// ------------------------------------------------------------------ duel

export type DuelKey = 'worth' | 'gain' | 'flights' | 'reputation' | 'hours' | 'revenuePerFlight';
export type DuelRow = { key: DuelKey; a: number | null; b: number | null; winner: 'a' | 'b' | 'tie' | null; aShare: number; bShare: number };
export type Side = { standing: Standing; profile: CompanyProfile };

const DUEL_VALUE: Record<DuelKey, (s: Side) => number | null> = {
  worth: (s) => s.standing.netWorth, gain: (s) => s.standing.gain, flights: (s) => s.standing.flights, reputation: (s) => s.standing.reputation,
  hours: (s) => s.profile.hours, revenuePerFlight: (s) => (s.profile.flights > 0 ? s.profile.revenue / s.profile.flights : null),
};
export const DUEL_KEYS = Object.keys(DUEL_VALUE) as DuelKey[];

/** Side by side; a figure missing on either side leaves that line without a winner. Bar lengths are shares of the larger magnitude. */
export function duel(a: Side, b: Side): DuelRow[] {
  return DUEL_KEYS.map((key) => {
    const x = DUEL_VALUE[key](a), y = DUEL_VALUE[key](b);
    if (x === null || y === null) return { key, a: x, b: y, winner: null, aShare: 0, bShare: 0 };
    const top = Math.max(Math.abs(x), Math.abs(y)) || 1;
    return { key, a: x, b: y, winner: x === y ? 'tie' : x > y ? 'a' : 'b', aShare: Math.abs(x) / top, bShare: Math.abs(y) / top };
  });
}

/** Lines won by each side. */
export const duelScore = (rows: DuelRow[]): { a: number; b: number } => ({ a: rows.filter((r) => r.winner === 'a').length, b: rows.filter((r) => r.winner === 'b').length });

// ------------------------------------------------------------------ season recap

export type Recap = { rank: number; of: number; worth: number; gain: number | null; flights: number; reputation: number; reputationDelta: number | null; podium: Standing[] };
/** A finished season from the viewpoint of `meId`; null when the company has no line in it. `before` is the season ahead of it, for the deltas. */
export function recapOf(season: Leaderboard, before: Leaderboard | null, meId: number): Recap | null {
  const rows = withGain(season.rows, before?.rows ?? null);
  const mine = rows.find((r) => r.companyId === meId);
  if (!mine) return null;
  const prior = before?.rows.find((r) => r.companyId === meId);
  return { rank: mine.rank, of: rows.length, worth: mine.netWorth, gain: mine.gain, flights: mine.flights, reputation: mine.reputation, reputationDelta: prior ? Math.round((mine.reputation - prior.reputation) * 10) / 10 : null, podium: rows.slice(0, 3) };
}
