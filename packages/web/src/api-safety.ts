import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the SAFETY section of docs/v3-plan.md (B.5).
 * The wire types are declared here until lot S4's `shared/src/safety.ts` is merged; switching is an import change (see "Implementation notes (F4)").
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Instants are epoch milliseconds, money is euros, and a probability is a fraction (0.018 is 1,8 %).
 */

export type SafetyScore = { points: number; max: number };
export type RiskPoint = { dutyHours: number; risk: number };
/** One flight of today. `factor`: how many times the average risk. `dutyHours`: asked of S4 (optional); without it the flight has no dot on the curve. */
export type TodayFlight = { flightNo: string; crew: string; risk: number; factor: number; dutyHours?: number };
export type LeverAction = 'crew' | 'maintenance' | 'leave';
/** A computed action with its deep link: `ref` is a staff id for `crew` and an aircraft id for `maintenance`. */
export type Lever = { label: string; detail: string; points: number; action: LeverAction; ref: string };
/** `insuranceDelta`: the premium rise as a fraction (0.12 is +12 %); `insuranceFrom`: the first month it applies (`2026-12` or an ISO date). */
export type SafetySeason = { total: number; covered: number; borne: number; insuranceFrom: string | null; insuranceDelta: number };

export type SafetyView = {
  index: number; delta7d: number;
  parts: { fatigue: SafetyScore; aircraft: SafetyScore; training: SafetyScore };
  riskCurve: RiskPoint[]; today: TodayFlight[]; levers: Lever[]; season: SafetySeason;
};

export type IncidentSeverity = 'minor' | 'serious' | 'grave';
/** A row of `incidents`. `covered` is the insured part of `cost`; `downtimeUntil` is null for a grave one (the aircraft is grounded until the player decides). */
export type Incident = {
  id: number; at: number; flightId: number | null; aircraftId: number; severity: IncidentSeverity; kind: string; title: string; detail: string;
  cost: number; covered: number; downtimeUntil: number | null;
  /** Stored points on the 0..100 scale (C17): 0, -2, -6. */
  reputationDelta: number;
};

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchSafety = (): Promise<SafetyView | null> => optional<SafetyView>('/safety');
export const fetchIncidents = (season?: string): Promise<Incident[] | null> => optional<Incident[]>(`/safety/incidents${season ? `?season=${encodeURIComponent(season)}` : ''}`);
