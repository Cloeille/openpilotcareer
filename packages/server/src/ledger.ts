// The ledger primitive: one posting moves the company's balance and records the line. A leaf (database only) so the engines that post money
// (game, lines, safety) share it without importing each other. game.ts re-exports `post` for the callers that already import it from there.
import { get, run, type Db } from './db.ts';
import { HttpError } from './http.ts';

export function post(db: Db, companyId: number, at: number, kind: string, amount: number, memo: string, flightId: number | null = null): void {
  const row = get<{ balance: number }>(db, 'UPDATE companies SET balance = balance + ? WHERE id = ? RETURNING balance', amount, companyId);
  if (!row) throw new HttpError(404, 'company_not_found', 'company not found');
  run(db, 'INSERT INTO transactions (company_id, at, kind, amount, balance_after, flight_id, memo) VALUES (?, ?, ?, ?, ?, ?, ?)', companyId, at, kind, amount, row.balance, flightId, memo);
}
