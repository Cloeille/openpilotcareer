import type { FinanceOverview, FleetQuote, HubSpots, LeaseMonths, LeaseOffer, Me, PurchaseResult } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/** Typed client for the FINANCE section of docs/v2-contract.md. The types and the loan bounds come from `@opc/shared`. */

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
export const hubUsage = (): Promise<HubSpots[] | null> => optional<HubSpots[]>('/me/hubs');
export const financeOverview = (): Promise<FinanceOverview | null> => optional<FinanceOverview>('/me/finance');
export const catalogueStats = (): Promise<CatalogueStats | null> => optional<CatalogueStats>('/aircraft-types/stats');

export const signLease = (offerId: LeaseOffer['id'], months: LeaseMonths, hub: string): Promise<PurchaseResult> => api<PurchaseResult>('/me/leases', { method: 'POST', body: { offerId, months, hub } });
export const terminateLease = (id: number): Promise<unknown> => api(`/me/leases/${id}/terminate`, { method: 'POST', body: {} });
export const buyoutLease = (id: number): Promise<unknown> => api(`/me/leases/${id}/buyout`, { method: 'POST', body: {} });
export const buyAircraftWith = (icao: string, hub: string, financing?: { downPct: number; months: number }): Promise<Me> =>
  api<Me>('/me/fleet', { method: 'POST', body: { icao, hub, ...(financing ? { financing } : {}) } });
