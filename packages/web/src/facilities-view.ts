import type { StaffFamily } from '@opc/shared';
import type { Building, FacilityDetail, FacilityKind, FacilityLevelInfo, FacilityOwner, FacilityPurchase, FacilityView, Hold } from './api-facilities.ts';
import type { IconName } from './icons.ts';
import type { Key } from './messages.ts';

/** Pure rules behind the FACILITIES screens: what a row says, which level can be picked, which building is next. The DOM lives in the screens. */

export const KIND_ICON: Record<FacilityKind, IconName> = { maintenance: 'wrench', terminal: 'door-open', cargo: 'package', office: 'building-2', airport: 'radio' };
/** The filter chips of the plan, in the mockup's order. `parking` is the hub's stands, not a facility. */
export const FILTERS = ['all', 'maintenance', 'terminal', 'cargo', 'office', 'parking'] as const;

/** What a hangar does to the aircraft based at its hub, whatever its level (S3: HANGAR_MAINTENANCE_DISCOUNT; swap for the shared constant once S3 is merged). */
export const MAINTENANCE_DISCOUNT_PCT = 35;

// ---------------------------------------------------------------- what a row says

export type Holding = 'leased' | 'owned' | 'available' | 'ai' | 'airport';

/** How the player stands with a building. */
export function holdingOf(f: Pick<FacilityView, 'owner' | 'contract'>): Holding {
  switch (f.owner) {
    case 'player': return f.contract?.kind === 'purchase' ? 'owned' : 'leased';
    case 'available': return 'available';
    case 'ai': return 'ai';
    case 'airport': return 'airport';
  }
}
/** The same for a building of the plan (`Building` has no contract; its `monthly` is what she pays, and an owned building is told by the facility screen). */
export const holdingOfOwner = (owner: FacilityOwner, hold: Hold | null): Holding => holdingOf({ owner, contract: hold ? { kind: hold } as FacilityView['contract'] : null });

export type Tone = 'plain' | 'accent' | 'dim';
export const HOLDING_TONE: Record<Holding, Tone> = { leased: 'plain', owned: 'plain', available: 'accent', ai: 'dim', airport: 'dim' };
export const HOLDING_KEY: Record<Holding, Key> = { leased: 'fc.h.leased', owned: 'fc.h.owned', available: 'fc.h.available', ai: 'fc.h.ai', airport: 'fc.h.airport' };

const HOLDING_ORDER: Holding[] = ['leased', 'owned', 'ai', 'available', 'airport'];
/** How many facilities a hub card lists before the rest of the available ones go to the "also available" line. */
export const SHOWN = 5;

/** The hub card's list: what the player holds, then what is free to take. `more` are the available ones that did not fit. */
export function shown(rows: readonly FacilityView[], cap = SHOWN): { rows: FacilityView[]; more: FacilityView[] } {
  const all = rows.filter((f) => holdingOf(f) !== 'airport').sort((a, b) => HOLDING_ORDER.indexOf(holdingOf(a)) - HOLDING_ORDER.indexOf(holdingOf(b)));
  return { rows: all.slice(0, cap), more: all.slice(cap).filter((f) => f.owner === 'available') };
}

/** The team rows of a hub card, biggest family first, empty ones left out. */
export function teamRows(byFamily: Partial<Record<StaffFamily, number>>): { family: StaffFamily; n: number }[] {
  return (Object.entries(byFamily) as [StaffFamily, number][]).filter(([, n]) => n > 0).map(([family, n]) => ({ family, n })).sort((a, b) => b.n - a.n);
}

/** What the player's contracts at a hub are, in one word. */
export function contractsOf(rows: readonly Pick<FacilityView, 'owner' | 'contract'>[]): 'none' | 'leased' | 'owned' | 'mixed' {
  const mine = rows.filter((f) => f.owner === 'player');
  if (mine.length === 0) return 'none';
  const buys = mine.filter((f) => f.contract?.kind === 'purchase').length;
  return buys === 0 ? 'leased' : buys === mine.length ? 'owned' : 'mixed';
}

/** The names of the companies that hold a building of the plan, once each. */
export const aiNames = (buildings: readonly Pick<Building, 'owner' | 'ownerName'>[]): string[] => [...new Set(buildings.flatMap((b) => (b.owner === 'ai' && b.ownerName ? [b.ownerName] : [])))];

/** The item `dir` steps from `current`, wrapping around; from nothing, the first (next) or last (prev). */
export function stepOf<T>(items: readonly T[], current: T | null, dir: 1 | -1): T | null {
  if (items.length === 0) return null;
  const i = current === null ? -1 : items.indexOf(current);
  if (i === -1) return items[dir === 1 ? 0 : items.length - 1]!;
  return items[(i + dir + items.length) % items.length]!;
}

/** The order the arrow keys walk the buildings in: left to right on the drawing, the buildings it does not place after them. */
export function keyOrder(buildings: readonly Pick<Building, 'slot'>[], drawn: readonly string[]): string[] {
  const known = new Set(buildings.map((b) => b.slot));
  const placed = drawn.filter((s) => known.has(s));
  return [...placed, ...buildings.map((b) => b.slot).filter((s) => !placed.includes(s))];
}

/** The building the plan opens on: the first one to take, else the first of the player's, else the first, in key order. */
export function defaultSlot(buildings: readonly Pick<Building, 'slot' | 'owner'>[], order: readonly string[]): string | null {
  const by = order.flatMap((slot) => buildings.filter((b) => b.slot === slot));
  return (by.find((b) => b.owner === 'available') ?? by.find((b) => b.owner === 'player') ?? by[0])?.slot ?? null;
}

/** The slot to show: the one asked for if the plan has it, else the default. */
export const keepSlot = (buildings: readonly Pick<Building, 'slot' | 'owner'>[], order: readonly string[], asked: string | null): string | null =>
  asked !== null && buildings.some((b) => b.slot === asked) ? asked : defaultSlot(buildings, order);

/** Chips for the kinds this plan has buildings of, `all` first, in the mockup's order. */
export const filtersOf = (buildings: readonly Pick<Building, 'kind'>[], hasStands: boolean): string[] => {
  const kinds = new Set<string>(buildings.map((b) => b.kind));
  if (hasStands) kinds.add('parking');
  return ['all', ...FILTERS.filter((k) => k !== 'all' && kinds.has(k))];
};

/** Does a building stay lit under the filter? The list view uses it; the chart dims by the same rule. */
export const matchesFilter = (kind: string, filter: string): boolean => filter === 'all' || kind === filter;

/** The effect sentence of a building (S3's `effect`, not its kind: an operations centre and offices are both offices). */
export function effectOf(f: Pick<FacilityView, 'effect' | 'kind'> | Pick<Building, 'effect' | 'kind'>): { key: Key; vars: Record<string, number> } {
  switch (f.effect) {
    case 'hangar': return { key: 'fc.effect.maintenance', vars: { pct: MAINTENANCE_DISCOUNT_PCT } };
    case 'desks': return { key: 'fc.effect.office', vars: {} };
    case 'ops': return { key: 'fc.effect.ops', vars: {} };
    case 'none': return { key: 'fc.effect.none', vars: {} };
  }
}

// ---------------------------------------------------------------- levels and the contract

export type LevelState = 'done' | 'pickable' | 'locked';

/**
 * Can the player pick this level? Before signing: the levels the contract may start at (the server says which opens later with `opensAfterDays`).
 * Once held: only the level right above the one in force, when the works are not running and the server's `nextLevelAt` has come.
 */
export function levelState(l: Pick<FacilityLevelInfo, 'level' | 'opensAfterDays'>, f: Pick<FacilityView, 'level' | 'works' | 'nextLevelAt' | 'owner'>, now: number): LevelState {
  if (f.owner !== 'player') return l.opensAfterDays === null ? 'pickable' : 'locked';
  if (l.level <= f.level) return 'done';
  return l.level === f.level + 1 && !f.works && f.nextLevelAt !== null && f.nextLevelAt <= now ? 'pickable' : 'locked';
}

/** The level `dir` steps from `level` among the pickable ones; stays put at the ends. */
export function stepLevel(levels: readonly FacilityLevelInfo[], states: ReadonlyMap<number, LevelState>, level: number, dir: 1 | -1): number {
  const ok = levels.map((l) => l.level).filter((n) => states.get(n) === 'pickable');
  const next = dir === 1 ? ok.find((n) => n > level) : [...ok].reverse().find((n) => n < level);
  return next ?? level;
}

/** The level the screen opens on: the lowest pickable one. */
export const firstLevel = (levels: readonly FacilityLevelInfo[], states: ReadonlyMap<number, LevelState>): number => levels.find((l) => states.get(l.level) === 'pickable')?.level ?? levels[0]?.level ?? 1;

/** The credit terms offered on a purchase: S3 lists a loan per down payment and term; the screen offers the cheapest down payment. */
export const creditLoans = (p: Pick<FacilityPurchase, 'loans' | 'creditPct'>): FacilityPurchase['loans'] => p.loans.filter((l) => l.downPct === 100 - p.creditPct);

export type StaffLine = { need: number; have: number; candidates: number; missing: number };
/** The technicians the previewed level needs (S3's `required`, else the level's own figure), with how many are on the roster and on the market. */
export function staffLine(d: Pick<FacilityDetail, 'required' | 'levels'>, level: number): StaffLine | null {
  const r = d.required[0];
  const need = r?.need ?? d.levels.find((l) => l.level === level)?.technicians ?? 0;
  if (need === 0) return null;
  const have = r?.have ?? 0;
  return { need, have, candidates: r?.candidates ?? 0, missing: Math.max(0, need - have) };
}

/** Whole months between two instants (UTC calendar, the day of the month counted). */
export function monthsBetween(from: number, now: number): number {
  const a = new Date(from), b = new Date(now);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0));
}

/** Months a lease still binds: 0 once the term is over (then it renews month by month and only the notice remains). */
export const leaseMonthsLeft = (startedAt: number, months: number, now: number): number => Math.max(0, months - monthsBetween(startedAt, now));

/** Months at the level below before a locked level opens (S3 gives days). */
export const opensAfterMonths = (days: number): number => Math.round(days / 30);
