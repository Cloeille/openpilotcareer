import type { FleetAircraft, Me } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/** Typed client for the FINANCE section of docs/v2-contract.md. The types mirror the contract: they move to `@opc/shared` once lot be-finance is merged. */

/** Annual loan rate of the contract (LOAN_RATE in shared/finance.ts once lot be-finance is merged). */
export const LOAN_RATE = 0.069;
export const LOAN_MONTHS = { min: 36, max: 120 } as const;
export const LOAN_DOWN_PCT = { min: 20, max: 50 } as const;

export type Ownership = 'owned' | 'leased' | 'financed' | 'club' | 'rented';
export type AircraftStatus = 'available' | 'flying' | 'maintenance';
export type ContractKind = 'lease' | 'loan' | 'club' | 'rental';
export type Contract = { kind: ContractKind; id: number; monthly: number; hourly: number | null; endsAt: number | null };
export type FinanceFields = { registration: string; ownership: Ownership; wearPct: number; status: AircraftStatus; maintenanceUntil: number | null; contract: Contract | null };
/** A fleet aircraft as the finance backend serves it; every finance field is optional so a server that predates it still renders. */
export type FleetAircraftV2 = FleetAircraft & Partial<FinanceFields>;

export type LeaseDurationMonths = 12 | 24 | 36;
export type LeaseDuration = { months: LeaseDurationMonths; monthlyRent: number };
export type LeaseOffer = {
  id: number; lessor: string; icao: string; typeName: string; year: number; airframeHours: number; maintenanceIncluded: boolean;
  /** null: insurance is part of the rent; a number: monthly insurance the company pays on top. */
  insuranceMonthly: number | null;
  deposit: number; ferryFee: number; deliveryHours: number; minMonths: number; durations: LeaseDuration[]; purchaseOptionPrice: number;
  earlyExit: { afterMonths: number; penaltyRents: number };
};
export type LoanQuote = { downPct: number; months: number; monthly: number; total: number };
export type FleetQuote = { cash: number; loans: LoanQuote[]; leaseOffers: number };
export type HubUsage = { icao: string; spots: number; used: number };
export type Upcoming = { at: number; kind: string; amount: number; memo: string };
export type FinanceOverview = { upcoming: Upcoming[]; contracts: Contract[] };
export type LeaseSigned = { aircraft: FleetAircraftV2; firstPayment: number; balanceAfter: number };
export type CatalogueStats = { total: number; curated: number };

/** A route the server does not have yet (404/405) answers null; any other failure still throws. Lets every screen degrade to an honest placeholder against an older server. */
async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

const qs = (o: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const leaseOffers = (o: { icao?: string; hub?: string } = {}): Promise<LeaseOffer[] | null> => optional<LeaseOffer[]>(`/leasing/offers${qs(o)}`);
export const fleetQuote = (icao: string, hub: string): Promise<FleetQuote | null> => optional<FleetQuote>(`/me/fleet/quote${qs({ icao, hub })}`);
export const hubUsage = (): Promise<HubUsage[] | null> => optional<HubUsage[]>('/me/hubs');
export const financeOverview = (): Promise<FinanceOverview | null> => optional<FinanceOverview>('/me/finance');
export const catalogueStats = (): Promise<CatalogueStats | null> => optional<CatalogueStats>('/aircraft-types/stats');

export const signLease = (offerId: number, months: LeaseDurationMonths, hub: string): Promise<LeaseSigned> => api<LeaseSigned>('/me/leases', { method: 'POST', body: { offerId, months, hub } });
export const terminateLease = (id: number): Promise<unknown> => api(`/me/leases/${id}/terminate`, { method: 'POST', body: {} });
export const buyoutLease = (id: number): Promise<unknown> => api(`/me/leases/${id}/buyout`, { method: 'POST', body: {} });
export const buyAircraftWith = (icao: string, hub: string, financing?: { downPct: number; months: number }): Promise<Me> =>
  api<Me>('/me/fleet', { method: 'POST', body: { icao, hub, ...(financing ? { financing } : {}) } });
