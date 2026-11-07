// Lot SIM-AIRCRAFT: the aircraft of the player's simulator. The bridge PUTs the scan with an API key; the web app reads it and hides or shows entries with the session.
import type { FastifyInstance } from 'fastify';
import { simAircraftHideSchema, simAircraftPutSchema } from '@opc/shared';
import { apiKeyAuth, sessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { HttpError, parse } from './http.ts';
import { saveSimAircraft, setSimAircraftHidden, simAircraftOf } from './simair.ts';

/** 2 000 entries of up to ~400 bytes: above the server's default 64 KiB body limit. */
const PUT_BODY_LIMIT = 1024 * 1024;

export function registerSimAircraft(app: FastifyInstance, { db, now }: { db: Db; now: () => number }): void {
  app.put('/api/v1/me/sim-aircraft', { bodyLimit: PUT_BODY_LIMIT }, async (req) => {
    const p = apiKeyAuth(db, req, now());
    return saveSimAircraft(db, p.userId, parse(simAircraftPutSchema, req.body).aircraft, now());
  });

  app.get('/api/v1/me/sim-aircraft', async (req) => simAircraftOf(db, sessionUser(db, req, now()).userId));

  app.patch('/api/v1/me/sim-aircraft', async (req) => {
    const p = sessionUser(db, req, now());
    const b = parse(simAircraftHideSchema, req.body);
    if (!setSimAircraftHidden(db, p.userId, b.title, b.hidden)) throw new HttpError(404, 'sim_aircraft_not_found', 'that aircraft is not in your simulator list');
    return simAircraftOf(db, p.userId);
  });
}
