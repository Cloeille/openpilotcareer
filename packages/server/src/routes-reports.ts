// Lot REPORTS (v4) routes: cash flow, statement, profitability, forecast. Docs: docs/v4-plan.md B.3. Session auth scoped to the active company; an API key answers 401. All read-only
// except that, like every route that reads money, they first settle the company's month (lazy, idempotent billing), so a report never lags the balance.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { cashQuerySchema, decisionBodySchema, profitQuerySchema, statementQuerySchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { runBilling } from './finance.ts';
import { parse } from './http.ts';
import { cashView, statement } from './reports.ts';
import { forecastView, profitView, testDecision } from './reports-views.ts';

export type ReportsCtx = { db: Db; now: () => number };

export function registerReports(app: FastifyInstance, ctx: ReportsCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => { const p = sessionAuth(db, req, now()); tx(db, () => runBilling(db, p.companyId, now())); return p; };

  app.get('/api/v1/finance/cash', async (req) => cashView(db, user(req).companyId, now(), parse(cashQuerySchema, req.query).months));
  app.get('/api/v1/finance/lines', async (req) => profitView(db, user(req).companyId, now(), parse(profitQuerySchema, req.query)));
  app.get('/api/v1/finance/ledger', async (req) => statement(db, user(req).companyId, now(), parse(statementQuerySchema, req.query)));
  app.get('/api/v1/finance/forecast', async (req) => forecastView(db, user(req).companyId, now()));
  app.post('/api/v1/finance/forecast/decision', async (req) => testDecision(db, user(req).companyId, now(), parse(decisionBodySchema, req.body).decision));
}
