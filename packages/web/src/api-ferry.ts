import type { FerryBooked, FerryPreview } from '@opc/shared';
import { api } from './api.ts';

/** Typed client of the ferry routes: `GET` prices an empty repositioning flight without booking it, `POST` books it. */
export const ferryPreview = (aircraftId: number, to: string): Promise<FerryPreview> => api<FerryPreview>(`/me/fleet/${aircraftId}/ferry?to=${encodeURIComponent(to)}`);
export const bookFerry = (aircraftId: number, to: string): Promise<FerryBooked> => api<FerryBooked>(`/me/fleet/${aircraftId}/ferry`, { method: 'POST', body: { to } });
