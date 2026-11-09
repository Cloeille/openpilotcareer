// Lot LINES routes (docs/v3-plan.md B.2). Registered from app.ts with one line. The line engine itself runs from an onRequest hook added here,
// BEFORE the maintenance hook of app.ts: ticks must replay the past with the workshop state of the past.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { historyQuerySchema, lineBodySchema, lineDayQuerySchema, linePatchSchema, lineResolveSchema, networkEnabledSchema, networkQuerySchema, type Programme } from '@opc/shared';
import { bearer, sessionAuth, type Principal } from './auth.ts';
import { get, tx, type Db } from './db.ts';
import { HttpError, NUMERIC_ID, parse } from './http.ts';
import { createLine, deleteLine, forecast, forecastPatch, ownedLine, patchLine, problemView, resolveLine, setEnabled, setPaused, takeRotation } from './lines-manage.ts';
import { aircraftLines, historyView, lineDetail, networkView, opsView } from './lines-views.ts';
import { lineView, linesRequest, networkOf } from './lines.ts';

export type LinesCtx = { db: Db; now: () => number };
export type { Programme };

export function registerLines(app: FastifyInstance, ctx: LinesCtx): void {
  const { db, now } = ctx;
  const user = (req: FastifyRequest): Principal => sessionAuth(db, req, now());
  const numeric = (raw: string | undefined, what = 'not_found'): number => {
    if (!NUMERIC_ID.test(raw ?? '')) throw new HttpError(404, what, 'not found');
    return Number(raw);
  };
  const id = (req: FastifyRequest): number => numeric((req.params as { id?: string }).id, 'line_not_found');

  // The simulated clock is the real UTC clock: any API request first plays the line ticks that are due, then records that the owner is here.
  app.addHook('onRequest', async (req) => { if (req.url.startsWith('/api/')) linesRequest(db, now(), bearer(req)); });

  app.get('/api/v1/network', async (req) => {
    const p = user(req);
    const q = parse(networkQuerySchema, req.query);
    const target = q.company ?? p.companyId;
    // A rival network is public, but only an AI company's: another player's lines stay theirs.
    if (target !== p.companyId && !get(db, 'SELECT 1 AS x FROM companies WHERE id = ? AND user_id IS NULL', target)) throw new HttpError(404, 'company_not_found', 'company not found');
    return networkView(db, p.companyId, target, now(), q.scope);
  });

  app.put('/api/v1/network/enabled', async (req) => {
    const p = user(req);
    const b = parse(networkEnabledSchema, req.body);
    tx(db, () => setEnabled(db, p.companyId, b.enabled, now()));
    return { enabled: (networkOf(db, p.companyId)?.enabled ?? 1) === 1 };
  });

  app.get('/api/v1/ops', async (req) => opsView(db, user(req).companyId, now()));

  // The flight log: flights flown by hand and legs flown by the lines in one date-ordered, paginated list (`/me/flights` stays the flown flights only).
  app.get('/api/v1/me/history', async (req) => {
    const q = parse(historyQuerySchema, req.query);
    return historyView(db, user(req).companyId, q.limit, q.before, q.source, now());
  });

  app.get('/api/v1/network/aircraft', async (req) => aircraftLines(db, user(req).companyId, now()));

  app.post('/api/v1/lines/forecast', async (req) => {
    const p = user(req);
    return forecast(db, p.companyId, parse(lineBodySchema, req.body), now());
  });

  // The same forecast for a line that exists, under the programme a PATCH would give it (fields left out keep the line's own): the line does not conflict with itself.
  app.post('/api/v1/lines/:id/forecast', async (req) => {
    const p = user(req);
    return forecastPatch(db, p.companyId, id(req), parse(linePatchSchema, req.body), now());
  });

  app.post('/api/v1/lines', async (req, reply) => {
    const p = user(req);
    const b = parse(lineBodySchema, req.body);
    const line = tx(db, () => createLine(db, p.companyId, b, now()));
    return reply.status(201).send(lineView(db, line));
  });

  app.get('/api/v1/lines/:id', async (req) => {
    const p = user(req);
    const q = parse(lineDayQuerySchema, req.query);
    return lineDetail(db, ownedLine(db, p.companyId, id(req)), now(), q.date);
  });

  app.patch('/api/v1/lines/:id', async (req) => {
    const p = user(req);
    const patch = parse(linePatchSchema, req.body);
    return lineView(db, tx(db, () => patchLine(db, p.companyId, id(req), patch, now())));
  });

  app.post('/api/v1/lines/:id/pause', async (req) => lineView(db, tx(db, () => setPaused(db, user(req).companyId, id(req), true, now()))));
  app.post('/api/v1/lines/:id/resume', async (req) => lineView(db, tx(db, () => setPaused(db, user(req).companyId, id(req), false, now()))));

  app.delete('/api/v1/lines/:id', async (req, reply) => {
    tx(db, () => deleteLine(db, user(req).companyId, id(req)));
    return reply.status(204).send();
  });

  app.get('/api/v1/lines/:id/problem', async (req) => {
    const p = user(req);
    return problemView(db, ownedLine(db, p.companyId, id(req)), now());
  });

  app.post('/api/v1/lines/:id/resolve', async (req) => {
    const p = user(req);
    const b = parse(lineResolveSchema, req.body);
    return lineView(db, tx(db, () => resolveLine(db, p.companyId, id(req), b, now())));
  });

  app.post('/api/v1/lines/:id/rotations/:flightId/take', async (req, reply) => {
    const p = user(req);
    const flightId = numeric((req.params as { flightId?: string }).flightId, 'flight_not_found');
    return reply.status(201).send(tx(db, () => takeRotation(db, p.companyId, id(req), flightId, now())));
  });
}
