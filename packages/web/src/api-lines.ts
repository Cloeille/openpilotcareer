import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the LINES section of docs/v3-plan.md (B.2).
 * The wire types are declared here until lot S1 publishes `shared/src/lines.ts`; they follow B.2 field for field, so switching is an import change.
 * A route the server does not have yet answers 404/405: `null` means "feature off", any other failure still throws.
 */

export type LineStatus = 'active' | 'paused' | 'interrupted';
export type InterruptCause = 'aircraft' | 'crew' | 'both';
export type LineAircraft = { id: number; registration: string; icao: string };
export type Line = {
  id: number; a: string; b: string; status: LineStatus; distanceNm: number; blockMinutes: number; freqPerDay: number;
  /** Monday first. */
  days: boolean[];
  /** 'HH:MM', UTC. */
  windowStart: string; windowEnd: string; turnaroundMin: number;
  flightNos: [number, number]; aircraft: LineAircraft[]; interruptedSince: number | null; interruptCause: InterruptCause | null;
};

export type FlightStatus = 'scheduled' | 'flying' | 'done' | 'delayed' | 'cancelled';
export type CancelCause = 'aircraft_unavailable' | 'no_crew' | 'duty_limit' | 'line_paused';
export type ScheduledFlight = {
  id: number; lineId: number; /** 'AZR 1131' */ flightNo: string; dep: number; arr: number; origin: string; dest: string; aircraftId: number;
  status: FlightStatus; delayMin: number; cancelCause: CancelCause | null; pax: number | null; takenByPlayer: boolean;
};
export type LineDay = { date: string; rotations: number; loadFactor: number; planned: boolean };
export type LineForecast = {
  weeklyDemand: number; loadFactor: number; seatsPerWeek: number; revenue: number; costs: number; profit: number; estimated: true;
  competition: { company: string; flightsPerDay: number } | null;
};
export type LineProblem = { kind: 'aircraft' | 'crew'; detail: string; ready: boolean; until: number | null };

export type FlyingNow = { flightId: number; flightNo: string; lineId: number | null; from: string; to: string; progress: number; delayMin: number; reg: string; own: boolean };
export type Network = {
  now: number; enabled: boolean; lines: Line[]; flying: FlyingNow[];
  today: { done: number; cancelled: number; onTimePct: number; nextDeparture: ScheduledFlight | null };
};
export type LineDetail = {
  line: Line; week: LineDay[]; day: ScheduledFlight[];
  kpis: { aircraft: number; freq: string; loadFactor: number; loadTrend7d: number; revenuePerDay: number; marginPerDay: number };
  pnl: { fuel: number; fees: number; crews: number; maintenance: number; margin: number; flights: number; pax: number };
  depends: { label: string; value: string; ok: boolean }[];
};
export type Programme = { a: string; b: string; freqPerDay: number; days: boolean[]; windowStart: string; windowEnd: string; aircraftIds: number[] };
export type Need = { required: number; available: number };
export type Forecast = {
  forecast: LineForecast; conflicts: { aircraftId: number; flightNo: string; at: number }[];
  needs: { pilots: Need; cabin: Need; ground: Need & { missingAt: string[] }; maintenance: string }; valid: boolean;
};
export type ProblemView = {
  problem: LineProblem[]; cost: { cancelled: number; lostRevenue: number; perDay: number; reputation: number };
  options: {
    reassign: { aircraft: { id: number; registration: string; icao: string; freeAt: number }[]; flightsPerDay: number; deltaPerDay: number } | null;
    recruit: { candidates: number; monthly: number; readyAt: number | null } | null;
    pause: { fixedCostPerDay: number };
  };
  projection: { date: string; status: string }[];
};
export type ResolveOption = 'reassign' | 'recruit' | 'pause';
export type OpsRow = ScheduledFlight & { reg: string; typeName: string; crew: string | null; note: string | null; own: boolean };
export type Ops = { now: number; enabled: boolean; counts: { flying: number; upcoming: number; cancelled: number; delayed: number }; flying: OpsRow[]; upcoming: OpsRow[] };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchNetwork = (company?: number): Promise<Network | null> => optional<Network>(`/network${company === undefined ? '' : `?company=${company}`}`);
export const fetchLine = (id: number, date?: string): Promise<LineDetail | null> => optional<LineDetail>(`/lines/${id}${date ? `?date=${date}` : ''}`);
export const fetchProblem = (id: number): Promise<ProblemView | null> => optional<ProblemView>(`/lines/${id}/problem`);
export const fetchOps = (): Promise<Ops | null> => optional<Ops>('/ops');

export const setNetworkEnabled = (enabled: boolean): Promise<unknown> => api('/network/enabled', { method: 'PUT', body: { enabled } });
export const forecastLine = (p: Programme): Promise<Forecast> => api<Forecast>('/lines/forecast', { method: 'POST', body: p });
export const createLine = (p: Programme): Promise<Line> => api<Line>('/lines', { method: 'POST', body: p });
export const pauseLine = (id: number): Promise<unknown> => api(`/lines/${id}/pause`, { method: 'POST', body: {} });
export const resumeLine = (id: number): Promise<unknown> => api(`/lines/${id}/resume`, { method: 'POST', body: {} });
export const deleteLine = (id: number): Promise<unknown> => api(`/lines/${id}`, { method: 'DELETE' });
export const resolveLine = (id: number, option: ResolveOption, aircraftId?: number): Promise<Line> =>
  api<Line>(`/lines/${id}/resolve`, { method: 'POST', body: { option, ...(aircraftId === undefined ? {} : { aircraftId }) } });
export const takeRotation = (lineId: number, flightId: number): Promise<{ job: { id: string }; reservedUntil: number }> =>
  api(`/lines/${lineId}/rotations/${flightId}/take`, { method: 'POST', body: {} });
