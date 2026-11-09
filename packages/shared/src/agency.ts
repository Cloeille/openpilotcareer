// Lot AGENCY (v4): the recruiter mission (docs/v4-plan.md A.4, B.3, B.8). Pure rules, constants, request schemas and wire types.
// A mission is a hire made through an agency, for any family (pilots, cabin crew, cooks, mechanics, ground and office roles): the shortlist is ready after AGENCY_SEARCH_DAYS, the people signed are
// normal staff rows paid the company's grid (they start after their notice, like any hire), and the only price is the commission, paid once at the signature.
// Imports only from lines.ts and staff.ts (which imports nothing of this lot), so there is no runtime cycle.
import { z } from 'zod';
import { DAY_MS } from './lines.ts';
import { HIRED_ROLES, STAFF_FAMILIES, STAFF_ROLES, type Candidate, type StaffFamily, type StaffMember, type StaffRole } from './staff.ts';

/** The commission is this many months of the person's salary, paid once at the signature. The agency's people are paid the company's grid: there is no surcharge. */
export const AGENCY_COMMISSION_MONTHS = 1;
/** Days before the shortlist is ready, then the notice of the people signed (the line check). [Tuned: the plan's mockup says 4 + 4, but the market's own notice is 7 days (DEFAULT_NOTICE_DAYS),
 *  so an agency that takes 8 would be slower than hiring for free; 2 + 2 keeps it a trade of money for days.] */
export const AGENCY_SEARCH_DAYS = 2;
export const AGENCY_NOTICE_DAYS = 2;
/** Most people one mission can ask for, and the extra candidate the shortlist shows beyond what was asked (the mockup lists 3 for 2). */
export const AGENCY_MAX_COUNT = 20;
export const AGENCY_SPARE = 1;

/** Paid once, at the signature, for one person paid `monthlySalary`. */
export const agencyCommission = (monthlySalary: number): number => Math.round(monthlySalary * AGENCY_COMMISSION_MONTHS);

/** What signing `picked` costs: `commission` now (the balance after it is `balanceAfter`, negative when the company cannot pay). A candidate's `askingSalary` is the company's grid and its `premium` the commission for this person
 *  (what a market candidate's `premium` is for a market hire: the fee paid when he is signed). */
export type AgencyQuote = { picked: string[]; commission: number; balanceAfter: number };
export const quoteOf = (picked: readonly Candidate[], balance: number): AgencyQuote => {
  const commission = picked.reduce((t, c) => t + c.premium, 0);
  return { picked: picked.map((c) => c.id), commission, balanceAfter: balance - commission };
};

/** A post an agency can fill: a family, one of its hired roles, a base, and the type rating of a pilot (null for every other family). */
export type AgencyPost = { family: StaffFamily; role: StaffRole; base: string; qual: string | null };
/** A mission's ask: `count` people for a post. */
export type AgencyRequest = AgencyPost & { count: number };
/** The mission to propose for a gap: every post that no hire in notice fills, up to what one mission can ask. A pilot gap does not say captain or first officer: the first role of the family (the captain) is proposed. */
export const requestForGap = (g: Pick<AgencyGap, 'family' | 'base' | 'qual' | 'open'>): AgencyRequest => ({ family: g.family, role: HIRED_ROLES[g.family][0]!, base: g.base, qual: g.qual, count: Math.min(g.open, AGENCY_MAX_COUNT) });

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
  /** The type rating course for the type (TRAINING_COURSE; null for a family without type ratings, which has no training route) and how many of the company's pilots at the base could take it. */
  course: { days: number; cost: number } | null; trainable: number;
  /** Hiring premiums of the cheapest candidates on the market for the position, the notice of a market hire. */
  market: readonly number[]; marketNotice: number;
};

/** The ways to fill `count` positions (training only for pilots), priced from the rules that already exist (the course, the market) and the agency's own. Pure. */
export function optionsOf(i: OptionInputs): AgencyOption[] {
  const option = (id: AgencyOptionId, phases: [number, number], fees: number, available: boolean): AgencyOption => {
    const days = phases[0] + phases[1], stopped = days * i.perDay;
    return { id, phases, days, resumeAt: i.now + days * DAY_MS, fees, stopped, total: fees + stopped, available };
  };
  return [
    option('agency', [i.searchDays, AGENCY_NOTICE_DAYS], i.agency.commission, i.agency.picked.length >= i.count),
    ...(i.course ? [option('train', [i.course.days, 0], i.count * i.course.cost, i.trainable >= i.count)] : []),
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

/** The shape of a post. Whether it exists (a role of the family, a rating for a pilot only, a base and a type the company has) is `assertPosition` of the server: one guard, in the domain. */
const postShape = { family: z.enum(STAFF_FAMILIES), role: z.enum(STAFF_ROLES), base: airportCode, qual: typeCode.nullish().transform((q) => q ?? null) };

/** Either all of family, role, base and count (qual with them for a pilot), or none (the server then takes the position that costs the most). `pick`: candidate ids, comma-separated, to price instead of the first ones. */
export const agencyQuerySchema = z.object({ ...postShape, count: z.coerce.number().int().min(1).max(AGENCY_MAX_COUNT), pick: z.string().max(AGENCY_MAX_COUNT * 64) }).partial()
  .refine((q) => [q.family, q.role, q.base, q.count].every((x) => x === undefined) || [q.family, q.role, q.base, q.count].every((x) => x !== undefined), { message: 'family, role, base and count go together', path: ['base'] });
export const missionBodySchema = z.object({ ...postShape, count: countOf });
export const signBodySchema = z.object({ candidateIds: z.array(z.string().min(1).max(60)).min(1).max(AGENCY_MAX_COUNT) })
  .refine((b) => new Set(b.candidateIds).size === b.candidateIds.length, { message: 'candidateIds: the same candidate twice', path: ['candidateIds'] });

// ---------------------------------------------------------------- wire types

/** People a base lacks for a post of the timetable: `have` those working there now (rated on the type, for pilots), `need` the posts its timetable keeps busy (duty limits and rest included), `open` the posts no hire in notice fills,
 *  `perDay` the revenue its lines lose each day (pilots and cabin crew only: the other families stop no line): what they earn, in proportion to the share of `need` that nobody works. */
export type AgencyGap = { family: StaffFamily; base: string; qual: string | null; have: number; need: number; open: number; perDay: number; lines: { id: number; a: string; b: string }[] };
/** An open mission. The shortlist and the quote are hidden (`null`) until `readyAt`; the quote prices `quote.picked`: the first `count` candidates unless the caller asked for others. */
export type MissionView = AgencyRequest & { id: number; startedAt: number; readyAt: number; ready: boolean; shortlist: Candidate[] | null; quote: AgencyQuote | null };
export type AgencyView = {
  /** Every post that lacks people now (all families), the most costly first. */
  gaps: AgencyGap[];
  /** What the options below are for: the one asked, else the open mission's, else the first gap; null when nothing is asked and nothing is short. */
  request: AgencyRequest | null;
  /** Revenue lost per day while the requested position stays empty. */
  perDay: number;
  options: AgencyOption[];
  savings: ReturnType<typeof agencySavings>;
  /** The open mission for the requested post. */
  mission: MissionView | null;
};
export type SignResult = { members: StaffMember[]; commission: number; balanceAfter: number };
