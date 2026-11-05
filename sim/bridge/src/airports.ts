// Airport lookup for the bridge: the same data/airports.json the server uses, so ICAO codes always agree.
// ponytail: the bridge runs from a repository checkout (it reads ../../../data); a packaged build would bundle the file.
import { readFileSync } from 'node:fs';
import { distanceNm } from '@opc/shared';

type Row = [icao: string, name: string, lat: number, lon: number, ...rest: unknown[]];
const rows = (JSON.parse(readFileSync(new URL('../../../data/airports.json', import.meta.url), 'utf8')) as { rows: Row[] }).rows;

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
