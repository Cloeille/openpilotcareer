// Lot CREDIT routes (docs/v4-plan.md B.3). Registered from app.ts with one line. Session auth, scoped to the active company (`X-OPC-Company`, checked by `ownedCompany`): an API key is a 401 here.
// Every route settles the company's month first (lazy, idempotent billing), like every route that reads or moves money, so the ratio and the balance never lag.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { creditRequestSchema, prepayRequestSchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { creditsView, prepayCredit, prepayQuote, quoteCredit, signCredit } from './credit-manage.ts';
import { tx, type Db } from './db.ts';
import { runBilling } from './finance.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';

export type CreditCtx = { db: Db; now: () => number };

export function registerCredit(app: FastifyInstance, ctx: CreditCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => { const p = sessionAuth(db, req, now()); tx(db, () => runBilling(db, p.companyId, now())); return p; };
  const id = (req: FastifyRequest): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'credit_not_found', 'no such credit');
    return Number(raw);
  };

  app.get('/api/v1/credits', async (req) => creditsView(db, user(req).companyId, now()));
  app.post('/api/v1/credits/quote', async (req) => quoteCredit(db, user(req).companyId, parse(creditRequestSchema, req.body), now()));
  app.post('/api/v1/credits', async (req, reply) => {
    const p = user(req);
    return reply.status(201).send(tx(db, () => signCredit(db, p.companyId, parse(creditRequestSchema, req.body), now())));
  });
  app.post('/api/v1/credits/:id/prepay/quote', async (req) => prepayQuote(db, user(req).companyId, id(req), parse(prepayRequestSchema, req.body)));
  app.post('/api/v1/credits/:id/prepay', async (req) => {
    const p = user(req);
    return tx(db, () => prepayCredit(db, p.companyId, id(req), parse(prepayRequestSchema, req.body), now()));
  });
}
