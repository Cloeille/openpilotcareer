// Lot SIMBRIEF-LINK: the SimBrief identifier saved on an account, and fetching the plan made for one flight. See docs/simbrief.md.
// The identifier (username or Pilot ID) is public, not a secret, and Navigraph/SimBrief offer third parties no sign-in: the player
// stays signed in to simbrief.com in their own browser. The OFP itself is never stored or logged, only fuel, route and its id.
import type { FastifyInstance } from 'fastify';
import { simbriefConnectSchema } from '@opc/shared';
import { sessionAuth, sessionUser } from './auth.ts';
import { get, run, tx, type Db } from './db.ts';
import { activeFlight, flightView, type FlightRow } from './game.ts';
import { HttpError, Limiter, NUMERIC_ID, parse } from './http.ts';
import { fetchOfp, linkOf, lookupAccount, ofpMismatch, saveLink, type Fetch, type OfpQuery } from './simbrief.ts';

export type SimbriefCtx = { db: Db; now: () => number; doFetch: Fetch };

/** SimBrief asks apps to call only on a user action and not to hammer it; every call below is user-triggered, this keeps a stuck client from looping. */
const CALLS_PER_MINUTE = 12;

export function registerSimbrief(app: FastifyInstance, { db, now, doFetch }: SimbriefCtx): void {
  const limiter = new Limiter(CALLS_PER_MINUTE, 60_000, now);

  app.get('/api/v1/me/simbrief', async (req) => linkOf(db, sessionUser(db, req, now()).userId));

  // Verify against SimBrief first (unknown account: 422), then save. A username lookup also learns the Pilot ID, which is what finds one exact plan later.
  app.put('/api/v1/me/simbrief', async (req) => {
    const p = sessionUser(db, req, now());
    const b = parse(simbriefConnectSchema, req.body);
    limiter.hit(`connect:${p.userId}`);
    const query: OfpQuery = 'pilotId' in b ? { pilotId: b.pilotId } : { username: b.username };
    const found = await lookupAccount(query, doFetch);
    const link = { username: 'username' in b ? b.username : null, pilotId: 'pilotId' in b ? b.pilotId : found.pilotId, verifiedAt: now() };
    saveLink(db, p.userId, link);
    return link;
  });

  app.delete('/api/v1/me/simbrief', async (req, reply) => {
    saveLink(db, sessionUser(db, req, now()).userId, { username: null, pilotId: null, verifiedAt: null });
    return reply.status(204).send();
  });

  // The plan the player generated on SimBrief for this flight: exactly the one made under the flight's static id when the Pilot ID is known, else the account's latest.
  app.post('/api/v1/flights/:id/simbrief/fetch', async (req) => {
    const p = sessionAuth(db, req, now());
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'flight_not_found', 'flight not found');
    const f = activeFlight(db, Number(raw), p.userId, p.companyId);
    const link = linkOf(db, p.userId);
    if (link.pilotId === null && link.username === null) throw new HttpError(409, 'simbrief_not_connected', 'connect your SimBrief account in the settings first');
    limiter.hit(`fetch:${p.userId}`);
    const query: OfpQuery = link.pilotId !== null ? { pilotId: link.pilotId, staticId: f.simbrief_static_id ?? undefined } : { username: link.username! };
    const ofp = await fetchOfp(query, doFetch);
    const why = ofpMismatch(ofp, { origin: f.origin, destination: f.destination, aircraftIcao: f.aircraft_icao });
    if (why) throw new HttpError(422, 'ofp_mismatch', why);
    return tx(db, () => {
      if (run(db, "UPDATE flights SET planned_fuel_kg = ?, route = ?, simbrief_ofp_id = ? WHERE id = ? AND status = 'active'", ofp.plannedFuelKg, ofp.route, ofp.ofpId, f.id).changes === 0) {
        throw new HttpError(409, 'flight_closed', 'flight is already closed');
      }
      return flightView(db, get<FlightRow>(db, 'SELECT * FROM flights WHERE id = ?', f.id)!);
    });
  });
}
