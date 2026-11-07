import { loanOption, LOAN_QUOTE_MONTHS } from '@opc/shared';
import type { StaffFamily } from '@opc/shared';
import type { FacilityDetail, FacilityKind, FacilityRow, Financing, Hold, LevelInfo, PlanBuilding, PurchaseTerms, RequiredRole, StaffNeed } from './api-facilities.ts';
import type { IconName } from './icons.ts';
import type { Key } from './messages.ts';

/** Pure rules behind the FACILITIES screens: what a row says, what a contract costs, which building is next. The DOM lives in the screens. */

export const KIND_ICON: Record<FacilityKind, IconName> = { maintenance: 'wrench', terminal: 'door-open', cargo: 'package', office: 'building-2', parking: 'square-parking', airport: 'radio' };
export const KIND_KEY: Record<FacilityKind, Key> = {
  maintenance: 'fc.kind.maintenance', terminal: 'fc.kind.terminal', cargo: 'fc.kind.cargo', office: 'fc.kind.office', parking: 'fc.kind.parking', airport: 'fc.kind.airport',
};
/** The filter chips of the plan, in the mockup's order. */
export const FILTERS = ['all', 'maintenance', 'terminal', 'cargo', 'office', 'parking'] as const;

/** B.4: a rented facility has the same effects as a bought one, so the effect is a property of the kind. Mirrors S3's constants until `shared/src/facilities.ts` is merged. */
export const EFFECT = { maintenanceCostPct: 35, downtimeFactor: 0.5 } as const;

// ---------------------------------------------------------------- what a row says

export type Holding = 'leased' | 'owned' | 'available' | 'ai' | 'fee' | 'airport';

/** How the player stands with a building. A terminal of the airport that bills a passenger fee is `fee`. */
export function holdingOf(f: Pick<FacilityRow, 'owner' | 'hold' | 'kind' | 'monthly'>): Holding {
  switch (f.owner) {
    case 'player': return f.hold === 'purchase' ? 'owned' : 'leased';
    case 'available': return 'available';
    case 'ai': return 'ai';
    case 'airport': return f.kind === 'terminal' && f.monthly !== null ? 'fee' : 'airport';
  }
}

export type Tone = 'plain' | 'accent' | 'dim';
export const HOLDING_TONE: Record<Holding, Tone> = { leased: 'plain', owned: 'plain', available: 'accent', ai: 'dim', fee: 'plain', airport: 'dim' };
export const HOLDING_KEY: Record<Holding, Key> = {
  leased: 'fc.h.leased', owned: 'fc.h.owned', available: 'fc.h.available', ai: 'fc.h.ai', fee: 'fc.h.fee', airport: 'fc.h.airport',
};

const HOLDING_ORDER: Holding[] = ['leased', 'owned', 'fee', 'ai', 'available', 'airport'];
/** How many facilities a hub card lists before the rest of the available ones go to the "also available" line. */
export const SHOWN = 5;

/** The hub card's list: what the player holds, what bills a fee, what an AI company holds, then what is free to take. The airport's own buildings (tower, fuel depot) are on the plan only. `more` are the available ones that did not fit. */
export function shown(rows: readonly FacilityRow[], cap = SHOWN): { rows: FacilityRow[]; more: FacilityRow[] } {
  const all = rows.filter((f) => holdingOf(f) !== 'airport').sort((a, b) => HOLDING_ORDER.indexOf(holdingOf(a)) - HOLDING_ORDER.indexOf(holdingOf(b)));
  return { rows: all.slice(0, cap), more: all.slice(cap).filter((f) => f.owner === 'available') };
}

/** Parking is not a facility (B.4: `hubSpots` stays the source): what it costs is what the monthly parking charge bills, per aircraft in use. */
export const parkingCost = (used: number, feePerAircraft: number): number => used * feePerAircraft;
/** B.4's `monthlyCost` covers the buildings; the stands are added here (see "Implementation notes (F3)"). */
export const hubTotal = (buildings: number, parking: number): number => buildings + parking;

/** The team rows of a hub card, biggest family first, empty ones left out. */
export function teamRows(byFamily: Partial<Record<StaffFamily, number>>): { family: StaffFamily; n: number }[] {
  return (Object.entries(byFamily) as [StaffFamily, number][]).filter(([, n]) => n > 0).map(([family, n]) => ({ family, n })).sort((a, b) => b.n - a.n);
}

/** What the player's contracts at a hub are, in one word. */
export function contractsOf(rows: readonly Pick<FacilityRow, 'owner' | 'hold'>[]): 'none' | 'leased' | 'owned' | 'mixed' {
  const mine = rows.filter((f) => f.owner === 'player');
  if (mine.length === 0) return 'none';
  const buys = mine.filter((f) => f.hold === 'purchase').length;
  return buys === 0 ? 'leased' : buys === mine.length ? 'owned' : 'mixed';
}

/** The names of the AI companies that hold a building of the plan, once each. */
export const aiNames = (buildings: readonly Pick<PlanBuilding, 'owner' | 'ownerName'>[]): string[] => [...new Set(buildings.flatMap((b) => (b.owner === 'ai' && b.ownerName ? [b.ownerName] : [])))];

/** The item `dir` steps from `current`, wrapping around; from nothing, the first (next) or last (prev). */
export function stepOf<T>(items: readonly T[], current: T | null, dir: 1 | -1): T | null {
  if (items.length === 0) return null;
  const i = current === null ? -1 : items.indexOf(current);
  if (i === -1) return items[dir === 1 ? 0 : items.length - 1]!;
  return items[(i + dir + items.length) % items.length]!;
}

/** The order the arrow keys walk the buildings in: left to right on the drawing, the buildings it does not place after them. */
export function keyOrder(buildings: readonly Pick<PlanBuilding, 'slot'>[], drawn: readonly string[]): string[] {
  const known = new Set(buildings.map((b) => b.slot));
  const placed = drawn.filter((s) => known.has(s));
  return [...placed, ...buildings.map((b) => b.slot).filter((s) => !placed.includes(s))];
}

/** The building the plan opens on: the first one to take, else the first of the player's, else the first, in key order. */
export function defaultSlot(buildings: readonly Pick<PlanBuilding, 'slot' | 'owner'>[], order: readonly string[]): string | null {
  const by = order.flatMap((slot) => buildings.filter((b) => b.slot === slot));
  return (by.find((b) => b.owner === 'available') ?? by.find((b) => b.owner === 'player') ?? by[0])?.slot ?? null;
}

/** The slot to show: the one asked for if the plan has it, else the default. */
export const keepSlot = (buildings: readonly Pick<PlanBuilding, 'slot' | 'owner'>[], order: readonly string[], asked: string | null): string | null =>
  asked !== null && buildings.some((b) => b.slot === asked) ? asked : defaultSlot(buildings, order);

/** Chips for the kinds this plan has buildings of, `all` first, in the mockup's order. */
export const filtersOf = (buildings: readonly Pick<PlanBuilding, 'kind'>[], hasStands: boolean): string[] => {
  const kinds = new Set<string>(buildings.map((b) => b.kind));
  if (hasStands) kinds.add('parking');
  return ['all', ...FILTERS.filter((k) => k !== 'all' && kinds.has(k))];
};

/** Does a building stay lit under the filter? The list view uses it; the chart dims by the same rule. */
export const matchesFilter = (kind: string, filter: string): boolean => filter === 'all' || kind === filter;

/** The effect sentence of a kind of building. Maintenance has a number; the others are described. */
export function effectOf(kind: FacilityKind): { key: Key; vars: Record<string, number> } {
  switch (kind) {
    case 'maintenance': return { key: 'fc.effect.maintenance', vars: { pct: EFFECT.maintenanceCostPct } };
    case 'terminal': return { key: 'fc.effect.terminal', vars: {} };
    case 'cargo': return { key: 'fc.effect.cargo', vars: {} };
    case 'office': return { key: 'fc.effect.office', vars: {} };
    case 'parking': case 'airport': return { key: 'fc.effect.none', vars: {} };
  }
}

// ---------------------------------------------------------------- the contract

/** The loan terms offered on a building: the share the bank does not lend is paid up front, the term is one of the quoted ones. */
export const CREDIT_MONTHS = LOAN_QUOTE_MONTHS;
export const creditOf = (p: Pick<PurchaseTerms, 'creditPct'>, months: number): Financing => ({ downPct: 100 - p.creditPct, months });

export type Quote = {
  /** Cash leaving the account at signing. */
  today: number;
  /** Cash leaving the account every month after. */
  monthly: number;
  balanceAfter: number;
  affordable: boolean;
  shortfall: number;
  /** The pieces of `today` and `monthly`, for the line under each figure. */
  parts: { works: number; deposit: number; down: number; rent: number; upkeep: number; instalment: number; salaries: number };
};

const levelAt = (levels: readonly LevelInfo[], level: number): LevelInfo | undefined => levels.find((l) => l.level === level);

/**
 * What signing costs, for one way of holding (rent or buy), one level and, when buying, one credit. Follows the mockup: the deposit (rent) or the price (buy, less the credit) plus the works of the level are due at signing;
 * every month after, the rent (or the upkeep and the instalments) plus the salaries of the people the level needs. Works are charged for levels above the one the facility stands at.
 * The server answers the real figures when the player signs; this is the quote read before it.
 */
export function quote(d: Pick<FacilityDetail, 'offer' | 'levels'> & { facility: Pick<FacilityRow, 'level'> }, hold: Hold, level: number, credit: Financing | null, balance: number): Quote | null {
  if (!d.offer) return null;
  const info = levelAt(d.levels, level);
  const works = level > d.facility.level ? (info?.works?.cost ?? 0) : 0;
  const salaries = info?.salaries ?? 0;
  let deposit = 0, down = 0, rent = 0, upkeep = 0, instalment = 0;
  if (hold === 'lease') {
    deposit = d.offer.lease.deposit;
    rent = d.offer.lease.monthly;
  } else {
    const p = d.offer.purchase;
    upkeep = p.upkeep;
    if (credit) {
      const loan = loanOption(p.price, 0, credit.downPct, credit.months);
      down = loan.down;
      instalment = loan.monthly;
    } else down = p.price;
  }
  const today = deposit + down + works;
  const monthly = rent + upkeep + instalment + salaries;
  const balanceAfter = balance - today;
  return { today, monthly, balanceAfter, affordable: balanceAfter >= 0, shortfall: Math.max(0, -balanceAfter), parts: { works, deposit, down, rent, upkeep, instalment, salaries } };
}

/** Total paid over the lease, shown under the rent. */
export const leaseTotal = (lease: { monthly: number; months: number }): number => lease.monthly * lease.months;

/** Can the player pick this level? A locked level is shown but not offered; the one the facility has is not an upgrade. */
export const pickable = (l: LevelInfo, current: number, held: boolean): boolean => l.locked === null && (held ? l.level > current : true);

/** The level `dir` steps from `level` among the pickable ones; stays put at the ends. */
export function stepLevel(levels: readonly LevelInfo[], level: number, dir: 1 | -1, current: number, held: boolean): number {
  const ok = levels.filter((l) => pickable(l, current, held)).map((l) => l.level);
  const next = dir === 1 ? ok.find((n) => n > level) : [...ok].reverse().find((n) => n < level);
  return next ?? level;
}

export type StaffLine = { need: StaffNeed; have: number; candidates: number | null; missing: number };
/** One line per kind of person the level needs: how many are on the roster, how many candidates the market has. `candidates` is null when the server does not say. */
export function staffLines(level: LevelInfo | undefined, required: readonly RequiredRole[]): StaffLine[] {
  return (level?.staff ?? []).map((need) => {
    const r = required.find((x) => x.family === need.family && x.role === need.role);
    const have = r?.have ?? 0;
    return { need, have, candidates: r ? r.candidates : null, missing: Math.max(0, need.need - have) };
  });
}

export const totalMissing = (lines: readonly StaffLine[]): number => lines.reduce((n, l) => n + l.missing, 0);

/** Whole months between two instants (UTC calendar, the day of the month counted). */
export function monthsBetween(from: number, now: number): number {
  const a = new Date(from), b = new Date(now);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0));
}

/** Months a lease still binds: 0 once the term is over (then only the notice remains). */
export const leaseMonthsLeft = (startedAt: number, months: number, now: number): number => Math.max(0, months - monthsBetween(startedAt, now));
