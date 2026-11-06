import type { AircraftType, ApiKeyInfo } from '@opc/shared';
import { api, session } from './api.ts';
import { ApiError } from './errors.ts';
import type { FleetAircraftV2, FirstJob, FleetQuote, HubSuggestion, LeaseOffer, MeV2, NewCompanyBody, Onboarding, OnboardingStep, Realism, RealismPreset, RealismToggle, StartMode } from './onboarding-types.ts';

// Typed client for the START / FINANCE sections of docs/v2-contract.md. The shapes are mirrored here (not imported)
// so this lot builds before lots be-start / be-finance are merged; after the merge they can be swapped for the shared types.

export * from './onboarding-types.ts';

const notThere = (e: unknown): boolean => e instanceof ApiError && (e.status === 404 || e.status === 405);

// ---------------------------------------------------------------- onboarding (START)

/** null when the server predates onboarding (no such route): the web app then behaves as before. */
export async function getOnboarding(): Promise<Onboarding | null> {
  try { return await api<Onboarding>('/onboarding'); } catch (e) { if (notThere(e)) return null; throw e; }
}
export const putOnboarding = (body: { step?: OnboardingStep; startMode?: StartMode; draft?: Record<string, unknown> }): Promise<Onboarding> =>
  api<Onboarding>('/onboarding', { method: 'PUT', body });
export const completeOnboarding = (): Promise<Onboarding> => api<Onboarding>('/onboarding/complete', { method: 'POST', body: {} });

export const hubSuggestions = (mode: StartMode, q: string): Promise<HubSuggestion[]> =>
  api<HubSuggestion[]>(`/onboarding/hubs?mode=${mode}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
export const codeAvailable = async (code: string): Promise<boolean> => (await api<{ available: boolean }>(`/airlines/code/${encodeURIComponent(code)}`)).available;

export const createOnboardingCompany = (body: NewCompanyBody): Promise<MeV2> => api<MeV2>('/me/companies', { method: 'POST', body });
export const getMe = (): Promise<MeV2> => api<MeV2>('/me');
export const setRealism = (companyId: number, body: { preset: RealismPreset } | { toggles: Partial<Record<RealismToggle, boolean>> }): Promise<Realism> =>
  api<Realism>(`/companies/${companyId}/realism`, { method: 'PUT', body });
export const firstJob = (companyId: number): Promise<FirstJob> => api<FirstJob>(`/companies/${companyId}/first-job`);
export const acceptJob = (jobId: string, aircraftId: number): Promise<unknown> => api(`/jobs/${encodeURIComponent(jobId)}/accept`, { method: 'POST', body: { aircraftId } });

// ---------------------------------------------------------------- first aircraft (FINANCE)

export const leaseOffers = (hub: string, icao?: string): Promise<LeaseOffer[]> =>
  api<LeaseOffer[]>(`/leasing/offers?hub=${hub}${icao ? `&icao=${icao}` : ''}`);
export const leaseAircraft = (offerId: LeaseOffer['id'], months: number, hub: string): Promise<{ aircraft: FleetAircraftV2; firstPayment: number; balanceAfter: number }> =>
  api('/me/leases', { method: 'POST', body: { offerId, months, hub } });
export const fleetQuote = (icao: string, hub: string): Promise<FleetQuote> => api<FleetQuote>(`/me/fleet/quote?icao=${icao}&hub=${hub}`);
export const buyFinanced = (icao: string, hub: string, financing: { downPct: number; months: number }): Promise<unknown> =>
  api('/me/fleet', { method: 'POST', body: { icao, hub, financing } });
export const clubRental = (hub: string, icao: string): Promise<unknown> => api('/me/club-rental', { method: 'POST', body: { hub, icao } });
export const monthlyRental = (hub: string, icao: string): Promise<unknown> => api('/me/monthly-rental', { method: 'POST', body: { hub, icao } });

const types = new Map<string, Promise<AircraftType | null>>();
/** Seats, range and the rest of an aircraft type; null when the catalogue does not know it. Cached per server. */
export function aircraftType(icao: string): Promise<AircraftType | null> {
  const key = `${session.server}|${icao}`;
  let p = types.get(key);
  if (!p) types.set(key, (p = api<AircraftType>(`/aircraft-types/${icao}`).catch(() => null)));
  return p;
}

// ---------------------------------------------------------------- simulator bridge

export const BRIDGE_STATUS_URL = 'http://127.0.0.1:7878/status';
export type BridgeStatus = { version?: string; sim?: 'connected' | 'waiting' | 'unavailable'; phase?: string; flight?: unknown; serverUrl?: string };
/** The bridge on the player's own PC (loopback, CORS *). null = nothing answered. */
export async function bridgeStatus(): Promise<BridgeStatus | null> {
  try {
    const res = await fetch(BRIDGE_STATUS_URL, { signal: AbortSignal.timeout(1500), cache: 'no-store' });
    return res.ok ? ((await res.json()) as BridgeStatus) : null;
  } catch { return null; }
}

export const apiKeys = (): Promise<ApiKeyInfo[]> => api<ApiKeyInfo[]>('/me/api-keys');
export const createApiKey = (label: string): Promise<ApiKeyInfo & { key: string }> => api('/me/api-keys', { method: 'POST', body: { label } });
export const downloadUrl = (): string => `${session.server}/downloads/opc-bridge-win-x64.exe`;
/** Size in bytes of the bridge installer, or null when the server does not host it. */
export async function downloadSize(): Promise<number | null> {
  try {
    const res = await fetch(downloadUrl(), { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    const n = Number(res.headers.get('content-length'));
    return res.ok ? (Number.isFinite(n) && n > 0 ? n : 0) : null;
  } catch { return null; }
}
