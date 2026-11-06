import type { AircraftType } from '@opc/shared';
import type { AircraftStatus, FleetAircraftV2, FleetQuote, HubUsage, LeaseDuration, LeaseOffer, LoanQuote, Upcoming } from './api-finance.ts';

/** Pure view-models of the finance screens (fleet, lease, loan, starter list). No DOM, no i18n: the screens turn these into words. */

const HOUR_MS = 3_600_000;

// ------------------------------------------------------------------ fleet table

export type ActiveFlightInfo = { destination: string; flightId: number };
export type StatusView = { kind: AircraftStatus; /** hours left of an inspection, rounded up */ hoursLeft: number | null; flight: ActiveFlightInfo | null };

/** Status of one aircraft. A server without the finance fields only knows `busy`. */
export function statusOf(a: Pick<FleetAircraftV2, 'busy' | 'status' | 'maintenanceUntil'>, now: number, flight: ActiveFlightInfo | null = null): StatusView {
  const kind: AircraftStatus = a.status ?? (a.busy ? 'flying' : 'available');
  const hoursLeft = kind === 'maintenance' && a.maintenanceUntil != null ? Math.max(1, Math.ceil((a.maintenanceUntil - now) / HOUR_MS)) : null;
  return { kind, hoursLeft, flight: kind === 'flying' ? flight : null };
}

export const wearOf = (a: Pick<FleetAircraftV2, 'wearPct'>): number | null => (typeof a.wearPct === 'number' ? Math.min(100, Math.max(0, Math.round(a.wearPct))) : null);

/** The name an aircraft goes by: its registration, else the legacy `ICAO #id`. */
export const aircraftName = (a: Pick<FleetAircraftV2, 'registration' | 'icao' | 'id'>): string => a.registration ?? `${a.icao} #${a.id}`;

/** Fleet sorted by registration (the mockup's "Trier par immatriculation"), the legacy name as a fallback. */
export const byRegistration = <A extends Pick<FleetAircraftV2, 'registration' | 'icao' | 'id'>>(fleet: A[]): A[] =>
  [...fleet].sort((a, b) => aircraftName(a).localeCompare(aircraftName(b), 'en', { numeric: true }) || a.id - b.id);

export type ParkingSummary = { free: number; total: number; full: string[] };
/** "4 sur 10 · LFKB complet": free spots over all hubs, and the hubs without a free spot. Null when the server does not report parking. */
export function parkingSummary(usage: HubUsage[] | null): ParkingSummary | null {
  if (!usage || usage.length === 0) return null;
  return {
    free: usage.reduce((n, u) => n + Math.max(0, u.spots - u.used), 0),
    total: usage.reduce((n, u) => n + u.spots, 0),
    full: usage.filter((u) => u.used >= u.spots).map((u) => u.icao),
  };
}
export const freeSpots = (usage: HubUsage[] | null, icao: string): number | null => {
  const u = usage?.find((x) => x.icao === icao);
  return u ? Math.max(0, u.spots - u.used) : null;
};

/** The soonest charges first, at most `limit`. */
export const nextCharges = (upcoming: Upcoming[], limit = 4): Upcoming[] => [...upcoming].sort((a, b) => a.at - b.at).slice(0, limit);

// ------------------------------------------------------------------ lease

export const LEASE_DEFAULT_MONTHS = 24;
/** The duration shown selected first: 24 months when offered, else the middle one. */
export function defaultDuration(offer: Pick<LeaseOffer, 'durations'>): LeaseDuration | null {
  return offer.durations.find((d) => d.months === LEASE_DEFAULT_MONTHS) ?? offer.durations[Math.floor(offer.durations.length / 2)] ?? null;
}
export const cheapestRent = (offer: Pick<LeaseOffer, 'durations'>): number | null => (offer.durations.length === 0 ? null : Math.min(...offer.durations.map((d) => d.monthlyRent)));

export type LeaseQuote = {
  months: number; rent: number; totalRent: number; deposit: number; ferry: number;
  firstPayment: number; balanceAfter: number; affordable: boolean; shortfall: number;
  /** penalty of an early exit, in euros */ penalty: number;
};
/** What signing `offer` for `months` costs today: first rent + deposit + ferry fee. */
export function leaseQuote(offer: LeaseOffer, months: number, balance: number): LeaseQuote | null {
  const d = offer.durations.find((x) => x.months === months);
  if (!d) return null;
  const firstPayment = d.monthlyRent + offer.deposit + offer.ferryFee;
  return {
    months, rent: d.monthlyRent, totalRent: d.monthlyRent * months, deposit: offer.deposit, ferry: offer.ferryFee, firstPayment,
    balanceAfter: balance - firstPayment, affordable: firstPayment <= balance, shortfall: Math.max(0, firstPayment - balance),
    penalty: d.monthlyRent * offer.earlyExit.penaltyRents,
  };
}

/** Month (UTC) of the last rent of a lease signed at `now`: the first rent is paid at signing, then on the 1st of each following month. */
export function lastRentMonth(now: number, months: number): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.max(0, months - 1), 1));
}
export const deliveryAt = (now: number, offer: Pick<LeaseOffer, 'deliveryHours'>): number => now + offer.deliveryHours * HOUR_MS;

// ------------------------------------------------------------------ loan

export const LOAN_DEFAULT = { downPct: 20, months: 84 } as const;
export const downPayment = (price: number, loan: Pick<LoanQuote, 'downPct'>): number => Math.round((price * loan.downPct) / 100);

/** The loan offered first: 20 % over 84 months when the server quotes it, else the closest to it. */
export function defaultLoan(loans: LoanQuote[]): LoanQuote | null {
  if (loans.length === 0) return null;
  const dist = (l: LoanQuote): number => Math.abs(l.downPct - LOAN_DEFAULT.downPct) * 1000 + Math.abs(l.months - LOAN_DEFAULT.months);
  return [...loans].sort((a, b) => dist(a) - dist(b))[0]!;
}
export const findLoan = (loans: LoanQuote[], downPct: number, months: number): LoanQuote | null => loans.find((l) => l.downPct === downPct && l.months === months) ?? null;
export const loanDownPcts = (loans: LoanQuote[]): number[] => [...new Set(loans.map((l) => l.downPct))].sort((a, b) => a - b);
export const loanMonths = (loans: LoanQuote[], downPct: number): number[] => [...new Set(loans.filter((l) => l.downPct === downPct).map((l) => l.months))].sort((a, b) => a - b);

/** Fees added to a cash purchase (ferry and registration): the quote's `cash` total minus the catalogue price, 0 when the server quotes the price alone. */
export const purchaseFees = (price: number, quote: Pick<FleetQuote, 'cash'> | null): number => (quote && quote.cash > price ? quote.cash - price : 0);

export type LoanBreakdown = { down: number; financed: number; monthly: number; months: number; downPct: number; fees: number; balanceAfter: number; affordable: boolean; interest: number };
/** The down payment is `downPct` of the price plus the fees, which the loan never finances (mockup: 20 % of 4 200 000 + 12 500 = 852 500). */
export function loanBreakdown(price: number, loan: LoanQuote, balance: number, fees = 0): LoanBreakdown {
  const part = downPayment(price, loan);
  const down = part + fees;
  return { down, financed: price - part, monthly: loan.monthly, months: loan.months, downPct: loan.downPct, fees, balanceAfter: balance - down, affordable: down <= balance, interest: Math.max(0, loan.monthly * loan.months - (price - part)) };
}

export type FundingOption = { kind: 'loan'; loan: LoanBreakdown } | { kind: 'lease'; rent: number; deposit: number; balanceAfter: number };
/** The ways out of a cash shortfall, loan first. A lease only when the server has an offer for the type (`leaseOffers > 0`) and the model of it is known. */
export function fundingOptions(price: number, quote: FleetQuote | null, balance: number, lease: LeaseOffer | null): FundingOption[] {
  const fees = purchaseFees(price, quote);
  const out: FundingOption[] = [];
  const loan = quote ? defaultLoan(quote.loans) : null;
  if (loan) out.push({ kind: 'loan', loan: loanBreakdown(price, loan, balance, fees) });
  if (lease && (quote?.leaseOffers ?? 1) > 0) {
    const d = defaultDuration(lease);
    const q = d ? leaseQuote(lease, d.months, balance) : null;
    if (q) out.push({ kind: 'lease', rent: q.rent, deposit: q.deposit, balanceAfter: q.balanceAfter });
  }
  return out;
}

// ------------------------------------------------------------------ starter list (new company, empty fleet)

export type StarterRow = {
  icao: string; offer: LeaseOffer; type: AircraftType | null; price: number | null;
  /** ferry and registration added to a cash purchase at the default hub (0 when the server does not quote it) */ buyFees: number;
  rent: number | null; deposit: number; ferry: number; months: number;
  leaseAffordable: boolean; buyAffordable: boolean; buyBalanceAfter: number | null;
};
export function starterRow(offer: LeaseOffer, type: AircraftType | null, price: number | null, balance: number, buyFees = 0): StarterRow {
  const d = defaultDuration(offer);
  const q = d ? leaseQuote(offer, d.months, balance) : null;
  return {
    icao: offer.icao, offer, type, price, buyFees, rent: d?.monthlyRent ?? null, deposit: offer.deposit, ferry: offer.ferryFee, months: d?.months ?? 0,
    leaseAffordable: q?.affordable ?? false, buyAffordable: price !== null && price + buyFees <= balance, buyBalanceAfter: price === null ? null : balance - price - buyFees,
  };
}
/** "3 dans ton budget": rows the company can sign with its capital (lease or purchase). */
export const inBudget = (rows: StarterRow[]): number => rows.filter((r) => r.leaseAffordable || r.buyAffordable).length;

export type StarterSummary = { balanceAfter: number; today: number; saved: number | null };
/** Balance after signing a starter aircraft by lease or by purchase. `buyFees` is the convoy fee of the purchase at the chosen hub; `saved` (lease only) is how much more cash the lease leaves than buying, when buying is affordable at all, both after their ferry fees (mockup: 1 435 000 − 170 500 = 1 264 500). */
export function starterSummary(row: StarterRow, mode: 'lease' | 'buy', balance: number, buyFees = row.buyFees): StarterSummary | null {
  const buyAfter = row.price === null ? null : balance - row.price - buyFees;
  if (mode === 'buy') return row.price === null ? null : { balanceAfter: buyAfter!, today: row.price + buyFees, saved: null };
  const q = leaseQuote(row.offer, row.months, balance);
  if (!q) return null;
  return { balanceAfter: q.balanceAfter, today: q.firstPayment, saved: buyAfter !== null && buyAfter >= 0 && q.balanceAfter > buyAfter ? q.balanceAfter - buyAfter : null };
}

// ------------------------------------------------------------------ labels

/** `novembre` / `octobre 2028` (UTC): the month a rent falls in. */
export function monthLabel(locale: string, ms: number, withYear: boolean): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).format(ms);
}

/** The aircraft just bought or leased: the highest id of that type (POST /me/fleet returns the whole fleet). */
export function newestOf(fleet: Pick<FleetAircraftV2, 'id' | 'icao' | 'registration'>[], icao: string): string {
  const mine = fleet.filter((a) => a.icao === icao).sort((a, b) => b.id - a.id)[0];
  return mine ? aircraftName(mine) : icao;
}

export type AddonCategory = 'piston' | 'turboprop' | 'jet' | 'helicopter';
/** The category a player picks for an add-on aircraft whose type the catalogue does not know, mapped to the finer server category its performance is estimated from. */
export const ADDON_CATEGORY: Record<AddonCategory, 'piston-single' | 'turboprop-single' | 'jet-business' | 'helicopter'> = {
  piston: 'piston-single', turboprop: 'turboprop-single', jet: 'jet-business', helicopter: 'helicopter',
};
