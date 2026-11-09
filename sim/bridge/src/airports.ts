// Airport lookup for the bridge: the same data/airports.json the server uses, so ICAO codes always agree.
// The JSON is imported, not read from disk, so the single-file Windows build (scripts/build-win.ts) carries it inside the exe.
import { distanceNm } from '@opc/shared';
import airportsFile from '../../../data/airports.json' with { type: 'json' };

type Row = [icao: string, name: string, lat: number, lon: number, ...rest: unknown[]];
const rows = (airportsFile as unknown as { rows: Row[] }).rows;

export const airportPosition = (icao: string): { lat: number; lon: number } | null => {
  const r = rows.find((x) => x[0] === icao);
  return r ? { lat: r[2], lon: r[3] } : null;
};

/** ICAO of the airport closest to the point, or null when none is within `maxNm` (off-airport takeoff or landing). */
export function nearestAirport(lat: number, lon: number, maxNm: number): string | null {
  let best: string | null = null;
  let bestNm = maxNm;
  for (const [icao, , alat, alon] of rows) {
    const d = distanceNm(lat, lon, alat, alon);
    if (d <= bestNm) { best = icao; bestNm = d; }
  }
  return best;
}

/** Is the point within `maxNm` of the reference point of this airport? False for an ICAO the data does not list. */
export const isNearAirport = (lat: number, lon: number, icao: string, maxNm: number): boolean => {
  const at = airportPosition(icao);
  return at !== null && distanceNm(lat, lon, at.lat, at.lon) <= maxNm;
};
