import type { LineBridge, LineStartNow, NetworkView, ResolveOption, Scope } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the LINES section of docs/v3-plan.md (B.2).
 * The wire types are declared here until lot S1's `shared/src/lines.ts` is merged; they are that file's types field for field (`Line`, `ScheduledFlight`, `NetworkView`, `LineDetail`, `LineForecastView`, `LineProblemView`, `OpsView`, `LineBody` is its zod body), so switching is an import change.
 * A route the server does not have yet answers 404/405: `null` means "feature off", any other failure still throws.
 */

export type LineStatus = 'active' | 'paused' | 'interrupted';
export type LineInterruptCause = 'aircraft' | 'crew' | 'both';
export type LineAircraft = { id: number; registration: string; icao: string };
export type Line = {
  id: number; a: string; b: string; status: LineStatus; distanceNm: number; blockMinutes: number; freqPerDay: number;
  /** Monday first. */
  days: boolean[];
  /** 'HH:MM', UTC. */
  windowStart: string; windowEnd: string; turnaroundMin: number;
  flightNos: [number, number]; aircraft: LineAircraft[]; interruptedSince: number | null; interruptCause: LineInterruptCause | null;
};

export type ScheduledFlightStatus = 'scheduled' | 'flying' | 'done' | 'delayed' | 'cancelled';
export type CancelCause = 'aircraft_unavailable' | 'no_crew' | 'duty_limit' | 'line_paused';
export type DelayCause = 'wear' | 'late_inbound';
export type ScheduledFlight = {
  id: number; lineId: number | null; /** 'AZR 1131' */ flightNo: string; dep: number; arr: number; origin: string; dest: string; aircraftId: number;
  status: ScheduledFlightStatus; delayMin: number; delayCause: DelayCause | null; cancelCause: CancelCause | null; pax: number | null; takenByPlayer: boolean;
};
export type LineDay = { date: string; rotations: number; loadFactor: number; planned: boolean };
export type LineForecast = {
  weeklyDemand: number; loadFactor: number; seatsPerWeek: number; revenue: number; costs: number; profit: number; estimated: true;
  competition: { company: string; flightsPerDay: number } | null;
};
export type LineProblem = { kind: 'aircraft' | 'crew'; detail: string; ready: boolean; until: number | null };

export type { FlyingRow, NetworkLine, NetworkView } from '@opc/shared';
export type DependencyKey = 'aircraft' | 'crew' | 'maintenance' | 'network';
export type LineDetail = {
  line: Line; week: LineDay[]; day: ScheduledFlight[];
  /** Without a finished leg in the last 7 days the money figures are the model's expectation (`estimated`). */
  kpis: { aircraft: number; freq: string; loadFactor: number; loadTrend7d: number; revenuePerDay: number; marginPerDay: number; estimated: boolean };
  pnl: { revenue: number; fuel: number; fees: number; crews: number; maintenance: number; margin: number; flights: number; pax: number };
  depends: { key: DependencyKey; label: string; value: string; ok: boolean }[];
};
export type LineBody = { a: string; b: string; freqPerDay: number; days: boolean[]; windowStart: string; windowEnd: string; turnaroundMin?: number; aircraftIds: number[] };
/** Body of `PATCH /lines/:id` and `POST /lines/:id/forecast`: the programme without its route (any field left out keeps the line's own). */
export type LinePatch = Omit<LineBody, 'a' | 'b'>;
export type Need = { required: number; available: number };
export type LineForecastView = {
  forecast: LineForecast; conflicts: { aircraftId: number; flightNo: number; at: number }[];
  /** Codes of the `POST /lines` errors the programme would meet; empty when `valid`. */
  problems: string[];
  needs: { pilots: Need; cabin: Need; ground: Need & { missingAt: string[] }; maintenance: string };
  /** False until the staff lot merges: `available` then mirrors `required`. */
  crewModelled: boolean;
  valid: boolean;
};
export type FreeAircraft = { id: number; registration: string; icao: string; freeAt: number };
export type ProjectionStatus = 'assured' | 'stopped' | 'off';
export type LineProblemView = {
  problem: LineProblem[];
  /** `reputation` is in stored points and negative; `slotsLostAt` is when 14 days of stoppage forfeit the slots. */
  cost: { cancelled: number; lostRevenue: number; perDay: number; reputation: number; slotsLostAt: number | null };
  options: {
    reassign: { aircraft: FreeAircraft[]; flightsPerDay: number; deltaPerDay: number } | null;
    /** `premium`: paid now; `bridge`: the interim that `withInterim` adds, ending when the hires arrive. */
    recruit: { candidates: number; monthly: number; readyAt: number | null; premium: number; bridge: LineBridge | null } | null;
    /** Temporary hires who start now and leave as the recruits arrive; null when the crew is complete. */
    interim: LineBridge | null;
    /** The hires in notice started now for START_NOW_FEE each; null unless they fill every missing position. */
    startNow: LineStartNow | null;
    pause: { fixedCostPerDay: number };
  };
  projection: { date: string; status: ProjectionStatus }[];
};
export type { LineBridge, LineStartNow, ResolveOption };
export type OpsRow = ScheduledFlight & { reg: string; typeName: string; crew: string | null; note: string | null; own: boolean };
export type OpsView = { now: number; enabled: boolean; counts: { flying: number; upcoming: number; cancelled: number; delayed: number }; flying: OpsRow[]; upcoming: OpsRow[] };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchNetwork = (o: { company?: number; scope?: Scope } = {}): Promise<NetworkView | null> =>
  optional<NetworkView>(`/network${o.company !== undefined ? `?company=${o.company}` : o.scope === 'group' ? '?scope=group' : ''}`);
export const fetchLine = (id: number, date?: string): Promise<LineDetail | null> => optional<LineDetail>(`/lines/${id}${date ? `?date=${date}` : ''}`);
export const fetchProblem = (id: number): Promise<LineProblemView | null> => optional<LineProblemView>(`/lines/${id}/problem`);
export const fetchOps = (): Promise<OpsView | null> => optional<OpsView>('/ops');

export const setNetworkEnabled = (enabled: boolean): Promise<unknown> => api('/network/enabled', { method: 'PUT', body: { enabled } });
export const forecastLine = (p: LineBody): Promise<LineForecastView> => api<LineForecastView>('/lines/forecast', { method: 'POST', body: p });
export const forecastLinePatch = (id: number, p: LinePatch): Promise<LineForecastView> => api<LineForecastView>(`/lines/${id}/forecast`, { method: 'POST', body: p });
export const createLine = (p: LineBody): Promise<Line> => api<Line>('/lines', { method: 'POST', body: p });
export const patchLine = (id: number, p: LinePatch): Promise<Line> => api<Line>(`/lines/${id}`, { method: 'PATCH', body: p });
export const pauseLine = (id: number): Promise<unknown> => api(`/lines/${id}/pause`, { method: 'POST', body: {} });
export const resumeLine = (id: number): Promise<unknown> => api(`/lines/${id}/resume`, { method: 'POST', body: {} });
export const deleteLine = (id: number): Promise<unknown> => api(`/lines/${id}`, { method: 'DELETE' });
export const resolveLine = (id: number, option: ResolveOption, extra: { aircraftId?: number; withInterim?: boolean } = {}): Promise<Line> =>
  api<Line>(`/lines/${id}/resolve`, { method: 'POST', body: { option, ...extra } });
export const takeRotation = (lineId: number, flightId: number): Promise<{ job: { id: string }; reservedUntil: number }> =>
  api(`/lines/${lineId}/rotations/${flightId}/take`, { method: 'POST', body: {} });
