// Ferry routes: preview and book an empty repositioning flight of one aircraft (ferry.ts). Registered from app.ts with one line.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ferrySchema } from '@opc/shared';
import { sessionAuth } from './auth.ts';
import { tx, type Db } from './db.ts';
import { ferry, ferryPreview } from './ferry.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';

export type FerryCtx = { db: Db; now: () => number };

export function registerFerry(app: FastifyInstance, { db, now }: FerryCtx): void {
  const aircraftId = (req: FastifyRequest): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'aircraft_not_found', 'aircraft not found');
    return Number(raw);
  };

  app.get('/api/v1/me/fleet/:id/ferry', async (req) => {
    const p = sessionAuth(db, req, now());
    const q = parse(ferrySchema, req.query);
    return ferryPreview(db, p.companyId, aircraftId(req), q.to, now());
  });

  app.post('/api/v1/me/fleet/:id/ferry', async (req, reply) => {
    const p = sessionAuth(db, req, now());
    const b = parse(ferrySchema, req.body);
    return reply.status(201).send(tx(db, () => ferry(db, p.companyId, aircraftId(req), b.to, now())));
  });
}
