// Lot HR routes (docs/v4-plan.md B.3, C27). Registered from app.ts with one line. Session auth, scoped to the active company (`X-OPC-Company`, checked by `ownedCompany`): an API key is a 401 here.
// Every route settles the company's month first (lazy, idempotent billing, which also steps the morale), so the view never lags a month behind. A change applies from the next UTC midnight.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hrPolicySchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { runBilling } from './finance.ts';
import { parse } from './http.ts';
import { setPay } from './hr.ts';
import { hrView } from './hr-views.ts';

export type HrCtx = { db: Db; now: () => number };

export function registerHr(app: FastifyInstance, ctx: HrCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => { const p = sessionAuth(db, req, now()); tx(db, () => runBilling(db, p.companyId, now())); return p; };

  app.get('/api/v1/hr', async (req) => hrView(db, user(req).companyId, now()));

  app.put('/api/v1/hr/policy', async (req) => {
    const p = user(req), b = parse(hrPolicySchema, req.body);
    return tx(db, () => { setPay(db, p.companyId, b.payPct, now()); return hrView(db, p.companyId, now()); });
  });
}
