import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the STAFF section of docs/v3-plan.md (B.3).
 * The wire types are declared here until lot S2's `shared/src/staff.ts` is merged: they are B.3 field for field, and where B.3 wrote `{...}` or left a shape open the choice is listed in "Implementation notes (F2)".
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Days are ISO dates (`2026-11-06`, UTC); instants are epoch milliseconds; durations are minutes unless the name says hours.
 */

export type StaffFamily = 'pilot' | 'cabin' | 'ground' | 'admin' | 'maintenance' | 'kitchen';
export type Coverage = 'ok' | 'tight' | 'short' | 'none';
export type RestPolicy = 'legal' | 'standard' | 'generous';

export type StaffRef = { id: number; name: string; /** 'captain' | 'fo' for pilots. */ role: string };
export type Availability = { onDuty: number; resting: number; leave: number; training: number; vacant: number };
export type FamilyRow = {
  family: StaffFamily; label: string;
  /** Set on the per-type children of the pilots (ICAO code). */
  type?: string;
  headcount: number; need: number; availability: Availability; salaries: number;
  /** What to watch on this row, in the server's words; null when there is nothing to say. */
  note: string | null;
  /** The named pilots of a per-type row, in the order the member sheet steps through them. */
  members?: StaffRef[];
  children?: FamilyRow[];
};
export type Blocker = { family: StaffFamily; type: string | null; title: string; detail: string; flights: string[]; aircraft: string | null; missing: string; lostPerDay: number };
export type WatchItem = { text: string; effect: string; staffId: number | null };
export type StaffOverview = { people: number; positions: number; payroll: number; families: FamilyRow[]; blockers: Blocker[]; watch: WatchItem[] };

export type StaffMember = {
  id: number; family: StaffFamily; name: string; /** 'captain' | 'fo' | 'chief' | 'technician' ... */ role: string; base: string; hiredAt: number; salary: number;
  /** 0..100 */ reliability: number; /** 0..100 */ morale: number; status: 'active' | 'leaving'; medicalUntil: number | null; contract: 'cdi' | 'cdd'; noticeDays: number; poolCount: number;
  /** Career flight hours and the part flown on the main type; null when the server does not know. */
  flightHours: number | null; typeHours: number | null; typeName: string | null;
};
export type DutyState = {
  dutyMin: number; limitMin: number; startedAt: number | null; endsAt: number | null; restHours: number; remaining: { flights: number; minutes: number };
  service7dMin: number; flight28dMin: number; flight12mMin: number; limits: { service7dMin: number; flight28dMin: number; flight12mMin: number };
  fatigue: number; medicalDays: number | null;
};
export type DutyBlock = { kind: 'brief' | 'flight' | 'pause'; flightNo: string | null; origin: string | null; dest: string | null; start: number; end: number; status: 'done' | 'flying' | 'planned'; over: boolean };
export type DutyDay = { day: string; hours: number | null; kind: 'duty' | 'rest' | 'planned'; plannedHours?: number };
export type Qualification = { type: string; name: string; held: boolean; validUntil: number | null; training: { days: number; cost: number } | null; note: string | null };
export type StaffDetail = {
  member: StaffMember; duty: DutyState; week: DutyBlock[]; last7d: DutyDay[]; quals: Qualification[];
  contract: { kind: 'cdi' | 'cdd'; noticeDays: number; usualLine: string | null; preferredCrew: string | null };
  nextLeave: { from: string; to: string } | null;
  alert: { flightNo: string; overBy: number; detail: string } | null;
};

export type TrainingOffer = { staffId: number; name: string; type: string; days: number; cost: number; leaves: string | null };
export type Candidate = {
  id: string; name: string; family: StaffFamily; role: string; quals: string[]; experienceH: number | null; previous: string; flags: string[];
  base: string; prefersBase: string | null; reliability: number; morale: number; salary: number; availableAt: number; noticeDays: number;
};
export type CandidateList = { market: number; candidates: Candidate[]; suggestion: { count: number; label: string; pilot: TrainingOffer | null } | null };
export type CandidateQuery = { family?: StaffFamily; base?: string; qual?: string };
export type HireResult = { member: StaffMember; startsAt: number; premium: number; balanceAfter: number };

export type CoverageRow = { family: string; label: string; headcount: number; perDay: number; days: Coverage[] };
export type CoverageAlert = { family: string; day: string; available: number; needed: number; detail: string; flights: string[]; interim: { qual: string; days: number; cost: number } | null };
export type LeaveRequest = { id: number; staffId: number; name: string; family: StaffFamily; kind: 'leave' | 'rest' | 'training'; from: string; to: string; days: number; status: 'pending' | 'granted' | 'refused'; impact: { ok: boolean; detail: string } };
export type PolicyOption = {
  id: RestPolicy; rest: { baseH: number; awayH: number; dutyDays: number; weeklyH: number; nights: number };
  /** Against the policy in force: people to add, payroll per month, the average fatigue it would settle at, the change in incident risk (-0.3 = 30 % lower). */
  extraHeadcount: number; payrollDelta: number; fatigueAfter: number; riskDelta: number;
};
export type LeaveView = {
  from: string; days: number; balance: number; resting: number; restingPilots: number; avgFatigue: number;
  coverage: CoverageRow[]; alerts: CoverageAlert[]; requests: LeaveRequest[]; policy: RestPolicy; policies: PolicyOption[];
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
export const fetchCandidates = (q: CandidateQuery): Promise<CandidateList | null> => optional<CandidateList>(`/staff/candidates${qs({ ...q })}`);
export const fetchLeave = (from: string, days: number): Promise<LeaveView | null> => optional<LeaveView>(`/staff/leave${qs({ from, days })}`);

export const hireCandidate = (candidateId: string): Promise<HireResult> => api<HireResult>('/staff/hire', { method: 'POST', body: { candidateId } });
export const trainMember = (id: number, type: string): Promise<unknown> => api(`/staff/${id}/train`, { method: 'POST', body: { type } });
export const restMember = (id: number): Promise<unknown> => api(`/staff/${id}/rest`, { method: 'POST', body: {} });
export const transferMember = (id: number, base: string): Promise<unknown> => api(`/staff/${id}/transfer`, { method: 'POST', body: { base } });
export const decideLeave = (id: number, decision: 'grant' | 'refuse'): Promise<unknown> => api(`/staff/leave/${id}`, { method: 'POST', body: { decision } });
export const setRestPolicy = (policy: RestPolicy): Promise<unknown> => api('/staff/rest-policy', { method: 'PUT', body: { policy } });
export const hireInterim = (p: { family: StaffFamily; qual: string; days: number }): Promise<unknown> => api('/staff/interim', { method: 'POST', body: p });
