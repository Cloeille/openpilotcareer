// Lot FACILITIES routes (docs/v3-plan.md B.4). Registered from app.ts with one line. Anything that reads or moves money first settles the company's month (lazy, idempotent), as the finance routes do.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buyBodySchema, facilityQuerySchema, icaoAirportSchema, leaseBodySchema, upgradeBodySchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { buyFacility, leaseFacility, terminateFacility, upgradeFacility } from './facilities-manage.ts';
import { facilityDetail, hubPlan, hubsOverview } from './facilities-views.ts';
import { runBilling } from './finance.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';

export type FacilitiesCtx = { db: Db; now: () => number };

export function registerFacilities(app: FastifyInstance, ctx: FacilitiesCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());
  const billed = (p: Principal): Principal => { tx(db, () => runBilling(db, p.companyId, now())); return p; };
  const id = (req: FastifyRequest): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'facility_not_found', 'no such building');
    return Number(raw);
  };

  app.get('/api/v1/hubs/overview', async (req) => {
    const p = billed(user(req));
    return tx(db, () => hubsOverview(db, p.companyId, now()));
  });

  app.get('/api/v1/hubs/:icao/plan', async (req) => {
    const p = user(req);
    const icao = parse(icaoAirportSchema, (req.params as { icao: string }).icao.toUpperCase());
    return tx(db, () => hubPlan(db, p.companyId, icao, now()));
  });

  app.get('/api/v1/facilities/:id', async (req) => {
    const p = billed(user(req));
    const q = parse(facilityQuerySchema, req.query);
    return tx(db, () => facilityDetail(db, p.companyId, id(req), q, now()));
  });

  app.post('/api/v1/facilities/:id/lease', async (req, reply) => {
    const p = billed(user(req));
    const b = parse(leaseBodySchema, req.body);
    return reply.status(201).send(tx(db, () => leaseFacility(db, p.companyId, id(req), b.level ?? 1, now())));
  });

  app.post('/api/v1/facilities/:id/buy', async (req, reply) => {
    const p = billed(user(req));
    const b = parse(buyBodySchema, req.body);
    return reply.status(201).send(tx(db, () => buyFacility(db, p.companyId, id(req), b.level ?? 1, b.financing, now())));
  });

  app.post('/api/v1/facilities/:id/upgrade', async (req) => {
    const p = billed(user(req));
    const b = parse(upgradeBodySchema, req.body);
    return tx(db, () => upgradeFacility(db, p.companyId, id(req), b.toLevel, now()));
  });

  app.post('/api/v1/facilities/:id/terminate', async (req) => {
    const p = billed(user(req));
    return tx(db, () => terminateFacility(db, p.companyId, id(req), now()));
  });
}
