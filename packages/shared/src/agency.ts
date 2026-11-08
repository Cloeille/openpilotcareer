// Lot AGENCY (v4): the recruiter mission (docs/v4-plan.md A.4, B.3, B.8). Pure rules, constants, request schemas and wire types.
// A mission is a hire made through an agency: the shortlist is ready after AGENCY_SEARCH_DAYS, the people signed are normal staff rows (they start after their notice, like any hire),
// and the fee is paid at the signature. Imports only from lines.ts and (types) staff.ts, so there is no runtime cycle.
import { z } from 'zod';
import { DAY_MS } from './lines.ts';
import type { Candidate, StaffMember } from './staff.ts';

/** B.8: the commission is 20 % of the annual salary of the people signed; the agency's people ask 11 % above the company's grid. */
export const AGENCY_COMMISSION_PCT = 20;
export const AGENCY_PREMIUM_PCT = 11;
/** Days before the shortlist is ready, then the notice of the people signed (the line check). [Tuned: the plan's mockup says 4 + 4, but the market's own notice is 7 days (DEFAULT_NOTICE_DAYS),
 *  so an agency that takes 8 would be slower than hiring for free; 2 + 2 keeps it a trade of money for days.] */
export const AGENCY_SEARCH_DAYS = 2;
export const AGENCY_NOTICE_DAYS = 2;
/** Most people one mission can ask for, and the extra candidate the shortlist shows beyond what was asked (the mockup lists 3 for 2). */
export const AGENCY_MAX_COUNT = 6;
export const AGENCY_SPARE = 1;
/** The comparison is over a year: the agency's salary premium counts for this many months. */
export const AGENCY_COMPARE_MONTHS = 12;

/** The agency's price for a grid salary, rounded to 50 euros like every salary. */
export const agencySalary = (grid: number, pct: number): number => Math.round((grid * (100 + pct)) / 100 / 50) * 50;
/** Paid once, at the signature, for one person asking `monthlySalary`. */
export const agencyCommission = (monthlySalary: number): number => Math.round((monthlySalary * 12 * AGENCY_COMMISSION_PCT) / 100);

/** `askingSalary` is the agency's price and `premium` its commission for this person (what a market candidate's `premium` is for a market hire: the fee paid when he is signed). */
export type AgencyCandidate = Candidate & {
  /** What the company's own grid pays for the same person. */
  grid: number;
};

/** What signing `picked` costs: `commission` now (the balance after it is `balanceAfter`, negative when the company cannot pay), `surchargeMonthly` more on the payroll every month than the grid would have. */
export type AgencyQuote = { picked: string[]; commission: number; surchargeMonthly: number; balanceAfter: number };
export const quoteOf = (picked: readonly AgencyCandidate[], balance: number): AgencyQuote => {
  const commission = picked.reduce((t, c) => t + c.premium, 0);
  return { picked: picked.map((c) => c.id), commission, surchargeMonthly: picked.reduce((t, c) => t + c.askingSalary - c.grid, 0), balanceAfter: balance - commission };
};

export type AgencyOptionId = 'agency' | 'train' | 'classic';
/** One way to get the people. `phases`: days of each of its two steps (agency: search then notice; train: the course, then nothing; classic: nothing, then the market's notice).
 *  Euros over a year: `fees` what the route costs, `stopped` what the stopped lines lose while it lasts, `total` both. `available` is false when the route cannot be taken. */
export type AgencyOption = { id: AgencyOptionId; phases: [number, number]; days: number; resumeAt: number; fees: number; stopped: number; total: number; available: boolean };

export type OptionInputs = {
  count: number;
  /** Days left before the shortlist is ready: AGENCY_SEARCH_DAYS before the mission starts, fewer while it runs. */
  searchDays: number;
  /** Revenue the stopped lines lose each day (lot LINES: `problem.cost.perDay`). */
  perDay: number; now: number;
  /** The quote for the first `count` people of today's shortlist. */
  agency: AgencyQuote;
  /** The type rating course for the type (TRAINING_COURSE) and how many of the company's pilots at the base could take it. */
  course: { days: number; cost: number }; trainable: number;
  /** Hiring premiums of the cheapest candidates on the market for the position, the notice of a market hire. */
  market: readonly number[]; marketNotice: number;
};

/** The three ways to fill `count` positions, priced from the rules that already exist (the course, the market) and the agency's own. Pure. */
export function optionsOf(i: OptionInputs): AgencyOption[] {
  const option = (id: AgencyOptionId, phases: [number, number], fees: number, available: boolean): AgencyOption => {
    const days = phases[0] + phases[1], stopped = days * i.perDay;
    return { id, phases, days, resumeAt: i.now + days * DAY_MS, fees, stopped, total: fees + stopped, available };
  };
  return [
    option('agency', [i.searchDays, AGENCY_NOTICE_DAYS], i.agency.commission + AGENCY_COMPARE_MONTHS * i.agency.surchargeMonthly, i.agency.picked.length >= i.count),
    option('train', [i.course.days, 0], i.count * i.course.cost, i.trainable >= i.count),
    option('classic', [0, i.marketNotice], i.market.slice(0, i.count).reduce((t, p) => t + p, 0), i.market.length >= i.count),
  ];
}

/** What the agency saves against the cheapest other route that can be taken (the mockup's footer compares with training); null when it saves no money. */
export function agencySavings(options: readonly AgencyOption[]): { against: Exclude<AgencyOptionId, 'agency'>; days: number; amount: number } | null {
  const agency = options.find((o) => o.id === 'agency');
  const other = options.flatMap((o) => (o.id !== 'agency' && o.available ? [{ ...o, id: o.id }] : [])).sort((p, q) => p.total - q.total)[0];
  return agency && other && other.total > agency.total ? { against: other.id, days: other.days - agency.days, amount: other.total - agency.total } : null;
}

// ---------------------------------------------------------------- request schemas

const airportCode = z.string().regex(/^[A-Z]{4}$/, 'ICAO airport code: 4 letters A-Z');
const typeCode = z.string().regex(/^[A-Z0-9]{2,4}$/, 'ICAO type designator: 2-4 chars A-Z/0-9');
const countOf = z.int().min(1).max(AGENCY_MAX_COUNT);

/** Either all of base, qual and count, or none (the server then takes the position that costs the most). `pick`: candidate ids, comma-separated, to price instead of the first ones. */
export const agencyQuerySchema = z.object({ base: airportCode.optional(), qual: typeCode.optional(), count: z.coerce.number().int().min(1).max(AGENCY_MAX_COUNT).optional(), pick: z.string().max(AGENCY_MAX_COUNT * 64).optional() })
  .refine((q) => [q.base, q.qual, q.count].every((x) => x === undefined) || [q.base, q.qual, q.count].every((x) => x !== undefined), { message: 'base, qual and count go together', path: ['base'] });
export const missionBodySchema = z.object({ base: airportCode, qual: typeCode, count: countOf });
export const signBodySchema = z.object({ candidateIds: z.array(z.string().min(1).max(60)).min(1).max(AGENCY_MAX_COUNT) })
  .refine((b) => new Set(b.candidateIds).size === b.candidateIds.length, { message: 'candidateIds: the same candidate twice', path: ['candidateIds'] });

// ---------------------------------------------------------------- wire types

/** Pilots a base lacks for a type: `have` the pilots rated and working there now, `need` the posts its timetable keeps busy (duty limits and rest included), `open` the posts no hire in notice fills,
 *  `perDay` the revenue its lines lose each day: what they earn, in proportion to the share of `need` that nobody works. */
export type AgencyGap = { base: string; qual: string; have: number; need: number; open: number; perDay: number; lines: { id: number; a: string; b: string }[] };
/** An open mission. The shortlist and the quote are hidden (`null`) until `readyAt`; the quote prices `quote.picked`: the first `count` candidates unless the caller asked for others. */
export type MissionView = {
  id: number; base: string; qual: string; count: number; startedAt: number; readyAt: number; ready: boolean; premiumPct: number;
  shortlist: AgencyCandidate[] | null; quote: AgencyQuote | null;
};
export type AgencyView = {
  /** The positions that lack pilots now, the most costly first. */
  gaps: AgencyGap[];
  /** What the options below are for: the one asked, else the first gap; null when nothing is asked and nothing is short. */
  request: { base: string; qual: string; count: number } | null;
  /** Revenue lost per day while the requested position stays empty. */
  perDay: number;
  /** Cabin crew posts nobody works or is coming for. The agency only searches pilots: this is what the screen sends to the market when no pilot is missing. */
  cabinOpen: number;
  commissionPct: number; premiumPct: number;
  options: AgencyOption[];
  savings: ReturnType<typeof agencySavings>;
  /** The open mission for the requested base and type. */
  mission: MissionView | null;
};
export type SignResult = { members: StaffMember[]; commission: number; surchargeMonthly: number; balanceAfter: number };
