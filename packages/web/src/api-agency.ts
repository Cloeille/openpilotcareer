import type { AgencyCandidate, AgencyGap, AgencyOption, AgencyOptionId, AgencyQuote, AgencyView, MissionView, SignResult } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the AGENCY lot of docs/v4-plan.md (B.3): the recruiter mission. The wire types are the server's, from `@opc/shared` (`shared/src/agency.ts`).
 * A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros and computed by the server (a quote carries the balance after it); instants are epoch milliseconds.
 */
export type { AgencyCandidate, AgencyGap, AgencyOption, AgencyOptionId, AgencyQuote, AgencyView, MissionView, SignResult };

/** The position a comparison is for. */
export type AgencyRequest = { base: string; qual: string; count: number };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

/** `request` absent: the server takes the open mission, else the position that costs the most. `pick`: the candidates to price (the first ones when absent). */
export function fetchAgency(request?: AgencyRequest | null, pick?: readonly string[]): Promise<AgencyView | null> {
  const q = new URLSearchParams();
  if (request) { q.set('base', request.base); q.set('qual', request.qual); q.set('count', String(request.count)); }
  if (pick) q.set('pick', pick.join(','));
  return optional<AgencyView>(`/agency/options${q.size ? `?${q}` : ''}`);
}
export const openMission = (request: AgencyRequest): Promise<MissionView> => api<MissionView>('/agency/missions', { method: 'POST', body: request });
export const signMission = (id: number, candidateIds: readonly string[]): Promise<SignResult> => api<SignResult>(`/agency/missions/${id}/sign`, { method: 'POST', body: { candidateIds } });
export const cancelMission = (id: number): Promise<unknown> => api(`/agency/missions/${id}`, { method: 'DELETE' });
