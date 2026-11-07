// Lot SERVICE routes (docs/v3-plan.md B.7). Registered from app.ts with one line. Every change applies from the next UTC midnight (service.ts `applyFrom`).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { icaoAirportSchema, kitchenBodySchema, mealQualityBodySchema, mealQualityQuerySchema, policyBodySchema, quoteBodySchema } from '@opc/shared';
import { sessionAuth, type Principal } from './auth.ts';
import { tx, type Db } from './db.ts';
import { assertHub } from './facilities.ts';
import { HttpError, parse } from './http.ts';
import { hallHeld, setPolicy, setProvider, setQuality } from './service.ts';
import { catererQuote, kitchenView, servicePreview, serviceView } from './service-views.ts';

export type ServiceCtx = { db: Db; now: () => number };

export function registerService(app: FastifyInstance, ctx: ServiceCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());
  const hub = (req: FastifyRequest): string => parse(icaoAirportSchema, (req.params as { hub: string }).hub.toUpperCase());

  app.get('/api/v1/service', async (req) => serviceView(db, user(req).companyId, now()));

  app.get('/api/v1/service/preview', async (req) => servicePreview(db, user(req).companyId, parse(mealQualityQuerySchema, req.query).quality, now()));

  app.put('/api/v1/service/policy', async (req) => {
    const p = user(req), b = parse(policyBodySchema, req.body);
    return tx(db, () => { setPolicy(db, p.companyId, b, now()); return serviceView(db, p.companyId, now()); });
  });

  app.put('/api/v1/service/meal-quality', async (req) => {
    const p = user(req), b = parse(mealQualityBodySchema, req.body);
    return tx(db, () => { setQuality(db, p.companyId, b.quality, now()); return serviceView(db, p.companyId, now()); });
  });

  app.get('/api/v1/kitchen/:hub', async (req) => {
    const p = user(req), h = hub(req);
    return tx(db, () => kitchenView(db, p.companyId, h, now()));
  });

  app.put('/api/v1/kitchen/:hub', async (req) => {
    const p = user(req), h = hub(req), b = parse(kitchenBodySchema, req.body);
    return tx(db, () => {
      assertHub(db, p.companyId, h);
      // an own kitchen needs the hall: nobody makes meals in a building they do not hold
      if (b.provider === 'own' && !hallHeld(db, p.companyId, h, now())) throw new HttpError(409, 'no_kitchen_hall', `you do not hold the central kitchen at ${h}: rent it first`);
      if (b.provider) setProvider(db, p.companyId, h, b.provider, now());
      if (b.quality) setQuality(db, p.companyId, b.quality, now());
      return kitchenView(db, p.companyId, h, now());
    });
  });

  app.post('/api/v1/kitchen/:hub/quote', async (req) => {
    const p = user(req), h = hub(req), b = parse(quoteBodySchema, req.body);
    return tx(db, () => catererQuote(db, p.companyId, h, b.quality, now()));
  });
}
