import type { StaffFamily, StaffRole } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the FACILITIES section of docs/v3-plan.md (B.4).
 * S3's `shared/src/facilities.ts` does not exist yet, so the wire types are declared here as the contract states them; B.4 leaves `FacilityRow`, the offer terms and the level info open, so those follow "Implementation notes (F3)".
 * Once S3 is merged, swap this type block for `import type { ... } from '@opc/shared'`; the screens do not change.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros, instants are epoch milliseconds, ICAO codes are upper case.
 */

export type FacilityKind = 'maintenance' | 'terminal' | 'cargo' | 'office' | 'parking' | 'airport';
/** Who holds a building, from the player's side: `player` is the requesting company (the table's `company`). */
export type Owner = 'airport' | 'player' | 'ai' | 'available';
export type Hold = 'lease' | 'purchase';

export type FacilityRow = {
  id: number; slot: string; name: string; kind: FacilityKind; owner: Owner; ownerName?: string;
  level: number; areaM2: number;
  /** How the player holds it; null when somebody else does or nobody. */
  hold: Hold | null;
  /** What the player pays a month for it (rent, or upkeep when bought); null when nothing. */
  monthly: number | null;
  /** The rent asked for it while it is available; null otherwise. */
  offerMonthly: number | null;
  /** The roster is short for its level: its effect is halved (B.4). */
  understaffed: boolean;
  /** End of the works of a level upgrade in progress. */
  worksTo: number | null;
};

export type HubOverview = {
  icao: string; name: string; role: 'main' | 'secondary';
  facilities: FacilityRow[]; monthlyCost: number;
  team: { total: number; byFamily: Partial<Record<StaffFamily, number>>; chief: { name: string; since: number } | null };
  aircraft: { id: number; reg: string; typeName: string; status: AircraftState; note: string | null }[];
  renewals: { text: string; before: number }[];
};
/** What a based aircraft is doing. Unknown values are shown as the server's `note` alone. */
export type AircraftState = 'yours' | 'flying' | 'delayed' | 'ready' | 'ground' | 'inspection';
export type HubSuggestion = { icao: string; flightsPerWeek: number; fromMonthly: number; text: string };
export type HubsOverview = { company: { name: string }; monthlyCost: number; hubs: HubOverview[]; suggestion: HubSuggestion | null };

/** B.4's `Building` plus the facility `id` (asked of S3: the selection panel loads `GET /facilities/:id`). The `box` geometry is client data (airport-chart.ts). */
export type PlanBuilding = { id: number; slot: string; name: string; kind: FacilityKind; owner: Owner; ownerName?: string };
/** `layout` names a drawn plan (airport-chart.ts); null when the airport has none and the list is all there is. */
export type HubPlan = { airport: string; layout: string | null; buildings: PlanBuilding[]; filters: string[]; summary: { yours: number; available: number; ai: number } };

export type LeaseTerms = { monthly: number; months: number; deposit: number; noticeMonths: number };
/** `monthsOfRent`: the price expressed in months of rent (127 in the mockup). `resalePct` is 0..1. */
export type PurchaseTerms = { price: number; monthsOfRent: number; upkeep: number; resalePct: number; creditPct: number };
export type StaffNeed = { family: StaffFamily; role: 'chief' | StaffRole; need: number };
/** `locked`: the level opens after this many months at the level below. `salaries`: monthly payroll of the people the level needs. */
export type LevelInfo = { level: number; works: { weeks: number; cost: number } | null; staff: StaffNeed[]; salaries: number; locked: { months: number } | null };
export type RequiredRole = StaffNeed & { have: number; candidates: number };
export type ContractInfo = { kind: Hold; monthly: number; months: number; startedAt: number; deposit: number; principal: number; noticeMonths: number };

export type FacilityDetail = {
  facility: FacilityRow & { hub: string; contract: ContractInfo | null };
  /** Null for a building nobody can take (the airport's, an AI company's). */
  offer: { lease: LeaseTerms; purchase: PurchaseTerms } | null;
  levels: LevelInfo[];
  required: RequiredRole[];
  due: { today: number; monthly: number; balanceAfter: number };
};

export type Financing = { downPct: number; months: number };
export type SignBody = { level?: number; financing?: Financing };
export type SignResult = { contract: ContractInfo; due: { today: number; monthly: number }; balanceAfter: number };

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
export const fetchFacility = (id: number): Promise<FacilityDetail | null> => optional<FacilityDetail>(`/facilities/${id}`);

export const leaseFacility = (id: number, body: SignBody): Promise<SignResult> => api<SignResult>(`/facilities/${id}/lease`, { method: 'POST', body });
export const buyFacility = (id: number, body: SignBody): Promise<SignResult> => api<SignResult>(`/facilities/${id}/buy`, { method: 'POST', body });
export const upgradeFacility = (id: number, toLevel: number): Promise<unknown> => api(`/facilities/${id}/upgrade`, { method: 'POST', body: { toLevel } });
export const terminateFacility = (id: number): Promise<unknown> => api(`/facilities/${id}/terminate`, { method: 'POST', body: {} });
