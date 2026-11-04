import { readFileSync } from 'node:fs';
import { resolveCatalogEntry, fallbackAircraft, type Airport, type AircraftType, type AirportSize, type CatalogEntry } from '@opc/shared';

const DATA = new URL('../../../data/', import.meta.url);
const readJson = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DATA), 'utf8')) as T;

type AirportFile = { columns: string[]; rows: [string, string, number, number, AirportSize, string, string, string][] };

export const aircraftTypes = new Map<string, AircraftType>(
  readJson<CatalogEntry[]>('aircraft-types.json').map((e) => [e.icao, resolveCatalogEntry(e)]),
);

export const airportList: Airport[] = readJson<AirportFile>('airports.json').rows.map(
  ([icao, name, lat, lon, size, country, city, iata]) => ({ icao, name, lat, lon, size, country, city, iata }),
);
export const airports = new Map(airportList.map((a) => [a.icao, a]));

/** Catalog type, or the category fallback for an unknown designator: every ICAO is flyable. */
export const catalogType = (icao: string): AircraftType => aircraftTypes.get(icao) ?? fallbackAircraft(icao);

const SIZE_RANK: Record<AirportSize, number> = { large: 0, medium: 1, small: 2 };

export function searchAirports(q: string, limit = 20): Airport[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const score = (a: Airport): number => {
    const icao = a.icao.toLowerCase();
    if (icao === s || a.iata.toLowerCase() === s) return 0;
    if (icao.startsWith(s)) return 1;
    if (a.city.toLowerCase().includes(s) || a.name.toLowerCase().includes(s)) return 2;
    return 9;
  };
  return airportList
    .map((a) => [score(a), a] as const)
    .filter(([sc]) => sc < 9)
    .sort((x, y) => x[0] - y[0] || SIZE_RANK[x[1].size] - SIZE_RANK[y[1].size] || x[1].icao.localeCompare(y[1].icao))
    .slice(0, limit)
    .map(([, a]) => a);
}

export function searchAircraftTypes(q: string, limit = 30): AircraftType[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hits: [number, AircraftType][] = [];
  for (const t of aircraftTypes.values()) {
    const icao = t.icao.toLowerCase();
    const score = icao === s ? 0 : icao.startsWith(s) ? 1 : t.name.toLowerCase().includes(s) ? 2 : 9;
    if (score < 9) hits.push([score, t]);
  }
  // curated (non-derived) first: they are the types people actually look for
  return hits.sort((x, y) => x[0] - y[0] || Number(x[1].derived) - Number(y[1].derived) || x[1].icao.localeCompare(y[1].icao)).slice(0, limit).map(([, t]) => t);
}
