import type { AircraftStatus, Financing, LoanOption, StaffFamily } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the FACILITIES section of docs/v3-plan.md (B.4).
 * The types below are S3's `shared/src/facilities.ts` field for field (S3 is not merged into this base yet, so they are declared here; checked against its branch `feature/v3-s3-facilities` on a local throwaway merge, never pushed).
 * Once S3 is merged, swap this block for `import type { ... } from '@opc/shared'`; the screens do not change.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, instants are epoch milliseconds, ICAO codes are upper case.
 */

export type FacilityKind = 'maintenance' | 'terminal' | 'cargo' | 'office' | 'airport';
export type FacilityEffect = 'hangar' | 'desks' | 'ops' | 'none';
/** Relative to the company asking: `player` is hers, `ai` is held by anyone else (`ownerName` says who), `airport` is not for sale. */
export type FacilityOwner = 'airport' | 'player' | 'ai' | 'available';
export type Hold = 'lease' | 'purchase';
export type LayoutKey = 'LFMN';

export type FacilityLease = { monthly: number; months: number; deposit: number; noticeMonths: number; totalOverTerm: number };
export type FacilityPurchase = { price: number; rentMonths: number; upkeep: number; resalePct: number; resale: number; creditPct: number; loans: LoanOption[] };
export type FacilityLevelInfo = {
  level: number; cost: number; worksDays: number;
  /** Days at the level below before the works may start (level 3). */
  opensAfterDays: number | null;
  technicians: number; aircraft: number; widebody: boolean; sellsMaintenance: boolean; desks: number;
};
export type FacilityContractView = {
  id: number; kind: Hold; startedAt: number; months: number | null; monthsPaid: number;
  /** Lease: the rent. Purchase: the loan instalment (0 when paid in cash). */
  monthly: number; upkeep: number; deposit: number; price: number; principal: number; noticeMonths: number;
  levelSince: number;
};
export type FacilityView = {
  id: number; hub: string; slot: string; name: string; kind: FacilityKind; effect: FacilityEffect; areaM2: number;
  owner: FacilityOwner; ownerName: string | null;
  /** Catalogue rent: what renting it costs a month, and the base of every other price. 0 for a building that is not offered. */
  rent: number;
  level: number; maxLevel: number;
  contract: FacilityContractView | null;
  works: { toLevel: number; until: number } | null;
  /** When the next upgrade can start; null when it is not hers or already at its top level. */
  nextLevelAt: number | null;
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
  aircraft: { id: number; reg: string; icao: string; typeName: string; status: AircraftStatus; location: string; maintenanceUntil: number | null }[];
  renewals: { facilityId: number; name: string; before: number }[];
  parking: HubParking;
};
export type HubsOverview = {
  company: { name: string; hubs: number; aircraft: number; employees: number };
  monthlyCost: number; hubs: HubOverview[];
  suggestion: { icao: string; flightsPerWeek: number; fromMonthly: number } | null;
};

/** What `GET /facilities/:id` previews: one way of holding, one starting level and, for a purchase on credit, the down payment and the term. */
export type Preview = { mode: Hold; level: number; credit: Financing | null };
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
/** The query string of a preview, in S3's names (`mode` is `lease` or `buy`). */
export function previewQuery(p: Preview): string {
  const q = new URLSearchParams({ mode: p.mode === 'lease' ? 'lease' : 'buy', level: String(p.level) });
  if (p.mode === 'purchase' && p.credit) { q.set('downPct', String(p.credit.downPct)); q.set('months', String(p.credit.months)); }
  return q.toString();
}
export const fetchFacility = (id: number, p?: Preview): Promise<FacilityDetail | null> => optional<FacilityDetail>(`/facilities/${id}${p ? `?${previewQuery(p)}` : ''}`);

export const leaseFacility = (id: number, body: SignBody): Promise<FacilitySignResult> => api<FacilitySignResult>(`/facilities/${id}/lease`, { method: 'POST', body });
export const buyFacility = (id: number, body: SignBody): Promise<FacilitySignResult> => api<FacilitySignResult>(`/facilities/${id}/buy`, { method: 'POST', body });
export const upgradeFacility = (id: number, toLevel: number): Promise<unknown> => api(`/facilities/${id}/upgrade`, { method: 'POST', body: { toLevel } });
export const terminateFacility = (id: number): Promise<unknown> => api(`/facilities/${id}/terminate`, { method: 'POST', body: {} });
