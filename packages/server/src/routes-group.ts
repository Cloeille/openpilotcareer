// Lot GROUP (v4) routes (docs/v4-plan.md B.3). Registered from app.ts with one line. Session auth: an API key is a 401. `GET /group` and the subsidiary route act as the active company (`X-OPC-Company`, checked by `ownedCompany`);
// a transfer names both companies in its body and authorises each of them for the player (group.ts), so the header does not decide who may move money.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { subsidiarySchema, groupTransferSchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { runBilling } from './finance.ts';
import { createSubsidiary, groupView, transfer } from './group.ts';
import { parse } from './http.ts';

export type GroupCtx = { db: Db; now: () => number };

export function registerGroup(app: FastifyInstance, ctx: GroupCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => { const p = sessionAuth(db, req, now()); tx(db, () => runBilling(db, p.companyId, now())); return p; };

  app.get('/api/v1/group', async (req) => groupView(db, user(req).companyId, now()));
  app.post('/api/v1/group/subsidiaries', async (req, reply) => {
    const p = user(req);
    const b = parse(subsidiarySchema, req.body);
    return reply.status(201).send(tx(db, () => createSubsidiary(db, p.userId, p.companyId, b, now())));
  });
  app.post('/api/v1/group/transfers', async (req) => {
    const p = user(req);
    const b = parse(groupTransferSchema, req.body);
    return tx(db, () => transfer(db, p.userId, b, now()));
  });
}
