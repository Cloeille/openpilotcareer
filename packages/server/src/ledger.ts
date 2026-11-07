// The ledger primitive: one posting moves the company's balance and records the line. A leaf (database only) so the engines that post money
// (game, lines, safety) share it without importing each other. game.ts re-exports `post` for the callers that already import it from there.
import { get, run, type Db } from './db.ts';
import { HttpError } from './http.ts';

/** What a posting is about, for the statement and the profitability reports (v4 REPORTS). Every field is optional: most postings are about the company as a whole.
 *  `legs`: how many flown legs a revenue posting covers (1 for a leg or a flight, `xN` for a bulk-booked day); only the revenue posting of a leg carries it. */
export type Tags = { lineId?: number; aircraftId?: number; counterpartyId?: number; legs?: number };

export function post(db: Db, companyId: number, at: number, kind: string, amount: number, memo: string, flightId: number | null = null, tags: Tags = {}): void {
  const row = get<{ balance: number }>(db, 'UPDATE companies SET balance = balance + ? WHERE id = ? RETURNING balance', amount, companyId);
  if (!row) throw new HttpError(404, 'company_not_found', 'company not found');
  run(db, 'INSERT INTO transactions (company_id, at, kind, amount, balance_after, flight_id, memo, line_id, aircraft_id, counterparty_id, legs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    companyId, at, kind, amount, row.balance, flightId, memo, tags.lineId ?? null, tags.aircraftId ?? null, tags.counterpartyId ?? null, tags.legs ?? 0);
}
