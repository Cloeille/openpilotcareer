// Lot AGENCY routes (docs/v4-plan.md B.3). Registered from app.ts with one line. Session auth, scoped to the active company (`X-OPC-Company`, checked by `ownedCompany`): an API key is a 401 here.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { agencyQuerySchema, missionBodySchema, signBodySchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';
import { agencyView, cancelMission, openMission, signMission } from './agency.ts';

export type AgencyCtx = { db: Db; now: () => number };

export function registerAgency(app: FastifyInstance, ctx: AgencyCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());
  const id = (req: FastifyRequest): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'mission_not_found', 'no such mission');
    return Number(raw);
  };

  app.get('/api/v1/agency/options', async (req) => {
    return agencyView(db, user(req).companyId, parse(agencyQuerySchema, req.query), now());
  });

  app.post('/api/v1/agency/missions', async (req, reply) => {
    const p = user(req);
    const b = parse(missionBodySchema, req.body);
    return reply.status(201).send(tx(db, () => openMission(db, p.companyId, b, now())));
  });

  app.post('/api/v1/agency/missions/:id/sign', async (req, reply) => {
    const p = user(req);
    const b = parse(signBodySchema, req.body);
    return reply.status(201).send(tx(db, () => signMission(db, p.companyId, id(req), b.candidateIds, now())));
  });

  app.delete('/api/v1/agency/missions/:id', async (req, reply) => {
    const p = user(req);
    tx(db, () => cancelMission(db, p.companyId, id(req)));
    return reply.status(204).send();
  });
}
