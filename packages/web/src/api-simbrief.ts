// Lot SIMBRIEF-LINK: typed client of docs/simbrief.md (the saved SimBrief identifier and the plan fetched for a flight).
import type { Flight, SimbriefLink } from '@opc/shared';
import { api } from './api.ts';

export const getLink = (): Promise<SimbriefLink> => api<SimbriefLink>('/me/simbrief');
export const connectLink = (who: { username: string } | { pilotId: number }): Promise<SimbriefLink> => api<SimbriefLink>('/me/simbrief', { method: 'PUT', body: who });
export const disconnectLink = (): Promise<void> => api<void>('/me/simbrief', { method: 'DELETE' });
/** Fetch the plan the player generated on SimBrief for this flight; the flight comes back with the planned fuel, route and plan id. */
export const fetchPlan = (flightId: number): Promise<Flight> => api<Flight>(`/flights/${flightId}/simbrief/fetch`, { method: 'POST' });
