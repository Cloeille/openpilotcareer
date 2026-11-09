// Which companies a read covers: the company alone, or (`scope=group`) the company and its subsidiaries. A leaf (database only), shared by the ledger, the statement, the CSV and the network.
import type { Scope } from '@opc/shared';
import { all, get, type Db } from './db.ts';

export type Book = { id: number; name: string; code: string | null };

/** The asked company first, then (for `group`) its subsidiaries in the order they were founded. `companyId` is the player's own, proven by auth.ts: only its children are ever added, and a subsidiary has none (one level,
 *  game.ts `createCompany`), so asking for the group from a subsidiary reads the subsidiary alone: its parent and siblings are never reachable. */
export const booksOf = (db: Db, companyId: number, scope: Scope): Book[] =>
  all<Book>(db, `SELECT id, name, code FROM companies WHERE id = ?1 OR (?2 = 'group' AND parent_id = ?1) ORDER BY id = ?1 DESC, id`, companyId, scope);

/** The ids for an `IN (...)`: integers read from the database, so inlining them cannot inject anything. */
export const idsOf = (books: readonly Book[]): string => books.map((b) => b.id).join(',');

/** A posting that moves cash between two companies of the books read (a `group_transfer` whose other leg is on one of them): it is on both books, so a consolidated total leaves it out. Never true on a single book, and a
 *  leg whose other company is gone (a subsidiary dissolved into its parent) is a real movement. Needs `t.kind` and `t.counterparty_id` in scope. */
export const internalSql = (books: readonly Book[]): string => `(t.kind = 'group_transfer' AND COALESCE(t.counterparty_id IN (${idsOf(books)}), 0))`;

/** How many subsidiaries `companyId` has, whichever scope is read: the toggle is shown for it. */
export const subsidiaryCount = (db: Db, companyId: number): number => get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM companies WHERE parent_id = ?', companyId)!.n;
