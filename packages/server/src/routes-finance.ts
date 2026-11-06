// Lot FINANCE routes. Contract: docs/v2-contract.md "Lot FINANCE". Registered from app.ts with one line.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { leaseRequestSchema, offersQuerySchema, quoteQuerySchema, rentalRequestSchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { buyoutLease, offersFor, overview, quote, rentFromClub, rentMonthly, runBilling, signLease, terminateContract } from './finance.ts';
import { hubSpots } from './fleet-extras.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';

export type FinanceCtx = { db: Db; now: () => number };

export function registerFinance(app: FastifyInstance, ctx: FinanceCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());
  const idParam = (req: FastifyRequest): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'not_found', 'not found');
    return Number(raw);
  };
  /** Requests that read money first settle the company's month (lazy, idempotent). */
  const billed = (p: Principal): Principal => { tx(db, () => runBilling(db, p.companyId, now())); return p; };

  app.get('/api/v1/leasing/offers', async (req) => {
    const p = user(req);
    const q = parse(offersQuerySchema, req.query);
    return offersFor(db, p.companyId, now(), q.icao);
  });

  app.post('/api/v1/me/leases', async (req, reply) => {
    const p = billed(user(req));
    const b = parse(leaseRequestSchema, req.body);
    return reply.status(201).send(tx(db, () => signLease(db, p.companyId, b, now())));
  });

  app.post('/api/v1/me/leases/:id/terminate', async (req) => {
    const p = billed(user(req));
    return tx(db, () => terminateContract(db, p.companyId, idParam(req), now()));
  });

  app.post('/api/v1/me/leases/:id/buyout', async (req) => {
    const p = billed(user(req));
    return tx(db, () => buyoutLease(db, p.companyId, idParam(req), now()));
  });

  app.get('/api/v1/me/fleet/quote', async (req) => {
    const p = user(req);
    const q = parse(quoteQuerySchema, req.query);
    return quote(db, p.companyId, q.icao, q.hub);
  });

  app.post('/api/v1/me/club-rental', async (req, reply) => {
    const p = billed(user(req));
    const b = parse(rentalRequestSchema, req.body);
    return reply.status(201).send(tx(db, () => rentFromClub(db, p.companyId, b.hub, b.icao, now())));
  });

  app.post('/api/v1/me/monthly-rental', async (req, reply) => {
    const p = billed(user(req));
    const b = parse(rentalRequestSchema, req.body);
    return reply.status(201).send(tx(db, () => rentMonthly(db, p.companyId, b.hub, b.icao, now())));
  });

  app.get('/api/v1/me/hubs', async (req) => hubSpots(db, user(req).companyId));

  app.get('/api/v1/me/finance', async (req) => overview(db, billed(user(req)).companyId, now()));
}
