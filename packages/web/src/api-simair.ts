// Typed client of the SIM-AIRCRAFT routes (docs/sim-aircraft.md): the aircraft the player's simulator has, as scanned by the bridge.
import type { AircraftType, SimAircraftList, SimAircraftPatch } from '@opc/shared';
import { api } from './api.ts';

export const getSimAircraft = (): Promise<SimAircraftList> => api<SimAircraftList>('/me/sim-aircraft');
const patch = (body: SimAircraftPatch): Promise<SimAircraftList> => api<SimAircraftList>('/me/sim-aircraft', { method: 'PATCH', body });
export const hideSimAircraft = (title: string, hidden: boolean): Promise<SimAircraftList> => patch({ title, hidden });
/** Sets the type the player picked for `title`; `null` clears it (the scan's own type, if any, applies again). */
export const setSimAircraftType = (title: string, icao: string | null): Promise<SimAircraftList> => patch({ title, icao });
/** The catalogue types a player can pick for a simulator aircraft: the curated ones matching `q` (the catalogue search also returns category estimates, which the server refuses). */
export const searchPickableTypes = (q: string): Promise<AircraftType[]> => api<AircraftType[]>(`/aircraft-types?q=${encodeURIComponent(q)}`).then((l) => l.filter((x) => !x.derived), (): AircraftType[] => []);
