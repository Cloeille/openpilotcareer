// Lot SAFETY routes (docs/v3-plan.md B.5). Registered from app.ts with one line. The incident roll itself runs inside the flight and line engines (safety.ts), not here.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { incidentsQuerySchema, seasonOf } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { parse } from './http.ts';
import { journal, safetyView } from './safety-views.ts';

export type SafetyCtx = { db: Db; now: () => number };

export function registerSafety(app: FastifyInstance, ctx: SafetyCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());

  // The first read of a day writes that day's reading of the index, so it runs in a transaction; the preview of tonight's crews inside it is rolled back.
  app.get('/api/v1/safety', async (req) => {
    const p = user(req);
    return tx(db, () => safetyView(db, p.companyId, now()));
  });

  app.get('/api/v1/safety/incidents', async (req) => {
    const p = user(req);
    const q = parse(incidentsQuerySchema, req.query);
    return journal(db, p.companyId, q.season ?? seasonOf(now()));
  });
}
