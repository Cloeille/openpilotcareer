import type { Airport } from '@opc/shared';
import { api, session } from './api.ts';

const cache = new Map<string, Promise<Airport | null>>();

/** Airport facts (name, city, size) from the server, cached per server; null when unknown or unreachable. */
export function airportInfo(icao: string): Promise<Airport | null> {
  const key = `${session.server}|${icao}`;
  let p = cache.get(key);
  if (!p) {
    p = api<Airport>(`/airports/${icao}`).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/** `Nice, Alpes-Maritimes` -> `Nice`. */
export const cityOf = (a: Airport): string => a.city.split(',')[0]!.trim();

/** Fill `el` with the city of `icao` once it is known; the code stays on screen meanwhile. */
export function fillCity(el: HTMLElement, icao: string): void {
  void airportInfo(icao).then((a) => { if (a) el.textContent = cityOf(a); });
}
