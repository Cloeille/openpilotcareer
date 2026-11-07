// Lot FINANCE: leasing, credit, club rental, registrations, wear, parking. Pure rules + shared types.
// Runtime-imports nothing from ./index.ts (index re-exports this file): type imports only, so there is no module cycle.
import { z } from 'zod';
import type { AircraftCategory, AirportSize, FleetAircraft } from './index.ts';

// ---------------------------------------------------------------- credit

export const LOAN_RATE = 0.069;
export const LOAN_MONTHS_MIN = 36;
export const LOAN_MONTHS_MAX = 120;
export const LOAN_DOWN_PCT_MIN = 20;
export const LOAN_DOWN_PCT_MAX = 50;
/** Terms offered by `GET /me/fleet/quote`; any other pair inside the min/max bounds is accepted by `POST /me/fleet`. */
export const LOAN_QUOTE_DOWN_PCTS = [20, 30, 50] as const;
export const LOAN_QUOTE_MONTHS = [36, 60, 84, 120] as const;

/** Annuity instalment, rounded to the euro. */
export function loanPayment(principal: number, months: number, rate: number = LOAN_RATE): number {
  const r = rate / 12;
  return Math.round((principal * r) / (1 - (1 + r) ** -months));
}

/** One month of an amortising loan: the instalment paid, the principal left, and whether it was the last one (which also clears the rounding residue). */
export function loanStep(principal: number, monthly: number, monthsPaid: number, months: number): { pay: number; interest: number; principal: number; last: boolean } {
  const interest = Math.round((principal * LOAN_RATE) / 12);
  const last = monthsPaid + 1 === months;
  const pay = last ? principal + interest : monthly;
  return { pay, interest, principal: last ? 0 : Math.max(0, principal - (pay - interest)), last };
}

export type LoanOption = {
  downPct: number; months: number; monthly: number;
  /** Down payment + all instalments + the convoy fee: what the aircraft costs in the end when financed this way. */
  total: number;
  /** Down payment (without the convoy fee). */
  down: number;
  /** Cash leaving the account today: down payment + convoy fee. */
  dueToday: number;
};

export function loanOption(price: number, ferry: number, downPct: number, months: number): LoanOption {
  const down = Math.round((price * downPct) / 100);
  const monthly = loanPayment(price - down, months);
  return { downPct, months, monthly, total: down + monthly * months + ferry, down, dueToday: down + ferry };
}

// ---------------------------------------------------------------- parking, club, rental

export const PARKING_SPOTS_PER_HUB = 10;
/** Euros per aircraft per month, by the size of the hub airport. */
export const PARKING_FEE_BY_SIZE: Record<AirportSize, number> = { large: 3_900, medium: 1_800, small: 450 };

/** Hourly club rental, fuel included, no fixed cost. Keyed by aircraft type. */
export const CLUB: Record<string, { hourly: number }> = { C172: { hourly: 210 } };
/** Monthly rental: refundable deposit, fixed monthly fee, and a per-block-hour charge standing for fuel. */
export const MONTHLY_RENTAL: Record<string, { deposit: number; monthly: number; hourly: number; minMonths: number }> = {
  C172: { deposit: 5_000, monthly: 1_900, hourly: 110, minMonths: 6 },
};

export const LEASE_DURATIONS = [12, 24, 36] as const;
export type LeaseMonths = (typeof LEASE_DURATIONS)[number];
export const LEASE_DEPOSIT_RENTS = 2;

// ---------------------------------------------------------------- wear

/** Wear (0-100 %) at which an aircraft goes to the workshop. */
export const WEAR_THRESHOLD_PCT = 80;
export const WEAR_AFTER_MAINTENANCE_PCT = 5;
/** Wear gained per block hour. A light piston single hits the threshold after 100 h, an airliner after about 270 h. */
export const WEAR_PCT_PER_HOUR: Record<AircraftCategory, number> = {
  'piston-single': 0.8, 'piston-multi': 0.7, 'turboprop-single': 0.5, 'turboprop-multi': 0.45, 'turboprop-airliner': 0.4,
  'jet-business': 0.35, 'jet-airliner': 0.3, 'jet-widebody': 0.25, 'helicopter': 0.8, 'other': 0.6,
};
/** Hours in the workshop once the threshold is crossed. */
export const MAINTENANCE_HOURS: Record<AircraftCategory, number> = {
  'piston-single': 12, 'piston-multi': 18, 'turboprop-single': 24, 'turboprop-multi': 24, 'turboprop-airliner': 36,
  'jet-business': 36, 'jet-airliner': 48, 'jet-widebody': 72, 'helicopter': 24, 'other': 24,
};
export const wearAfter = (wearPct: number, category: AircraftCategory, hours: number): number =>
  Math.min(100, Math.round((wearPct + WEAR_PCT_PER_HOUR[category] * hours) * 100) / 100);

// ---------------------------------------------------------------- registrations
// A registration is a country prefix + letters (`F-HAZA`, `G-HAZA`, `N100AA`, `JA0001`). It is unique per server and
// deterministic: the Nth registration with a prefix is always the same string. The prefix comes from the country of the
// hub airport; when the country is not in the table the ICAO location prefix decides (two letters first, then one).

export const REGISTRATION_PREFIX_BY_COUNTRY: Record<string, string> = {
  FR: 'F-', DE: 'D-', GB: 'G-', IT: 'I-', ES: 'EC-', CH: 'HB-', NL: 'PH-', BE: 'OO-', IE: 'EI-', PT: 'CS-', AT: 'OE-', SE: 'SE-',
  NO: 'LN-', DK: 'OY-', FI: 'OH-', PL: 'SP-', CZ: 'OK-', HU: 'HA-', GR: 'SX-', TR: 'TC-', RU: 'RA-', US: 'N', CA: 'C-', AU: 'VH-',
  NZ: 'ZK-', JP: 'JA', IN: 'VT-', CN: 'B-', BR: 'PP-', MX: 'XA-', AE: 'A6-', ZA: 'ZS-', AR: 'LV-', SG: '9V-', KR: 'HL',
};
/** Fallback: ICAO location prefix. Two-letter keys win over one-letter keys. */
export const REGISTRATION_PREFIX_BY_ICAO: Record<string, string> = {
  LF: 'F-', ED: 'D-', ET: 'D-', EG: 'G-', LI: 'I-', LE: 'EC-', LS: 'HB-', EH: 'PH-', EB: 'OO-', EI: 'EI-', LP: 'CS-', LO: 'OE-',
  ES: 'SE-', EN: 'LN-', EK: 'OY-', EF: 'OH-', EP: 'SP-', LK: 'OK-', LH: 'HA-', LG: 'SX-', LT: 'TC-', LR: 'YR-', LB: 'LZ-', LJ: 'S5-', LD: '9A-',
  A: 'P2-', B: 'TF-', C: 'C-', D: '5N-', E: 'SE-', F: 'ZS-', G: 'CN-', H: 'SU-', K: 'N', L: 'EC-', M: 'XA-', N: 'ZK-', O: 'A6-', P: 'N',
  R: 'JA', S: 'PP-', T: 'N', U: 'RA-', V: 'VT-', W: 'PK-', Y: 'VH-', Z: 'B-',
};

export function registrationPrefix(country: string | undefined, icao: string): string {
  return (country && REGISTRATION_PREFIX_BY_COUNTRY[country]) || REGISTRATION_PREFIX_BY_ICAO[icao.slice(0, 2)] || REGISTRATION_PREFIX_BY_ICAO[icao.slice(0, 1)] || 'N';
}

const letter = (k: number): string => String.fromCharCode(65 + (k % 26));
/** The `n`th (0-based) registration for a prefix. Hyphenated prefixes run F-HAZA, F-HAZB, ... F-HAZZ, F-HBAA, ... */
export function formatRegistration(prefix: string, n: number): string {
  if (prefix.endsWith('-')) {
    const k = (n + 650) % 17_576; // 650 = "AZA": the sequence starts at HAZA
    return `${prefix}H${letter(Math.floor(k / 676))}${letter(Math.floor(k / 26))}${letter(k)}`;
  }
  if (prefix === 'N') return `N${100 + (Math.floor(n / 676) % 900)}${letter(Math.floor(n / 26))}${letter(n)}`;
  return `${prefix}${String(1 + (n % 9_999)).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- types

export type Ownership = 'owned' | 'leased' | 'financed' | 'club' | 'rented';
export type AircraftStatus = 'available' | 'flying' | 'maintenance';
export type ContractKind = 'lease' | 'loan' | 'club' | 'rental';
export type AircraftContract = { kind: ContractKind; id: number; monthly: number; hourly: number | null; endsAt: number | null };
/** The fields `FleetAircraft` gains (see index.ts). */
export type FleetAircraftFinance = {
  registration: string; ownership: Ownership; wearPct: number; status: AircraftStatus; maintenanceUntil: number | null; contract: AircraftContract | null;
};

export type LeaseOffer = {
  id: string; lessor: string; icao: string; typeName: string; year: number; airframeHours: number; maintenanceIncluded: boolean;
  /** null: hull insurance is included in the rent. */
  insuranceMonthly: number | null;
  deposit: number; ferryFee: number; deliveryHours: number; minMonths: number;
  durations: { months: LeaseMonths; monthlyRent: number }[];
  purchaseOptionPrice: number;
  earlyExit: { afterMonths: number; penaltyRents: number };
};

export type FleetQuote = {
  /** Price + convoy fee: what a cash purchase debits. */
  cash: number; loans: LoanOption[]; leaseOffers: number;
  /** Superset of the contract: the pieces `cash` is made of, and the balance it is compared with. */
  price: number; ferryFee: number; balance: number;
};

export type FinanceCharge = { at: number; kind: string; amount: number; memo: string };
export type FinanceContract = {
  id: number; kind: ContractKind; aircraftId: number; registration: string; icao: string; startedAt: number; endsAt: number | null;
  monthly: number; hourly: number | null; deposit: number; months: number | null; monthsPaid: number;
  /** Remaining principal of a loan, null for the other kinds. */
  balance: number | null;
};
export type FinanceOverview = { upcoming: FinanceCharge[]; contracts: FinanceContract[] };
export type HubSpots = { icao: string; spots: number; used: number };
export type PurchaseResult = { aircraft: FleetAircraft; firstPayment: number; balanceAfter: number };

// ---------------------------------------------------------------- request schemas

const typeCode = z.string().regex(/^[A-Z0-9]{2,4}$/, 'ICAO type designator: 2-4 chars A-Z/0-9');
const airportCode = z.string().regex(/^[A-Z]{4}$/, 'ICAO airport code: 4 letters A-Z');

export const financingSchema = z.object({
  downPct: z.int().min(LOAN_DOWN_PCT_MIN).max(LOAN_DOWN_PCT_MAX),
  months: z.int().min(LOAN_MONTHS_MIN).max(LOAN_MONTHS_MAX),
});
export type Financing = z.infer<typeof financingSchema>;
export const fleetPurchaseSchema = z.object({ icao: typeCode, hub: airportCode, financing: financingSchema.optional() });
export const leaseRequestSchema = z.object({ offerId: z.string().min(1).max(40), months: z.int().positive(), hub: airportCode });
export const rentalRequestSchema = z.object({ hub: airportCode, icao: typeCode });
export const quoteQuerySchema = z.object({ icao: typeCode, hub: airportCode });
export const offersQuerySchema = z.object({ icao: typeCode.optional(), hub: airportCode.optional() });
