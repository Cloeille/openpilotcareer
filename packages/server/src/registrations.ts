// Aircraft registrations: deterministic and unique per server. Country prefix tables live in @opc/shared (finance.ts).
// Raw prepared statements on purpose: db.ts calls the backfill from openDb, so this file must not import db.ts values.
import { formatRegistration, registrationPrefix } from '@opc/shared';
import type { DatabaseSync } from 'node:sqlite';
import { airports } from './catalog.ts';

const MAX_PROBES = 20_000;

/** The registration an aircraft based at `hub` gets next: the first free one in the prefix' sequence. */
export function nextRegistration(db: DatabaseSync, hub: string): string {
  const prefix = registrationPrefix(airports.get(hub)?.country, hub);
  const used = db.prepare('SELECT COUNT(*) AS n FROM aircraft WHERE registration LIKE ?').get(`${prefix}%`) as { n: number };
  const taken = db.prepare('SELECT 1 AS x FROM aircraft WHERE registration = ?');
  for (let n = Number(used.n), i = 0; i < MAX_PROBES; n++, i++) {
    const r = formatRegistration(prefix, n);
    if (!taken.get(r)) return r;
  }
  throw new Error(`registration space exhausted for prefix ${prefix}`);
}

/** Give every aircraft without a registration one, in id order, from its base (else its location). Idempotent. */
export function backfillRegistrations(db: DatabaseSync): number {
  const rows = db.prepare('SELECT id, COALESCE(base, location) AS hub FROM aircraft WHERE registration IS NULL ORDER BY id').all() as { id: number; hub: string }[];
  const set = db.prepare('UPDATE aircraft SET registration = ? WHERE id = ?');
  for (const r of rows) set.run(nextRegistration(db, r.hub), r.id);
  return rows.length;
}
