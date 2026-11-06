import type { Flight, Transaction } from '@opc/shared';
import { api } from './api.ts';

/** Flights of the active company, newest first (the API's page maximum). */
export const loadFlights = (): Promise<Flight[]> => api<Flight[]>('/me/flights?limit=200');
export const loadLedger = (): Promise<Transaction[]> => api<Transaction[]>('/me/transactions?limit=100');

/** One flight by id: from the recent list, else by paging back (the API has no single-flight route). */
export async function loadFlight(id: number): Promise<Flight | null> {
  let before: number | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await api<Flight[]>(`/me/flights?limit=200${before ? `&before=${before}` : ''}`);
    const hit = batch.find((f) => f.id === id);
    if (hit) return hit;
    if (batch.length < 200) return null;
    before = batch[batch.length - 1]!.id;
  }
  return null;
}
