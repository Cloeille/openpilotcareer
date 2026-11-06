import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { get, run, type Db } from './db.ts';
import { HttpError, NUMERIC_ID } from './http.ts';

const SESSION_MS = 30 * 24 * 3_600_000;
const KEY_LEN = 64;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const newToken = (prefix = ''): string => prefix + randomBytes(32).toString('base64url');

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, KEY_LEN, (e, k) => (e ? reject(e) : resolve(k))));

/** scrypt with Node's default cost parameters; stored as `salt:hash` (base64). ponytail: no parameter versioning yet. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${(await derive(password, salt)).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Verified against when the username is unknown, so login time does not reveal which usernames exist. */
export const DUMMY_HASH = hashPassword('not-a-real-password');

export function createSession(db: Db, userId: number, now: number): string {
  const token = newToken();
  run(db, 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, now + SESSION_MS);
  return token;
}

const bearer = (req: FastifyRequest): string | null => /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;

/** A player owns one or more companies; a request acts as exactly one of them (`companyId`, the ACTIVE company). */
export type User = { userId: number; username: string };
export type Principal = User & { companyId: number };

export const COMPANY_HEADER = 'x-opc-company';

/** The ownership check: every company id a client names (the active-company header, `PATCH /companies/:id`) passes through here.
 *  403 for a company that is someone else's, an AI company or nonexistent alike, so the answer reveals nothing. */
export function ownedCompany(db: Db, userId: number, companyId: number): number {
  if (!get(db, 'SELECT 1 AS x FROM companies WHERE id = ? AND user_id = ?', companyId, userId)) {
    if (!get(db, 'SELECT 1 AS x FROM companies WHERE user_id = ?', userId)) throw new HttpError(409, 'no_company', 'you have no company yet: finish the onboarding');
    throw new HttpError(403, 'not_your_company', 'that company is not yours');
  }
  return companyId;
}

/** The company a request acts as when it names none (and the one shown after login): the player's oldest. Null while the player has none yet (onboarding). */
export const defaultCompany = (db: Db, userId: number): number | null => get<{ id: number }>(db, 'SELECT id FROM companies WHERE user_id = ? ORDER BY id LIMIT 1', userId)?.id ?? null;

function activeCompany(db: Db, userId: number, req: FastifyRequest): number | null {
  const raw = req.headers[COMPANY_HEADER];
  if (raw === undefined) return defaultCompany(db, userId);
  if (typeof raw !== 'string' || !NUMERIC_ID.test(raw)) throw new HttpError(400, 'invalid_request', `${COMPANY_HEADER} must be a company id`);
  return ownedCompany(db, userId, Number(raw));
}

/** Session-token auth for account-level routes (no company needed: onboarding, API keys, company list). `companyId` is null for a player who has no company yet.
 *  Throws 401 (bad session), then 403 (company header not yours). */
export function sessionUser(db: Db, req: FastifyRequest, now: number): User & { token: string; companyId: number | null } {
  const token = bearer(req);
  const u = token && get<User>(db, 'SELECT u.id AS userId, u.username AS username FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?', sha256(token), now);
  if (!token || !u) throw new HttpError(401, 'unauthorized', 'missing or invalid session token');
  return { ...u, token, companyId: activeCompany(db, u.userId, req) };
}

/** Session auth for company-scoped routes, resolving the active company. Throws 401, then 403 (company not yours), then 409 `no_company` (the player has not founded one yet). */
export function sessionAuth(db: Db, req: FastifyRequest, now: number): Principal & { token: string } {
  const u = sessionUser(db, req, now);
  if (u.companyId === null) throw new HttpError(409, 'no_company', 'you have no company yet: finish the onboarding');
  return { ...u, companyId: u.companyId };
}

/** API-key auth for telemetry clients. A key belongs to the player, not to one company: flights carry their company. Throws 401. */
export function apiKeyAuth(db: Db, req: FastifyRequest, now: number): User {
  const key = bearer(req);
  const row = key && get<User & { keyId: number }>(db, 'SELECT u.id AS userId, u.username AS username, k.id AS keyId FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?', sha256(key));
  if (!key || !row) throw new HttpError(401, 'unauthorized', 'missing or invalid API key');
  run(db, 'UPDATE api_keys SET last_used_at = ? WHERE id = ?', now, row.keyId);
  return row;
}
