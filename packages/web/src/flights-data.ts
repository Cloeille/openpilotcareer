import type { AircraftLine, Flight, HistoryEntry, Transaction } from '@opc/shared';
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

const PAGE = 200;
const MAX_PAGES = 15;
export type HistoryPage = { entries: HistoryEntry[]; /** Older entries exist than the ones loaded. */ more: boolean };

/** The log of the active company (flights and line legs), newest first: `pages` pages of 200, then as many more as it takes to reach back to `since` (the start of the month the header sums), 15 pages at most. */
export async function loadHistory(pages: number, since: number): Promise<HistoryPage> {
  const entries: HistoryEntry[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const last = entries[entries.length - 1];
    if (page >= pages && last !== undefined && last.at < since) return { entries, more: true };
    const batch = await api<HistoryEntry[]>(`/me/history?limit=${PAGE}${last ? `&before=${last.cursor}` : ''}`);
    entries.push(...batch);
    if (batch.length < PAGE) return { entries, more: false };
  }
  return { entries, more: true };
}

/** The latest `n` entries of the company's lines (legs that left and cancelled ones), newest first. */
export const loadLineLegs = (n: number): Promise<HistoryEntry[]> => api<HistoryEntry[]>(`/me/history?source=lines&limit=${n}`);

/** What each aircraft of a line is doing now. */
export const loadAircraftLines = (): Promise<AircraftLine[]> => api<AircraftLine[]>('/network/aircraft');
