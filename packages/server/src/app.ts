import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  API_VERSION, acceptJobSchema, apiKeyCreateSchema, buyAircraftSchema, buyHubSchema, checkTelemetry, createCompanySchema, customAircraftSchema, deleteAccountSchema,
  flightListQuerySchema, icaoAirportSchema, icaoTypeSchema, listQuerySchema, loginSchema, registerSchema, renameCompanySchema, simbriefImportSchema, telemetrySchema,
  type ApiKeyInfo, type ServerInfo,
} from '@opc/shared';
import { catchUp, seedAi } from './ai.ts';
import { apiKeyAuth, COMPANY_HEADER, createSession, defaultCompany, DUMMY_HASH, hashPassword, newToken, ownedCompany, sessionAuth, sha256, verifyPassword, type Principal } from './auth.ts';
import { airports, catalogType, searchAircraftTypes, searchAirports } from './catalog.ts';
import { all, get, run, tx, type Db } from './db.ts';
import { exportDocument, flightsCsv, transactionsCsv } from './export.ts';
import {
  acceptJob, activeFlight, activeFlightsOfUser, addCustomAircraft, buyAircraft, buyHub, closeUnpaid, companiesOf, companyProfile, completeManually, createCompany, currentSeason,
  deleteCustomAircraft, finishFlight, flightView, flightsOf, importJob, leaderboard, meView, openBoard, pendingImports, renameCompany, transactionsOf, typeFor,
} from './game.ts';
import { HttpError, Limiter, NUMERIC_ID, parse } from './http.ts';
import { fetchLatestOfp, type Fetch } from './simbrief.ts';
import { maintenanceTick } from './finance.ts';
import { registerFinance } from './routes-finance.ts';

const MAX_API_KEYS = 10;
const AUTH_ATTEMPTS_PER_MINUTE = 20;
const BODY_LIMIT = 64 * 1024;
const DEFAULT_HUB = 'KJFK';
const CSV_HEADERS = { 'content-type': 'text/csv; charset=utf-8' } as const;

export type AppOptions = {
  db: Db;
  name?: string;
  version?: string;
  registrationOpen?: boolean;
  /** Verify flights against cheating (default true). Off: job integrity is still checked, plausibility and client flags are not. */
  antiCheat?: boolean;
  now?: () => number;
  fetch?: Fetch;
  /** Directory of the built web app to serve at `/` (omit for API only). */
  webRoot?: string;
  /** Run AI ticks lazily on requests (default true). */
  ai?: boolean;
  /** Behind a reverse proxy: take the client IP (rate limiting) from X-Forwarded-For. */
  trustProxy?: boolean;
};

const idParam = (req: FastifyRequest): number => {
  const raw = (req.params as { id?: string }).id ?? '';
  if (!NUMERIC_ID.test(raw)) throw new HttpError(404, 'not_found', 'not found');
  return Number(raw);
};

export async function buildApp(o: AppOptions): Promise<FastifyInstance> {
  const { db } = o;
  const now = o.now ?? Date.now;
  const info: ServerInfo = { name: o.name ?? 'OpenPilotCareer', version: o.version ?? '0.1.0', apiVersion: API_VERSION, registrationOpen: o.registrationOpen ?? true, antiCheat: o.antiCheat ?? true };
  const authLimiter = new Limiter(AUTH_ATTEMPTS_PER_MINUTE, 60_000, now);
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT, trustProxy: o.trustProxy ?? false });
  const doFetch = o.fetch ?? fetch;
  if (o.ai !== false) seedAi(db, now());

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ ...err.extra, error: err.code, message: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) return reply.status(status).send({ error: 'bad_request', message: (err as Error).message });
    console.error(err);
    return reply.status(500).send({ error: 'internal', message: 'internal server error' });
  });

  // AI companies play lazily: any API request first plays the ticks that are due (cheap no-op otherwise).
  if (o.ai !== false) app.addHook('onRequest', async (req) => { if (req.url.startsWith('/api/')) catchUp(db, now()); });

  // Lot FINANCE: free aircraft whose workshop visit is over and bill the months that are due (cheap no-op otherwise).
  app.addHook('onRequest', async (req) => { if (req.url.startsWith('/api/')) maintenanceTick(db, now()); });

  // Clients pick their server at runtime, so the API is cross-origin by design. Auth is a Bearer header, never a cookie,
  // so a wildcard origin exposes nothing a script could not already do with a token it was given.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('access-control-allow-origin', '*').header('access-control-expose-headers', 'content-disposition');
    if (req.method === 'OPTIONS') {
      return reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS').header('access-control-allow-headers', `authorization,content-type,${COMPANY_HEADER}`).header('access-control-max-age', '600').status(204).send();
    }
  });

  if (o.webRoot) {
    await app.register(fastifyStatic, { root: o.webRoot });
  }
  // One handler (Fastify allows only one): API misses are JSON; with a web root, other GETs fall back to the single-page app.
  app.setNotFoundHandler((req, reply) =>
    o.webRoot && req.method === 'GET' && !req.url.startsWith('/api/')
      ? reply.sendFile('index.html')
      : reply.status(404).send({ error: 'not_found', message: 'not found' }));

  const user = (req: FastifyRequest): Principal & { token: string } => sessionAuth(db, req, now());

  // ---- public
  app.get('/api/v1/info', async () => info);
  app.get('/api/v1/airports', async (req) => searchAirports(String((req.query as { q?: string }).q ?? '')));
  app.get('/api/v1/airports/:icao', async (req) => {
    const a = airports.get(String((req.params as { icao: string }).icao).toUpperCase());
    if (!a) throw new HttpError(404, 'unknown_airport', 'airport not found');
    return a;
  });
  app.get('/api/v1/aircraft-types', async (req) => searchAircraftTypes(String((req.query as { q?: string }).q ?? '')));
  app.get('/api/v1/aircraft-types/:icao', async (req) => {
    const icao = parse(icaoTypeSchema, String((req.params as { icao: string }).icao).toUpperCase());
    return catalogType(icao);
  });
  app.get('/api/v1/leaderboard', async (req) => {
    const q = parse(z.object({ season: z.string().regex(/^\d{4}-\d{2}$/).optional() }), req.query);
    return leaderboard(db, q.season ?? currentSeason(now()), now());
  });
  app.get('/api/v1/companies/:id', async (req) => {
    const id = idParam(req);
    if (!get(db, 'SELECT 1 AS x FROM companies WHERE id = ?', id)) throw new HttpError(404, 'company_not_found', 'company not found');
    return companyProfile(db, id);
  });

  // ---- accounts
  app.post('/api/v1/auth/register', async (req, reply) => {
    authLimiter.hit(req.ip);
    if (!info.registrationOpen) throw new HttpError(403, 'registration_closed', 'this server is not accepting new accounts');
    const b = parse(registerSchema, req.body);
    const hash = await hashPassword(b.password);
    const at = now();
    const { token, userId, companyId } = tx(db, () => {
      if (get(db, 'SELECT 1 AS x FROM users WHERE username = ?', b.username)) throw new HttpError(409, 'username_taken', 'username is already taken');
      const userId = run(db, 'INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)', b.username, hash, at).id;
      const companyId = createCompany(db, { userId, name: b.companyName ?? `${b.username} Aviation`, hub: b.hub ?? DEFAULT_HUB, now: at });
      return { userId, companyId, token: createSession(db, userId, at) };
    });
    return reply.status(201).send({ token, ...meView(db, userId, companyId) });
  });

  app.post('/api/v1/auth/login', async (req) => {
    authLimiter.hit(req.ip);
    const b = parse(loginSchema, req.body);
    const u = get<{ id: number; pass_hash: string }>(db, 'SELECT id, pass_hash FROM users WHERE username = ?', b.username);
    const ok = await verifyPassword(b.password, u?.pass_hash ?? (await DUMMY_HASH));
    if (!u || !ok) throw new HttpError(401, 'bad_credentials', 'wrong username or password');
    run(db, 'DELETE FROM sessions WHERE expires_at <= ?', now()); // expired sessions are only ever dead weight
    const token = createSession(db, u.id, now());
    return { token, ...meView(db, u.id, defaultCompany(db, u.id)) };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const p = user(req);
    run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(p.token));
    return reply.status(204).send();
  });

  app.get('/api/v1/me', async (req) => {
    const p = user(req);
    return meView(db, p.userId, p.companyId);
  });

  // ---- companies: a player may own several; the client acts as one via the X-OPC-Company header (see auth.ts)
  app.get('/api/v1/me/companies', async (req) => companiesOf(db, user(req).userId));

  app.post('/api/v1/me/companies', async (req, reply) => {
    const p = user(req);
    const b = parse(createCompanySchema, req.body);
    const id = tx(db, () => createCompany(db, { userId: p.userId, name: b.name, hub: b.hub, now: now() }));
    return reply.status(201).send(meView(db, p.userId, id));
  });

  app.patch('/api/v1/companies/:id', async (req) => {
    const p = user(req);
    const id = ownedCompany(db, p.userId, idParam(req));
    const b = parse(renameCompanySchema, req.body);
    return tx(db, () => renameCompany(db, id, b.name));
  });

  app.get('/api/v1/me/export', async (req, reply) => {
    const p = user(req);
    const format = parse(z.object({ format: z.enum(['json', 'flights.csv', 'transactions.csv']).default('json') }), req.query).format;
    const stamp = new Date(now()).toISOString().slice(0, 10);
    const attach = (name: string) => reply.header('content-disposition', `attachment; filename="opc-${name}-${stamp}"`);
    if (format === 'flights.csv') return attach('flights.csv').headers(CSV_HEADERS).send(flightsCsv(db, p.companyId));
    if (format === 'transactions.csv') return attach('transactions.csv').headers(CSV_HEADERS).send(transactionsCsv(db, p.companyId));
    return attach('export.json').send(exportDocument(db, p.userId, info, now()));
  });

  app.delete('/api/v1/me', async (req, reply) => {
    const p = user(req);
    const b = parse(deleteAccountSchema, req.body);
    const u = get<{ pass_hash: string }>(db, 'SELECT pass_hash FROM users WHERE id = ?', p.userId)!;
    if (!(await verifyPassword(b.password, u.pass_hash))) throw new HttpError(403, 'bad_password', 'wrong password');
    // ON DELETE CASCADE removes the company, fleet, flights, ledger, API keys, sessions and job claims (those board jobs reopen).
    tx(db, () => run(db, 'DELETE FROM users WHERE id = ?', p.userId));
    return reply.status(204).send();
  });

  // ---- API keys
  app.get('/api/v1/me/api-keys', async (req): Promise<ApiKeyInfo[]> =>
    all<{ id: number; label: string; created_at: number; last_used_at: number | null }>(db, 'SELECT * FROM api_keys WHERE user_id = ? ORDER BY id', user(req).userId)
      .map((k) => ({ id: k.id, label: k.label, createdAt: k.created_at, lastUsedAt: k.last_used_at })));

  app.post('/api/v1/me/api-keys', async (req, reply) => {
    const p = user(req);
    const b = parse(apiKeyCreateSchema, req.body);
    const key = newToken('opc_');
    const at = now();
    const id = tx(db, () => {
      if (get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?', p.userId)!.n >= MAX_API_KEYS) throw new HttpError(409, 'limit_reached', `at most ${MAX_API_KEYS} API keys`);
      return run(db, 'INSERT INTO api_keys (user_id, label, key_hash, created_at) VALUES (?, ?, ?, ?)', p.userId, b.label, sha256(key), at).id;
    });
    // The plaintext key is shown exactly once; only its hash is stored.
    return reply.status(201).send({ id, label: b.label, createdAt: at, lastUsedAt: null, key });
  });

  app.delete('/api/v1/me/api-keys/:id', async (req, reply) => {
    const p = user(req);
    if (run(db, 'DELETE FROM api_keys WHERE id = ? AND user_id = ?', idParam(req), p.userId).changes === 0) throw new HttpError(404, 'not_found', 'API key not found');
    return reply.status(204).send();
  });

  // ---- company, fleet, hubs
  app.get('/api/v1/me/transactions', async (req) => {
    const q = parse(listQuerySchema, req.query);
    return transactionsOf(db, user(req).companyId, q.limit, q.before);
  });

  app.post('/api/v1/me/hubs', async (req, reply) => {
    const p = user(req);
    const b = parse(buyHubSchema, req.body);
    tx(db, () => buyHub(db, p.companyId, b.icao, now()));
    return reply.status(201).send(meView(db, p.userId, p.companyId));
  });

  app.post('/api/v1/me/fleet', async (req, reply) => {
    const p = user(req);
    const b = parse(buyAircraftSchema, req.body);
    tx(db, () => buyAircraft(db, p.companyId, b.icao, b.hub, now(), b.financing));
    return reply.status(201).send(meView(db, p.userId, p.companyId));
  });

  app.post('/api/v1/me/custom-aircraft', async (req, reply) => {
    const p = user(req);
    const b = parse(customAircraftSchema, req.body);
    const t = tx(db, () => addCustomAircraft(db, p.companyId, b));
    return reply.status(201).send(t);
  });

  app.delete('/api/v1/me/custom-aircraft/:icao', async (req, reply) => {
    const p = user(req);
    const icao = parse(icaoTypeSchema, (req.params as { icao: string }).icao);
    tx(db, () => deleteCustomAircraft(db, p.companyId, icao));
    return reply.status(204).send();
  });

  // ---- jobs & flights
  app.get('/api/v1/jobs', async (req) => {
    const p = user(req);
    const q = parse(z.object({ airport: icaoAirportSchema.optional() }), req.query);
    const airportCodes = q.airport ? [q.airport] : all<{ location: string }>(db, 'SELECT DISTINCT location FROM aircraft WHERE company_id = ? AND returned_at IS NULL ORDER BY location', p.companyId).map((a) => a.location);
    const at = now();
    return { jobs: airportCodes.flatMap((icao) => openBoard(db, icao, at)), imported: pendingImports(db, p.companyId, at) };
  });

  app.post('/api/v1/jobs/import-simbrief', async (req, reply) => {
    const p = user(req);
    const b = parse(simbriefImportSchema, req.body);
    const ofp = await fetchLatestOfp(b.simbriefUsername.trim(), doFetch);
    const job = tx(db, () => importJob(db, p.companyId, ofp, now()));
    return reply.status(201).send(job);
  });

  app.post('/api/v1/jobs/:id/accept', async (req, reply) => {
    const p = user(req);
    const b = parse(acceptJobSchema, req.body);
    const jobId = String((req.params as { id: string }).id);
    const f = tx(db, () => acceptJob(db, p.companyId, jobId, b.aircraftId, now()));
    return reply.status(201).send(flightView(f));
  });

  app.get('/api/v1/me/flights', async (req) => {
    const q = parse(flightListQuerySchema, req.query);
    return flightsOf(db, user(req).companyId, q.limit, q.before, q.status).map(flightView);
  });

  app.post('/api/v1/flights/:id/cancel', async (req) => {
    const p = user(req);
    return flightView(tx(db, () => closeUnpaid(db, activeFlight(db, idParam(req), p.userId, p.companyId), 'cancelled', now())));
  });

  // Manual completion: no telemetry, so the flight is unverified (reduced pay) and, with anti-cheat on, only allowed once the fastest believable flight time has passed.
  app.post('/api/v1/flights/:id/complete', async (req) => {
    const p = user(req);
    return flightView(tx(db, () => completeManually(db, activeFlight(db, idParam(req), p.userId, p.companyId), now(), info.antiCheat)));
  });

  // ---- verification ingest (per-player API key). Keys can do exactly two things: list active flights and submit telemetry.
  // A key spans all of the player's companies: each flight names its company, and ownership is checked against the flight.
  app.get('/api/v1/flights/active', async (req) => {
    const p = apiKeyAuth(db, req, now());
    return activeFlightsOfUser(db, p.userId, 50).map(flightView);
  });

  app.post('/api/v1/flights/:id/telemetry-verify', async (req) => {
    const p = apiKeyAuth(db, req, now());
    const report = parse(telemetrySchema, req.body);
    const at = now();
    return tx(db, () => {
      const f = activeFlight(db, idParam(req), p.userId);
      const check = checkTelemetry(report, {
        origin: f.origin, destination: f.destination, distanceNm: f.distance_nm, payloadKg: f.payload_kg, aircraftIcao: f.aircraft_icao,
        aircraft: typeFor(db, f.company_id, f.aircraft_icao), acceptedAt: f.accepted_at, now: at, antiCheat: info.antiCheat,
      });
      if (!check.ok) return { verification: 'rejected', reason: check.reason, flight: flightView(closeUnpaid(db, f, 'rejected', at, check.reason, report)) };
      // manual reports are never trusted as verified: reduced pay, no measured values
      if (report.source === 'manual') return { verification: 'unverified', reason: null, flight: flightView(finishFlight(db, f, 'unverified', at, { telemetry: report, blockHours: check.blockHours })) };
      return { verification: 'verified', reason: null, flight: flightView(finishFlight(db, f, 'verified', at, { telemetry: report, blockHours: check.blockHours })) };
    });
  });

  registerFinance(app, { db, now });

  return app;
}
