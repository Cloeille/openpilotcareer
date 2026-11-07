// Lot STAFF routes (docs/v3-plan.md B.3). Registered from app.ts with one line, BEFORE registerLines: the starter crew a migrated company is owed has to exist
// before the first line tick of the upgraded server replays anything.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { candidatesQuerySchema, hireSchema, interimSchema, leaveDecisionSchema, leaveQuerySchema, restPolicySchema, staffQuerySchema, transferSchema, trainSchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';
import { fire, grantPendingStarters, hire, interim, memberRow, ownedStaff, rest, setPolicy, train, transfer } from './staff-people.ts';
import { candidates, decideLeave, detail, leaveView, memberView, overview } from './staff-views.ts';

export type StaffCtx = { db: Db; now: () => number };

export function registerStaff(app: FastifyInstance, ctx: StaffCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());
  const id = (req: FastifyRequest): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'staff_not_found', 'no such employee');
    return Number(raw);
  };

  // C11: a company the upgrade left a starter crew is granted it by the first request (cheap no-op when none is pending).
  let pending = true;
  app.addHook('onRequest', async (req) => {
    if (!pending || !req.url.startsWith('/api/')) return;
    tx(db, () => grantPendingStarters(db, now()));
    pending = false;
  });

  app.get('/api/v1/staff', async (req) => {
    const q = parse(staffQuerySchema, req.query);
    return overview(db, user(req).companyId, now(), q.base, q.family);
  });

  app.get('/api/v1/staff/candidates', async (req) => candidates(db, user(req).companyId, now(), parse(candidatesQuerySchema, req.query)));

  app.get('/api/v1/staff/leave', async (req) => {
    const p = user(req);
    const q = parse(leaveQuerySchema, req.query);
    return tx(db, () => leaveView(db, p.companyId, now(), q.from, q.days));
  });

  app.post('/api/v1/staff/leave/:id', async (req) => {
    const p = user(req);
    const b = parse(leaveDecisionSchema, req.body);
    tx(db, () => decideLeave(db, p.companyId, id(req), b.decision, now()));
    return tx(db, () => leaveView(db, p.companyId, now()));
  });

  app.put('/api/v1/staff/rest-policy', async (req) => {
    const p = user(req);
    const b = parse(restPolicySchema, req.body);
    tx(db, () => setPolicy(db, p.companyId, b.policy));
    return { policy: b.policy };
  });

  app.post('/api/v1/staff/hire', async (req, reply) => {
    const p = user(req);
    const b = parse(hireSchema, req.body);
    const r = tx(db, () => hire(db, p.companyId, b.candidateId, now()));
    return reply.status(201).send({ member: memberView(db, memberRow(db, r.staffId), now()), startsAt: r.startsAt, premium: r.premium, balanceAfter: balance(db, p.companyId) });
  });

  app.post('/api/v1/staff/interim', async (req, reply) => {
    const p = user(req);
    const b = parse(interimSchema, req.body);
    const r = tx(db, () => interim(db, p.companyId, b, now()));
    return reply.status(201).send({ member: memberView(db, memberRow(db, r.staffId), now()), cost: r.cost, endsAt: r.endsAt, balanceAfter: r.balanceAfter });
  });

  app.get('/api/v1/staff/:id', async (req) => detail(db, ownedStaff(db, user(req).companyId, id(req)), now()));

  app.delete('/api/v1/staff/:id', async (req) => tx(db, () => fire(db, user(req).companyId, id(req), now())));

  app.post('/api/v1/staff/:id/train', async (req) => {
    const p = user(req);
    const b = parse(trainSchema, req.body);
    const r = tx(db, () => train(db, p.companyId, id(req), b.type, now()));
    return { ...r, member: memberView(db, memberRow(db, id(req)), now()) };
  });

  app.post('/api/v1/staff/:id/rest', async (req) => {
    const p = user(req);
    return memberView(db, tx(db, () => rest(db, p.companyId, id(req), now())), now());
  });

  app.post('/api/v1/staff/:id/transfer', async (req) => {
    const p = user(req);
    const b = parse(transferSchema, req.body);
    return memberView(db, tx(db, () => transfer(db, p.companyId, id(req), b.base, now())), now());
  });
}

const balance = (db: Db, companyId: number): number => (db.prepare('SELECT balance FROM companies WHERE id = ?').get(companyId) as { balance: number }).balance;
