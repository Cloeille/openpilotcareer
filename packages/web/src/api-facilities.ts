import type { FacilityContractKind, FacilityDetail, FacilitySignResult, Financing, HubPlan, HubsOverview } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';
import { previewQuery } from './facilities-view.ts';

/**
 * Typed client for the FACILITIES section of docs/v3-plan.md (B.4).
 * The wire types are S3's (`shared/src/facilities.ts`, from `@opc/shared`); only the client's own `Preview` and `SignBody` are declared here.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, instants are epoch milliseconds, ICAO codes are upper case.
 */

/** What `GET /facilities/:id` previews: one way of holding, one starting level and, for a purchase on credit, the down payment and the term. */
export type Preview = { mode: FacilityContractKind; level: number; credit: Financing | null };
export type SignBody = { level?: number; financing?: Financing };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchHubsOverview = (): Promise<HubsOverview | null> => optional<HubsOverview>('/hubs/overview');
export const fetchHubPlan = (icao: string): Promise<HubPlan | null> => optional<HubPlan>(`/hubs/${encodeURIComponent(icao)}/plan`);
export const fetchFacility = (id: number, p?: Preview): Promise<FacilityDetail | null> => optional<FacilityDetail>(`/facilities/${id}${p ? `?${previewQuery(p)}` : ''}`);

export const leaseFacility = (id: number, body: SignBody): Promise<FacilitySignResult> => api<FacilitySignResult>(`/facilities/${id}/lease`, { method: 'POST', body });
export const buyFacility = (id: number, body: SignBody): Promise<FacilitySignResult> => api<FacilitySignResult>(`/facilities/${id}/buy`, { method: 'POST', body });
export const upgradeFacility = (id: number, toLevel: number): Promise<unknown> => api(`/facilities/${id}/upgrade`, { method: 'POST', body: { toLevel } });
export const terminateFacility = (id: number): Promise<unknown> => api(`/facilities/${id}/terminate`, { method: 'POST', body: {} });
