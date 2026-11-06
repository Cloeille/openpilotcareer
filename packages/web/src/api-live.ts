import type { LiveState } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/** Latest live state of an active flight; null when the server does not know the flight (or has no live route). */
export async function fetchLive(flightId: number): Promise<LiveState | null> {
  try {
    return await api<LiveState>(`/flights/${flightId}/live`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}
