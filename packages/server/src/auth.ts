import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { get, run, type Db } from './db.ts';
import { HttpError } from './http.ts';

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

export type Principal = { userId: number; companyId: number; username: string };
const PRINCIPAL_SQL = `SELECT u.id AS userId, c.id AS companyId, u.username AS username FROM users u JOIN companies c ON c.user_id = u.id`;

/** Session-token auth for the web app. Throws 401. */
export function sessionAuth(db: Db, req: FastifyRequest, now: number): Principal & { token: string } {
  const token = bearer(req);
  const p = token && get<Principal>(db, `${PRINCIPAL_SQL} JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?`, sha256(token), now);
  if (!token || !p) throw new HttpError(401, 'unauthorized', 'missing or invalid session token');
  return { ...p, token };
}

/** API-key auth for telemetry clients. Throws 401. */
export function apiKeyAuth(db: Db, req: FastifyRequest, now: number): Principal {
  const key = bearer(req);
  const row = key && get<Principal & { keyId: number }>(db, `SELECT u.id AS userId, c.id AS companyId, u.username AS username, k.id AS keyId
    FROM api_keys k JOIN users u ON u.id = k.user_id JOIN companies c ON c.user_id = u.id WHERE k.key_hash = ?`, sha256(key));
  if (!key || !row) throw new HttpError(401, 'unauthorized', 'missing or invalid API key');
  run(db, 'UPDATE api_keys SET last_used_at = ? WHERE id = ?', now, row.keyId);
  return row;
}
