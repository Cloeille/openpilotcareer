// Lot PARTS routes (docs/v3-plan.md B.6). Registered from app.ts with one line. Anything that moves money first settles the company's month (lazy, idempotent), as the finance routes do.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { icaoAirportSchema, orderBodySchema, policyBodySchema, refurbishBodySchema, wearQuerySchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { runBilling } from './finance.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';
import { orderPart, refurbish, setPolicy } from './parts-manage.ts';
import { warehouseView, wearView } from './parts-views.ts';

export type PartsCtx = { db: Db; now: () => number };

export function registerParts(app: FastifyInstance, ctx: PartsCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());
  const billed = (p: Principal): Principal => { tx(db, () => runBilling(db, p.companyId, now())); return p; };
  const hub = (req: FastifyRequest): string => parse(icaoAirportSchema, (req.params as { hub: string }).hub.toUpperCase());
  const id = (req: FastifyRequest): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'aircraft_not_found', 'aircraft not found');
    return Number(raw);
  };

  // reading the warehouse puts the orders that arrived on the shelf, so it runs in a transaction
  app.get('/api/v1/warehouse/:hub', async (req) => {
    const p = billed(user(req));
    return tx(db, () => warehouseView(db, p.companyId, hub(req), now()));
  });

  app.put('/api/v1/warehouse/:hub/policy', async (req) => {
    const p = billed(user(req));
    const b = parse(policyBodySchema, req.body);
    return tx(db, () => setPolicy(db, p.companyId, hub(req), b.icao, b.policy, now()));
  });

  app.post('/api/v1/warehouse/:hub/order', async (req, reply) => {
    const p = billed(user(req));
    const b = parse(orderBodySchema, req.body);
    return reply.status(201).send(tx(db, () => orderPart(db, p.companyId, hub(req), b.partId, b.qty, b.express ?? false, now())));
  });

  app.get('/api/v1/me/fleet/:id/wear', async (req) => {
    const p = billed(user(req));
    const q = parse(wearQuerySchema, req.query);
    return wearView(db, p.companyId, id(req), q.pick, now());
  });

  app.post('/api/v1/me/fleet/:id/refurbish', async (req) => {
    const p = billed(user(req));
    const b = parse(refurbishBodySchema, req.body);
    return tx(db, () => refurbish(db, p.companyId, id(req), b.items, now()));
  });
}
