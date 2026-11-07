// OpenHangar v2, lot START: onboarding, company identity, realism, first job. See docs/v2-contract.md "Lot START".
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { airlineCodeSchema, createCompanyStartSchema, hubQuerySchema, onboardingUpdateSchema, realismUpdateSchema } from '@opc/shared';
import { ownedCompany, sessionUser } from './auth.ts';
import { tx, type Db } from './db.ts';
import { meView } from './game.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';
import { airlineCodeAvailable, completeOnboarding, firstJob, foundCompany, hubSuggestions, onboardingOf, setRealism, updateOnboarding } from './start.ts';
import { realismOf } from './realism.ts';

export type StartCtx = { db: Db; now: () => number };

const idParam = (req: FastifyRequest): number => {
  const raw = (req.params as { id?: string }).id ?? '';
  if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'not_found', 'not found');
  return Number(raw);
};

export function registerStart(app: FastifyInstance, { db, now }: StartCtx): void {
  // Account-level auth: works for a player who has no company yet.
  const account = (req: FastifyRequest) => sessionUser(db, req, now());

  app.get('/api/v1/onboarding', async (req) => onboardingOf(db, account(req).userId));

  app.put('/api/v1/onboarding', async (req) => {
    const p = account(req);
    const b = parse(onboardingUpdateSchema, req.body);
    return tx(db, () => updateOnboarding(db, p.userId, b, now()));
  });

  app.post('/api/v1/onboarding/complete', async (req) => {
    const p = account(req);
    return tx(db, () => completeOnboarding(db, p.userId, now()));
  });

  app.get('/api/v1/onboarding/hubs', async (req) => {
    account(req);
    const q = parse(hubQuerySchema, req.query);
    return hubSuggestions(db, q.mode, q.q, now());
  });

  app.get('/api/v1/airlines/code/:code', async (req) => {
    account(req);
    const code = parse(airlineCodeSchema, (req.params as { code: string }).code);
    return { available: airlineCodeAvailable(db, code) };
  });

  // Replaces the legacy handler of app.ts: same body plus identity and start mode.
  app.post('/api/v1/me/companies', async (req, reply) => {
    const p = account(req);
    const b = parse(createCompanyStartSchema, req.body);
    const id = tx(db, () => foundCompany(db, p.userId, b, now()));
    return reply.status(201).send(meView(db, p.userId, id, now()));
  });

  app.put('/api/v1/companies/:id/realism', async (req) => {
    const p = account(req);
    const id = ownedCompany(db, p.userId, idParam(req));
    const b = parse(realismUpdateSchema, req.body);
    return tx(db, () => setRealism(db, id, b));
  });

  app.get('/api/v1/companies/:id/realism', async (req) => realismOf(db, ownedCompany(db, account(req).userId, idParam(req))));

  app.get('/api/v1/companies/:id/first-job', async (req) => {
    const p = account(req);
    const id = ownedCompany(db, p.userId, idParam(req));
    return tx(db, () => firstJob(db, id, now()));
  });
}

