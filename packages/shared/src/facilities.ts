// Lot FACILITIES (v3): buildings at hubs. The catalogue of slots per airport, the terms of renting or buying one, its levels and effects, the monthly plan
// (rent, upkeep, instalments, income) and the wire types (docs/v3-plan.md B.4). Pure rules: runtime-imports only sibling leaf files (never ./index.ts), so no module cycle.
import { z } from 'zod';
import {
  LOAN_DOWN_PCT_MAX, LOAN_DOWN_PCT_MIN, LOAN_MONTHS_MAX, LOAN_MONTHS_MIN, LOAN_QUOTE_DOWN_PCTS, LOAN_QUOTE_MONTHS, PARKING_FEE_BY_SIZE, financingSchema, loanOption, loanStep,
  type Financing, type LoanOption,
} from './finance.ts';
import type { AirportSize } from './index.ts';
import { DAY_MS } from './lines.ts';
import type { StaffFamily } from './staff.ts';

// ---------------------------------------------------------------- catalogue

export const FACILITY_KINDS = ['maintenance', 'terminal', 'cargo', 'office', 'airport'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];
/** What a building does for the company that holds it. Only a building with an effect is ever offered: `none` stays with the airport or an AI company. */
export const FACILITY_EFFECTS = ['hangar', 'desks', 'ops', 'none'] as const;
export type FacilityEffect = (typeof FACILITY_EFFECTS)[number];
/** Who holds a building before any company signs: the airport (never for sale), a fixed AI company (decision C6: seeded, no take-over at runtime), or nobody. */
export type SeedOwner = 'airport' | 'ai' | 'available';
export type SlotSeed = { slot: string; name: string; kind: FacilityKind; effect: FacilityEffect; areaM2: number; rent: number; owner: SeedOwner; holder: string | null };

/** Airports whose 3D plan is drawn client-side (`airport-chart.js`). Every other airport answers `layout: null`: the client shows the list. */
export const DRAWN_LAYOUTS = ['LFMN'] as const;
export type LayoutKey = (typeof DRAWN_LAYOUTS)[number];
export const PLAN_FILTERS = ['maintenance', 'terminal', 'cargo', 'office', 'parking'] as const;

const offered = (slot: string, name: string, kind: FacilityKind, effect: FacilityEffect, areaM2: number, rent: number): SlotSeed => ({ slot, name, kind, effect, areaM2, rent, owner: 'available', holder: null });
const kept = (slot: string, name: string, kind: FacilityKind, areaM2: number): SlotSeed => ({ slot, name, kind, effect: 'none', areaM2, rent: 0, owner: 'airport', holder: null });
const heldByAi = (slot: string, name: string, kind: FacilityKind, areaM2: number, holder: string): SlotSeed => ({ slot, name, kind, effect: 'none', areaM2, rent: 0, owner: 'ai', holder });

/** The ten buildings of the mockup's Nice plan. Rents anchor the mockup (hangar 18 500, offices 6 200: B.8); the operations centre's 9 800 has no source there.
 *  Terminals, tower and fuel depot stay with the airport, the freight hall with the AI company that holds it in the mockup. Nothing models a terminal's passenger revenue
 *  or a cargo hall yet, so nobody can rent one: a building with no effect would be a money sink with nothing in return. */
const LFMN: readonly SlotSeed[] = [
  kept('T1', 'Terminal 1', 'terminal', 9_300),
  kept('T2', 'Terminal 2', 'terminal', 11_200),
  kept('VIP', 'Business aviation terminal', 'terminal', 2_000),
  offered('MX1', 'Maintenance hangar 1', 'maintenance', 'hangar', 4_400, 18_500),
  offered('MX2', 'Maintenance hangar 2', 'maintenance', 'hangar', 4_200, 18_500),
  heldByAi('CG1', 'Freight and storage', 'cargo', 3_200, 'Méridia Cargo'),
  offered('AD', 'Administrative offices', 'office', 'desks', 1_600, 6_200),
  offered('OPS', 'Operations centre', 'office', 'ops', 1_100, 9_800),
  kept('TWR', 'Control tower', 'airport', 100),
  kept('FUEL', 'Fuel depot', 'airport', 1_300),
];

const roundTo = (n: number, step: number): number => Math.round(n / step) * step;
/** An airport without a drawn plan: the same buildings, rents scaled by the size of the airport like the parking fee. A small one has no operations centre and one hangar. */
const scaled = (rent: number, size: AirportSize): number => Math.max(50, roundTo((rent * PARKING_FEE_BY_SIZE[size]) / PARKING_FEE_BY_SIZE.large, 50));

function generic(size: AirportSize): SlotSeed[] {
  const s: SlotSeed[] = [
    kept('T1', 'Terminal', 'terminal', 3_000),
    offered('MX1', 'Maintenance hangar 1', 'maintenance', 'hangar', 4_400, scaled(18_500, size)),
    offered('AD', 'Administrative offices', 'office', 'desks', 1_600, scaled(6_200, size)),
  ];
  if (size !== 'small') s.push(offered('OPS', 'Operations centre', 'office', 'ops', 1_100, scaled(9_800, size)));
  if (size === 'large') s.push(offered('MX2', 'Maintenance hangar 2', 'maintenance', 'hangar', 4_200, scaled(18_500, size)), kept('TWR', 'Control tower', 'airport', 100));
  return s;
}

export const slotsFor = (icao: string, size: AirportSize): readonly SlotSeed[] => (icao === 'LFMN' ? LFMN : generic(size));
export const layoutOf = (icao: string): LayoutKey | null => ((DRAWN_LAYOUTS as readonly string[]).includes(icao) ? (icao as LayoutKey) : null);

// ---------------------------------------------------------------- terms: rent or buy (B.4, B.8, C9)

export const LEASE_MONTHS = 36;
export const LEASE_NOTICE_MONTHS = 3;
export const FACILITY_DEPOSIT_RENTS = 2;
/** Buying costs 127 months of rent (B.8); an owned building costs 13 % of a month's rent a month to keep (2 400 on the mockup's hangar); it resells at 75 %. */
export const PURCHASE_RENT_MONTHS = 127;
export const UPKEEP_RENT_SHARE = 0.13;
export const FACILITY_RESALE_FACTOR = 0.75;
export const CREDIT_PCT = 100 - LOAN_DOWN_PCT_MIN;

export const purchasePrice = (rent: number): number => roundTo(rent * PURCHASE_RENT_MONTHS, 5_000);
export const upkeepOf = (rent: number): number => roundTo(rent * UPKEEP_RENT_SHARE, 50);
export const resaleValue = (price: number): number => Math.round(price * FACILITY_RESALE_FACTOR);

export type FacilityLease = { monthly: number; months: number; deposit: number; noticeMonths: number; totalOverTerm: number };
export type FacilityPurchase = { price: number; rentMonths: number; upkeep: number; resalePct: number; resale: number; creditPct: number; loans: LoanOption[] };
export const leaseTerms = (rent: number): FacilityLease => ({ monthly: rent, months: LEASE_MONTHS, deposit: FACILITY_DEPOSIT_RENTS * rent, noticeMonths: LEASE_NOTICE_MONTHS, totalOverTerm: rent * LEASE_MONTHS });
export const purchaseTerms = (rent: number): FacilityPurchase => {
  const price = purchasePrice(rent);
  return {
    price, rentMonths: PURCHASE_RENT_MONTHS, upkeep: upkeepOf(rent), resalePct: Math.round(FACILITY_RESALE_FACTOR * 100), resale: resaleValue(price), creditPct: CREDIT_PCT,
    loans: LOAN_QUOTE_DOWN_PCTS.flatMap((d) => LOAN_QUOTE_MONTHS.map((m) => loanOption(price, 0, d, m))),
  };
};

export type FacilityContractKind = 'lease' | 'purchase';
/** Ending a lease pays the rent of the notice, or of the rest of the 36 months when that is longer (the rent is owed; the deposit comes back).
 *  Selling a purchased building settles the credit left and pays the resale value. */
export const leaseExitFee = (rent: number, months: number, monthsPaid: number, noticeMonths: number): number => rent * Math.max(noticeMonths, months - monthsPaid);
/** What signing costs and what the building costs a month afterwards, for one choice. The preview and the booking both read this, so they cannot disagree. */
export type FacilitySigning = {
  /** Cash leaving the account at signing: deposit or down payment, plus the works of the starting level. */
  today: number; deposit: number; price: number; down: number; works: number;
  /** Loan taken for a purchase (zero for cash, and for a lease). */
  principal: number; instalment: number; months: number | null; upkeep: number;
  /** Rent, or upkeep and instalment: what the building costs every month from the next one. */
  monthly: number;
};
export function signing(rent: number, kind: FacilityContractKind, level: number, financing?: Financing): FacilitySigning {
  const works = facilityLevelCost(rent, level);
  if (kind === 'lease') {
    const deposit = FACILITY_DEPOSIT_RENTS * rent;
    return { today: deposit + works, deposit, price: 0, down: 0, works, principal: 0, instalment: 0, months: LEASE_MONTHS, upkeep: 0, monthly: rent };
  }
  const price = purchasePrice(rent);
  const loan = financing ? loanOption(price, 0, financing.downPct, financing.months) : null;
  const down = loan ? loan.down : price;
  const upkeep = upkeepOf(rent);
  return { today: down + works, deposit: 0, price, down, works, principal: price - down, instalment: loan?.monthly ?? 0, months: loan?.months ?? null, upkeep, monthly: upkeep + (loan?.monthly ?? 0) };
}

// ---------------------------------------------------------------- levels and effects

export const FACILITY_MAX_LEVEL: Record<FacilityEffect, number> = { hangar: 3, desks: 3, ops: 1, none: 1 };
/** A contract can start with the works to level 2; level 3 needs 6 months at level 2 (the mockup: "Après 6 mois au niveau 2"). During works the building keeps the level below. */
export const MAX_LEVEL_AT_SIGNING = 2;
export const LEVEL3_AFTER_DAYS = 180;
/** Works cost a multiple of the monthly rent (the mockup: 420 000 and 1 150 000 for a hangar at 18 500) and take 3 and 8 weeks. */
const LEVEL_COST_RENTS: Record<number, number> = { 2: 22.7, 3: 62.2 };
export const LEVEL_WORKS_DAYS: Record<number, number> = { 2: 21, 3: 56 };
export const facilityLevelCost = (rent: number, level: number): number => (level <= 1 ? 0 : roundTo(rent * (LEVEL_COST_RENTS[level] ?? 0), 5_000));

/** Hangar, by level: aircraft housed (each is one more parking spot at the hub), technicians needed. Level 3 takes wide-bodies and sells its capacity to the AI companies. */
export const HANGAR_AIRCRAFT = [2, 3, 4] as const;
export const HANGAR_TECHNICIANS = [6, 10, 16] as const;
export const HANGAR_WIDEBODY_LEVEL = 3;
export const HANGAR_SELLS_LEVEL = 3;
/** B.4: aircraft based at the hub are maintained in-house: 35 % cheaper, and a workshop visit lasts half as long. A hangar short of technicians gives half of that. */
export const HANGAR_MAINTENANCE_DISCOUNT = 0.35;
export const HANGAR_DOWNTIME_FACTOR = 0.5;
export const UNDERSTAFFED_SHARE = 0.5;
/** Level 3 sells maintenance to the AI companies: 40 % of (rent + the technicians' payroll) a month (no source in the mockup, B.8). */
export const MAINTENANCE_SALE_SHARE = 0.4;
/** Offices: workstations for the ground agents and administrators of a base. The airport's shared counters give every base a few before any office. */
export const DESK_FAMILIES: readonly StaffFamily[] = ['ground', 'admin'];
export const DESKS_FREE = 6;
export const DESKS_BY_LEVEL = [18, 36, 54] as const;
/** C5: lines are free up to MAX_LINES_PER_COMPANY (lines.ts); an operations centre lifts the limit to this. */
export const MAX_LINES_WITH_OPS = 24;

const byLevel = <T>(table: readonly T[], level: number): T => table[Math.min(Math.max(level, 1), table.length) - 1]!;
export const techniciansFor = (level: number): number => byLevel(HANGAR_TECHNICIANS, level);
export const hangarAircraft = (level: number): number => byLevel(HANGAR_AIRCRAFT, level);
export const desksFor = (level: number): number => byLevel(DESKS_BY_LEVEL, level);

export type HangarEffect = { discount: number; downtimeFactor: number; understaffed: boolean };
/** The effect of the hangars a company holds at one hub (their levels in force), given the technicians it employs there. They are staffed as a pool: short of the sum, every hangar gives half.
 *  A wide-body is only serviced by a level-3 hangar. null: no hangar that can take the aircraft. */
export function hangarEffect(levels: readonly number[], technicians: number, widebody: boolean): HangarEffect | null {
  if (levels.length === 0 || (widebody && !levels.some((l) => l >= HANGAR_WIDEBODY_LEVEL))) return null;
  const understaffed = technicians < levels.reduce((t, l) => t + techniciansFor(l), 0);
  const share = understaffed ? UNDERSTAFFED_SHARE : 1;
  return { discount: HANGAR_MAINTENANCE_DISCOUNT * share, downtimeFactor: 1 - (1 - HANGAR_DOWNTIME_FACTOR) * share, understaffed };
}
/** Monthly income of a staffed level-3 hangar. */
export const maintenanceSale = (rent: number, technicianPayroll: number): number => Math.round(MAINTENANCE_SALE_SHARE * (rent + technicianPayroll));

export type FacilityLevelInfo = {
  level: number; cost: number; worksDays: number;
  /** Days at the level below before the works may start (level 3). */
  opensAfterDays: number | null;
  /** Hangar: technicians needed, aircraft housed (parking spots), wide-bodies, sells maintenance. Offices: desks. Zero or false when not applicable. */
  technicians: number; aircraft: number; widebody: boolean; sellsMaintenance: boolean; desks: number;
};
export const facilityLevels = (effect: FacilityEffect, rent: number): FacilityLevelInfo[] =>
  Array.from({ length: FACILITY_MAX_LEVEL[effect] }, (_, i) => {
    const level = i + 1, hangar = effect === 'hangar';
    return {
      level, cost: facilityLevelCost(rent, level), worksDays: LEVEL_WORKS_DAYS[level] ?? 0, opensAfterDays: level === 3 ? LEVEL3_AFTER_DAYS : null,
      technicians: hangar ? techniciansFor(level) : 0, aircraft: hangar ? hangarAircraft(level) : 0, widebody: hangar && level >= HANGAR_WIDEBODY_LEVEL,
      sellsMaintenance: hangar && level >= HANGAR_SELLS_LEVEL, desks: effect === 'desks' ? desksFor(level) : 0,
    };
  });
/** The first instant a building that reached `level` at `levelSince` can start the works to the next one (level 3 needs LEVEL3_AFTER_DAYS at level 2). */
export const nextLevelAt = (level: number, levelSince: number): number => (level + 1 === 3 ? levelSince + LEVEL3_AFTER_DAYS * DAY_MS : levelSince);

// ---------------------------------------------------------------- the monthly plan (rent, upkeep, instalments, income)

export type FacilityCharge = { kind: string; amount: number; memo: string };
/** One active contract as billing sees it. `income` is this month's sale of maintenance (0 unless a staffed level-3 hangar). A lease uses `monthly` for the rent; a purchase for the loan instalment. */
export type PlanFacility = {
  id: number; label: string; kind: FacilityContractKind; started_at: number; months: number | null; months_paid: number; monthly: number; upkeep: number; principal: number; income: number;
};

/** First instant after a lease's initial term: the month of signing is free (signing costs the deposit and the works, never a rent), then `months` rents are billed. */
export const leaseTermEnd = (startedAt: number, months: number): number => {
  const d = new Date(startedAt);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 1);
};

/** What the month starting at `start` costs for the buildings. Whatever was signed before `start` is billed; what was signed this month starts paying on the 1st after it
 *  (never retroactive). A lease runs on after its term (it renews) until terminated. Returns the new states without touching the input, like `planMonth`. */
export function planFacilityMonth(start: number, rows: readonly PlanFacility[]): { charges: FacilityCharge[]; rows: PlanFacility[] } {
  const charges: FacilityCharge[] = [];
  const next = rows.map((r) => {
    const n = { ...r };
    if (r.started_at >= start) return n;
    if (r.kind === 'lease') {
      n.months_paid++;
      charges.push({ kind: 'facility_rent', amount: -n.monthly, memo: `${r.label} rent ${n.months_paid}${n.months_paid <= (n.months ?? 0) ? `/${n.months}` : ''}` });
    } else {
      if (n.upkeep > 0) charges.push({ kind: 'facility_upkeep', amount: -n.upkeep, memo: `${r.label} upkeep` });
      if (n.principal > 0 && n.months_paid < (n.months ?? 0)) {
        const step = loanStep(n.principal, n.monthly, n.months_paid, n.months!);
        n.principal = step.principal;
        n.months_paid++;
        charges.push({ kind: 'facility_loan', amount: -step.pay, memo: `${r.label} instalment ${n.months_paid}/${n.months}` });
      }
    }
    if (n.income > 0) charges.push({ kind: 'facility_income', amount: n.income, memo: `${r.label} maintenance sold` });
    return n;
  });
  return { charges, rows: next };
}

// ---------------------------------------------------------------- request schemas

export const leaseBodySchema = z.object({ level: z.int().min(1).max(MAX_LEVEL_AT_SIGNING).optional() });
export const buyBodySchema = leaseBodySchema.extend({ financing: financingSchema.optional() });
export const upgradeBodySchema = z.object({ toLevel: z.int().min(2).max(3) });
/** `GET /facilities/:id` previews one choice: `mode`, `level` and, for a purchase on credit, `downPct` with `months`. */
export const facilityQuerySchema = z.object({
  mode: z.enum(['lease', 'buy']).default('lease'), level: z.coerce.number().int().min(1).max(MAX_LEVEL_AT_SIGNING).default(1),
  downPct: z.coerce.number().int().min(LOAN_DOWN_PCT_MIN).max(LOAN_DOWN_PCT_MAX).optional(), months: z.coerce.number().int().min(LOAN_MONTHS_MIN).max(LOAN_MONTHS_MAX).optional(),
}).refine((q) => (q.downPct === undefined) === (q.months === undefined), { message: 'downPct and months go together' });
export type FacilityQuery = z.infer<typeof facilityQuerySchema>;

// ---------------------------------------------------------------- wire types

/** Relative to the company asking: `player` is hers, `ai` is held by anyone else (an AI company, or another player: `ownerName` says who), `airport` is not for sale. */
export type FacilityOwner = 'airport' | 'player' | 'ai' | 'available';
export type FacilityContractView = {
  id: number; kind: FacilityContractKind; startedAt: number; months: number | null; monthsPaid: number;
  /** Lease: the rent. Purchase: the loan instalment (0 when paid in cash). */
  monthly: number; upkeep: number; deposit: number; price: number; principal: number; noticeMonths: number;
  /** Since when the building has worked at its present level. */
  levelSince: number;
  /** What ending the contract costs now (`fee`: the notice or the rest of the term for a lease, the credit left for a purchase) and brings back (`refund`: the deposit, or the resale value). */
  exit: { fee: number; refund: number };
};
export type FacilityView = {
  id: number; hub: string; slot: string; name: string; kind: FacilityKind; effect: FacilityEffect; areaM2: number;
  owner: FacilityOwner; ownerName: string | null;
  /** Catalogue rent: what renting it costs a month, and the base of every other price. 0 for a building that is not offered. */
  rent: number;
  /** The level in force (1 when not hers). */
  level: number; maxLevel: number;
  contract: FacilityContractView | null;
  /** Works in progress: the building keeps working at `level` until `until`. */
  works: { toLevel: number; until: number } | null;
  /** When the next upgrade can start; null when it is not hers or already at its top level. */
  nextLevelAt: number | null;
  /** Hangar only: fewer technicians at the hub than its hangars need, so the effect is halved. */
  understaffed: boolean;
  /** What the building costs her a month today (rent, or upkeep and instalment); 0 when it is not hers. */
  monthly: number;
};
export type FacilityRequirement = { family: 'maintenance'; role: 'technician'; need: number; have: number; candidates: number };
export type FacilityDue = { today: number; monthly: number; staffMonthly: number; balanceAfter: number };
export type FacilityDetail = {
  facility: FacilityView; offer: { lease: FacilityLease; purchase: FacilityPurchase } | null; levels: FacilityLevelInfo[]; required: FacilityRequirement[];
  /** The previewed choice (`?mode=&level=`); null when the building is not on offer to her. */
  due: FacilityDue | null;
};
export type FacilitySignResult = { contract: FacilityContractView; due: number; balanceAfter: number };
export type FacilityUpgradeResult = { toLevel: number; cost: number; until: number; balanceAfter: number };
export type FacilityTerminateResult = { ended: true; kind: FacilityContractKind; fee: number; refund: number; balanceAfter: number };

export type Building = {
  slot: string; facilityId: number; name: string; kind: FacilityKind; effect: FacilityEffect; areaM2: number; owner: FacilityOwner; ownerName: string | null; rent: number; level: number; monthly: number;
};
export type HubParking = { spots: number; used: number; monthly: number };
export type HubPlan = {
  airport: string; layout: LayoutKey | null; buildings: Building[]; filters: readonly string[];
  summary: { yours: number; available: number; ai: number };
  parking: HubParking;
};
export type HubOverview = {
  icao: string; name: string; city: string; role: 'main' | 'secondary'; layout: LayoutKey | null;
  /** Her buildings at the hub and those on offer (the airport's own and the AI's are in the plan). */
  facilities: FacilityView[];
  /** Buildings plus the stand fees of the aircraft based there: what the hub costs a month. */
  monthlyCost: number;
  team: { total: number; byFamily: Partial<Record<StaffFamily, number>> };
  aircraft: { id: number; reg: string; icao: string; typeName: string; status: string; location: string; maintenanceUntil: number | null }[];
  /** Leases whose 36-month term (it then renews month by month) ends within RENEWAL_WINDOW_DAYS. */
  renewals: { facilityId: number; name: string; before: number }[];
  parking: HubParking;
};
export type HubsOverview = {
  company: { name: string; hubs: number; aircraft: number; employees: number };
  monthlyCost: number; hubs: HubOverview[];
  /** An airport the company flies to often and has no base at (SUGGEST_MIN_PER_WEEK flights a week over SUGGEST_WINDOW_DAYS). `fromMonthly`: its cheapest building to rent there. */
  suggestion: { icao: string; flightsPerWeek: number; fromMonthly: number } | null;
};
export const SUGGEST_MIN_PER_WEEK = 3;
export const SUGGEST_WINDOW_DAYS = 28;
export const RENEWAL_WINDOW_DAYS = 90;
