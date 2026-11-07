// Lot TRAINING routes (docs/v4-plan.md B.3, C26). Registered from app.ts with one line. Session auth, scoped to the active company (`X-OPC-Company`, checked by `ownedCompany`): an API key is a 401 here.
// A course is the staff lot's `train()`: this file only adds the centre's read model, the scheduling door and the reconversion.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { courseBodySchema, retrainSchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';
import { memberRow, train } from './staff-people.ts';
import { memberView } from './staff-views.ts';
import { retrain, retrainView, trainingView } from './training.ts';

export type TrainingCtx = { db: Db; now: () => number };

export function registerTraining(app: FastifyInstance, ctx: TrainingCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());
  const id = (req: FastifyRequest): number => {
    const raw = (req.params as { id?: string }).id ?? '';
    if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'staff_not_found', 'no such employee');
    return Number(raw);
  };

  app.get('/api/v1/training', async (req) => trainingView(db, user(req).companyId, now()));

  app.post('/api/v1/training/courses', async (req, reply) => {
    const p = user(req);
    const b = parse(courseBodySchema, req.body);
    const r = tx(db, () => train(db, p.companyId, b.staffId, b.type, now(), b.place));
    return reply.status(201).send({ ...r, member: memberView(db, memberRow(db, b.staffId), now()) });
  });

  app.get('/api/v1/staff/:id/retrain', async (req) => retrainView(db, user(req).companyId, id(req), now()));

  app.post('/api/v1/staff/:id/retrain', async (req) => {
    const p = user(req);
    parse(retrainSchema, req.body);
    return tx(db, () => retrain(db, p.companyId, id(req), now()));
  });
}
