import type { FastifyInstance } from 'fastify';
import { aircraftTypes } from './catalog.ts';

/** Real size of the aircraft catalogue, for the catalogue screen header: every ICAO type, and those with curated (non-derived) performance. */
export function registerCatalogueStats(app: FastifyInstance): void {
  let cached: { total: number; curated: number } | null = null;
  app.get('/api/v1/aircraft-types/stats', async () => {
    cached ??= { total: aircraftTypes.size, curated: [...aircraftTypes.values()].filter((t) => !t.derived).length };
    return cached;
  });
}
