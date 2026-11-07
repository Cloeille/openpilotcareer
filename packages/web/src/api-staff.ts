import type { Arrival, FamilyRow as WireFamilyRow, StaffOverview as WireStaffOverview } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the STAFF section of docs/v3-plan.md (B.3).
 * The wire types are declared here as lot S2's `shared/src/staff.ts` has them, except what the screens ask of S2 on top (`poolCount`, `members`, `CoverageRow.type`, see "Implementation notes (F2)"); the overview and its rows are extended from `@opc/shared`, so what the server adds to them reaches the screens.
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Days are ISO dates (`2026-11-06`, UTC); instants are epoch milliseconds; durations are minutes unless the name says hours.
 */

export type StaffFamily = 'pilot' | 'cabin' | 'ground' | 'admin' | 'maintenance' | 'kitchen';
export type StaffRole = 'captain' | 'fo' | 'attendant' | 'agent' | 'clerk' | 'technician' | 'cook' | 'instructor';
export type StaffState = 'pending' | 'free' | 'onDuty' | 'resting' | 'leave' | 'training';
export type Coverage = 'ok' | 'tight' | 'short' | 'none';
export type RestPolicy = 'legal' | 'standard' | 'generous';

export type StaffMember = {
  id: number; family: StaffFamily; name: string; role: StaffRole; base: string; hiredAt: number; startsAt: number; endsAt: number | null;
  /** Euros a month. */
  salary: number; reliability: number; morale: number;
  /** Flight hours for a pilot, years for the others. */
  experience: number;
  contract: 'cdi' | 'cdd'; noticeDays: number; state: StaffState; quals: string[];
  /** From the birth year (null: a row from before it was recorded) and the instant the person must retire (v4 TRAINING). */
  age?: number | null; retiresAt?: number | null;
  /** People the row stands for: 1 for a pilot or a member of cabin crew, the headcount of a pool (ground, admin, maintenance, kitchen). */
  poolCount: number;
};
export type Qualification = { type: string; name: string; validFrom: number; validUntil: number | null; inTraining: boolean };
/** Minutes everywhere except `restHours` and `medicalDays`. `endsAt`: the latest the current duty period may end (null when not on duty). */
export type DutyState = { dutyMin: number; limitMin: number; endsAt: number | null; restHours: number; flight28d: number; flight12m: number; fatigue: number; medicalDays: number };
export type DutyBlock = { flightNo: string; dep: number; arr: number; origin: string; dest: string };
export type DutyRule = 'busy' | 'rest' | 'daily' | 'flight28' | 'flight12' | 'week' | 'streak';

/** F2 asks the server for these two optional fields (see the implementation notes): without them the sheet has no previous/next member and the leave rows of the pilots cannot hire a temp. */
export type MemberRef = { id: number; name: string; role: StaffRole };
export type { Arrival };
export type FamilyRow = Omit<WireFamilyRow, 'children'> & { children?: FamilyRow[]; members?: MemberRef[] };
/** Today's flights cancelled for want of crew: `family` is what ran short (null when unknown), `type` the aircraft type. */
export type Blocker = { kind: 'no_crew' | 'duty_limit'; family: 'pilot' | 'cabin' | null; type: string; flights: number };
export type WatchItem = { staffId: number; name: string; family: StaffFamily; reason: 'fatigue' | 'duty'; value: number; detail: string };
export type StaffOverview = Omit<WireStaffOverview, 'families'> & { families: FamilyRow[] };

export type StaffDetail = {
  member: StaffMember; duty: DutyState; week: DutyBlock[];
  last7d: { day: string; hours: number | null; kind: 'duty' | 'rest' }[];
  quals: Qualification[];
  contract: { kind: 'cdi' | 'cdd'; salary: number; noticeDays: number; firingCost: number; endsAt: number | null };
  nextLeave: { from: string; to: string } | null;
  /** The next flight the person could not fly under the duty rules; null while there is none. `overBy` is minutes (days for a `streak`). */
  alert: { flightNo: string; overBy: number; rule: DutyRule } | null;
};

export type Candidate = {
  id: string; family: StaffFamily; role: StaffRole; name: string; base: string; qual: string | null;
  experience: number; reliability: number; morale: number; askingSalary: number; noticeDays: number; premium: number;
};
export type CandidatesView = { market: number; candidates: Candidate[]; suggestion: { count: number; label: string } | null };
export type CandidateQuery = { family?: StaffFamily; base?: string; qual?: string };
export type HireResult = { member: StaffMember; startsAt: number; premium: number; balanceAfter: number };
export type TrainResult = { member: StaffMember; place: 'own' | 'outside'; cost: number; saved: number; days: number; until: number; balanceAfter: number };
export type InterimResult = { member: StaffMember; cost: number; endsAt: number; balanceAfter: number };

export type LeaveRequest = {
  id: number; staffId: number; name: string; family: StaffFamily; from: string; to: string; days: number; status: 'pending' | 'granted' | 'refused'; kind: 'leave' | 'rest' | 'training';
  /** Pending requests only: the coverage of the person's family on the worst day of the request, before and after granting it. */
  impact: { before: Coverage; after: Coverage; worstDay: string } | null;
};
/** `extraHeadcount` and `payrollDelta` are against the legal minimum, for this company's timetable. */
export type PolicyOption = { policy: RestPolicy; restBaseH: number; restAwayH: number; extraHeadcount: number; payrollDelta: number; riskFactor: number };
/** `type`: asked of S2 for the rows of the pilots ("Pilotes ATR"), so that a temp can be hired for the right aircraft. */
export type CoverageRow = { family: StaffFamily; label: string; type?: string; headcount: number; perDay: number; days: Coverage[] };
export type LeaveView = {
  balance: number; resting: number; restingPilots: number; avgFatigue: number;
  coverage: CoverageRow[];
  /** The first day each family is `short` or `none`. */
  alerts: { family: StaffFamily; day: string; coverage: Coverage }[];
  from: string; requests: LeaveRequest[]; policy: RestPolicy; policies: PolicyOption[];
};

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}
const qs = (o: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams(Object.entries(o).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));
  return p.size ? `?${p}` : '';
};

export const fetchStaff = (base?: string): Promise<StaffOverview | null> => optional<StaffOverview>(`/staff${qs({ base })}`);
export const fetchMember = (id: number): Promise<StaffDetail | null> => optional<StaffDetail>(`/staff/${id}`);
export const fetchCandidates = (q: CandidateQuery): Promise<CandidatesView | null> => optional<CandidatesView>(`/staff/candidates${qs({ ...q })}`);
export const fetchLeave = (from?: string, days?: number): Promise<LeaveView | null> => optional<LeaveView>(`/staff/leave${qs({ from, days })}`);

export const hireCandidate = (candidateId: string, startNow = false): Promise<HireResult> => api<HireResult>('/staff/hire', { method: 'POST', body: { candidateId, ...(startNow ? { startNow } : {}) } });
export const trainMember = (id: number, type: string): Promise<TrainResult> => api<TrainResult>(`/staff/${id}/train`, { method: 'POST', body: { type } });
export const restMember = (id: number): Promise<unknown> => api(`/staff/${id}/rest`, { method: 'POST', body: {} });
export const transferMember = (id: number, base: string): Promise<unknown> => api(`/staff/${id}/transfer`, { method: 'POST', body: { base } });
export const decideLeave = (id: number, decision: 'grant' | 'refuse'): Promise<unknown> => api(`/staff/leave/${id}`, { method: 'POST', body: { decision } });
export const setRestPolicy = (policy: RestPolicy): Promise<unknown> => api('/staff/rest-policy', { method: 'PUT', body: { policy } });
export const hireInterim = (p: { family: StaffFamily; days: number; qual?: string; base?: string }): Promise<InterimResult> => api<InterimResult>('/staff/interim', { method: 'POST', body: p });

export type StartNowResult = { member: StaffMember; fee: number; balanceAfter: number };
/** Pay START_NOW_FEE: a hire still in notice starts now. */
export const startNowMember = (id: number): Promise<StartNowResult> => api<StartNowResult>(`/staff/${id}/start-now`, { method: 'POST', body: {} });
