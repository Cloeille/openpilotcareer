// Lot ALLIANCE (v4) routes (docs/v4-plan.md B.3). Registered from app.ts with one line. Session auth, scoped to the active company (`X-OPC-Company`, checked by `ownedCompany`): an API key is a 401 here.
// A company that is not a member gets 404 `not_in_alliance` on everything inside an alliance (B.1, C23): the status never says more than "not found". Only the invitation list and joining are open to a non-member,
// and they show an alliance's name and nothing else. Every route settles the company's month first (lazy, idempotent billing), like every route that reads or moves money, so the dues in view are the ones billed.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ballotSchema, foundAllianceSchema, inviteSchema } from '@opc/shared';
import { allianceView, castBallot, foundAlliance, invitationsOf, invite, joinAlliance, leaveAlliance } from './alliance.ts';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { runBilling } from './finance.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';

export type AllianceCtx = { db: Db; now: () => number };

export function registerAlliance(app: FastifyInstance, ctx: AllianceCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => { const p = sessionAuth(db, req, now()); tx(db, () => runBilling(db, p.companyId, now())); return p; };
  const id = (req: FastifyRequest, code: string): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, code, 'not found');
    return Number(raw);
  };

  app.get('/api/v1/alliance', async (req) => allianceView(db, user(req).companyId, now()));
  app.post('/api/v1/alliance', async (req, reply) => {
    const p = user(req);
    return reply.status(201).send(tx(db, () => foundAlliance(db, p.companyId, parse(foundAllianceSchema, req.body), now())));
  });
  app.post('/api/v1/alliance/invite', async (req) => {
    const p = user(req);
    return tx(db, () => invite(db, p.companyId, parse(inviteSchema, req.body), now()));
  });
  app.post('/api/v1/alliance/votes/:id/ballot', async (req) => {
    const p = user(req), voteId = id(req, 'vote_not_found');
    return tx(db, () => castBallot(db, p.companyId, voteId, parse(ballotSchema, req.body).choice, now()));
  });
  app.post('/api/v1/alliance/leave', async (req) => {
    const p = user(req);
    return tx(db, () => leaveAlliance(db, p.companyId, now()));
  });
  app.get('/api/v1/alliance/invitations', async (req) => invitationsOf(db, user(req).companyId, now()));
  app.post('/api/v1/alliance/invitations/:id/join', async (req) => {
    const p = user(req), voteId = id(req, 'invitation_not_found');
    return tx(db, () => joinAlliance(db, p.companyId, voteId, now()));
  });
}
