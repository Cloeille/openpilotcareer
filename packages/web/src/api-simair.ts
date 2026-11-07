// Typed client of the SIM-AIRCRAFT routes (docs/sim-aircraft.md): the aircraft the player's simulator has, as scanned by the bridge.
import type { SimAircraftList } from '@opc/shared';
import { api } from './api.ts';

export const getSimAircraft = (): Promise<SimAircraftList> => api<SimAircraftList>('/me/sim-aircraft');
export const hideSimAircraft = (title: string, hidden: boolean): Promise<SimAircraftList> => api<SimAircraftList>('/me/sim-aircraft', { method: 'PATCH', body: { title, hidden } });
