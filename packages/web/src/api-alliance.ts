import type { AllianceView, BallotChoice, FoundAllianceRequest, Invitation, InviteRequest } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/** Typed client for the ALLIANCE section of docs/v4-plan.md (B.3). The wire types are `@opc/shared`'s (`shared/src/alliance.ts`). `view` is the player's alliance; null while the active company is in none (the server answers
 *  404 `not_in_alliance`, which says no more than that), and then `invitations` are the alliances that voted it in. `fetchAlliance` answers null when the server has no alliance routes (404/405 without that code): feature off. */
export type AllianceData = { view: AllianceView | null; invitations: Invitation[] };

export async function fetchAlliance(): Promise<AllianceData | null> {
  try {
    return { view: await api<AllianceView>('/alliance'), invitations: [] };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 404 && e.code === 'not_in_alliance') return { view: null, invitations: await api<Invitation[]>('/alliance/invitations') };
    if (e.status === 404 || e.status === 405) return null;
    throw e;
  }
}
export const foundAlliance = (body: FoundAllianceRequest): Promise<AllianceView> => api<AllianceView>('/alliance', { method: 'POST', body });
export const inviteCompany = (body: InviteRequest): Promise<AllianceView> => api<AllianceView>('/alliance/invite', { method: 'POST', body });
export const castBallot = (voteId: number, choice: BallotChoice): Promise<AllianceView> => api<AllianceView>(`/alliance/votes/${voteId}/ballot`, { method: 'POST', body: { choice } });
export const joinAlliance = (voteId: number): Promise<AllianceView> => api<AllianceView>(`/alliance/invitations/${voteId}/join`, { method: 'POST' });
export const leaveAlliance = (): Promise<AllianceView> => api<AllianceView>('/alliance/leave', { method: 'POST' });
