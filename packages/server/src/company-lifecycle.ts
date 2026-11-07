// Deleting a company and resetting it. Both are the database's own cascade: every company table references companies(id) ON DELETE CASCADE
// (and the child tables of those by their parent), so removing the `companies` row removes everything that belongs to it, in the caller's transaction.
// Nothing here lists tables: a table added later is covered as long as it cascades, and lifecycle.test.ts fails the build when one does not.
// The one exception is `onboarding.company_id` (ON DELETE SET NULL): it is a pointer on the player's own row, and is fixed up explicitly below.
//
// Season history (`season_stats`, the leaderboard's past months) hangs off the company and goes with it: a deleted company leaves no ranking behind.
import type { CompanyImpact, StartMode } from '@opc/shared';
import { all, get, run, type Db } from './db.ts';
import { createCompany, hasSubsidiaries } from './game.ts';
import { HttpError } from './http.ts';
import { post } from './ledger.ts';
import { onboardingOf, save } from './start.ts';

/** A parent with subsidiaries is neither deleted nor reset (409 `has_subsidiaries`): the cascade of `companies.parent_id` would take them with it, and detaching them would hand each one a life of its own
 *  (on the leaderboard, outside the cap logic of the group). The player deletes the subsidiaries first, which shows what each one holds. A subsidiary is not reset either (409 `is_subsidiary`):
 *  re-founding it through the start modes would give it the starting capital a subsidiary never gets (C21); she deletes it and founds a new one. */
function assertGroupIntact(db: Db, companyId: number, action: 'delete' | 'reset'): void {
  if (hasSubsidiaries(db, companyId)) throw new HttpError(409, 'has_subsidiaries', `delete its subsidiaries before you ${action} this company`);
  if (action === 'reset' && get(db, 'SELECT 1 AS x FROM companies WHERE id = ? AND parent_id IS NOT NULL', companyId)) throw new HttpError(409, 'is_subsidiary', 'a subsidiary cannot be reset: delete it and found a new one');
}

function assertNoActiveFlight(db: Db, companyId: number): void {
  if (get(db, "SELECT 1 AS x FROM flights WHERE company_id = ? AND status = 'active'", companyId)) {
    throw new HttpError(409, 'flight_active', 'finish or cancel the flight in progress first');
  }
}

/** What a delete or a reset would erase, for the confirmation dialog. `flightActive`: the action is refused right now. */
export function companyImpact(db: Db, companyId: number, now: number): CompanyImpact {
  const n = (sql: string, ...p: number[]): number => get<{ n: number }>(db, sql, ...p)!.n;
  return {
    aircraft: n('SELECT COUNT(*) AS n FROM aircraft WHERE company_id = ? AND returned_at IS NULL', companyId),
    lines: n('SELECT COUNT(*) AS n FROM lines WHERE company_id = ?', companyId),
    staff: n('SELECT COUNT(*) AS n FROM staff WHERE company_id = ? AND (ends_at IS NULL OR ends_at > ?)', companyId, now),
    flights: n("SELECT COUNT(*) AS n FROM flights WHERE company_id = ? AND status IN ('verified', 'unverified')", companyId),
    balance: get<{ balance: number }>(db, 'SELECT balance FROM companies WHERE id = ?', companyId)!.balance,
    flightActive: !!get(db, "SELECT 1 AS x FROM flights WHERE company_id = ? AND status = 'active'", companyId),
  };
}

/** A subsidiary's balance goes back to its parent when it is deleted, a debt included: the parent owns it 100 %, so deleting it can neither burn cash nor wipe an overdraft (which would make a subsidiary a way to mint 250 000). */
function settleWithParent(db: Db, companyId: number, now: number): void {
  const c = get<{ parent_id: number | null; name: string; balance: number }>(db, 'SELECT parent_id, name, balance FROM companies WHERE id = ?', companyId)!;
  if (c.parent_id !== null && c.balance !== 0) post(db, c.parent_id, now, 'group_transfer', c.balance, `closing ${c.name}`, null, { counterpartyId: companyId });
}

/** The caller has proven `companyId` is the player's own (auth.ts `ownedCompany`: AI companies never are) and wraps this in `tx`.
 *  The player's last company going away puts the account back before the onboarding: its row is dropped so `GET /onboarding` says "not completed" again. */
export function deleteCompany(db: Db, userId: number, companyId: number, now: number): void {
  assertNoActiveFlight(db, companyId);
  assertGroupIntact(db, companyId, 'delete');
  const pointedAt = !!get(db, 'SELECT 1 AS x FROM onboarding WHERE company_id = ?', companyId);
  settleWithParent(db, companyId, now);
  run(db, 'DELETE FROM companies WHERE id = ?', companyId);
  if (!get(db, 'SELECT 1 AS x FROM companies WHERE user_id = ?', userId)) run(db, 'DELETE FROM onboarding WHERE user_id = ?', userId);
  // `onboarding.company_id` is the one reference without a cascade (ON DELETE SET NULL). Left alone, an unfinished onboarding of the deleted company would keep a mode and a step with no company behind it.
  else if (pointedAt) save(db, userId, { completed: true, step: 6, startMode: null, companyId: null, draft: {} }, now);
}

/** Start the company over: the same id, name, code, callsign and livery colour, a new career from `startMode` (capital, no aircraft, the mode's suggested realism),
 *  then the onboarding is pointed at it at step 3 (first aircraft), exactly where founding a company leaves the player.
 *
 *  Why delete + re-found rather than an in-place wipe: the cascade guarantees nothing of the old career survives (an in-place wipe is a list of tables that
 *  rots when a table is added), and `createCompany` guarantees the new one is born exactly like any other (ledger grant, billing month, realism, hub). The id
 *  survives because SQLite accepts an explicit id once the row is gone, so the client's remembered active company and every link to it stay valid.
 *  `hub`: the new main hub, by default the company's first one. */
export function resetCompany(db: Db, userId: number, companyId: number, b: { startMode: StartMode; hub?: string | undefined }, now: number): void {
  assertNoActiveFlight(db, companyId);
  assertGroupIntact(db, companyId, 'reset');
  const founding = onboardingOf(db, userId);
  if (!founding.completed && founding.companyId !== null && founding.companyId !== companyId) throw new HttpError(409, 'onboarding_pending', 'finish or drop the company you are founding first');
  const c = get<{ name: string; code: string | null; callsign: string | null; livery_color: string | null }>(db, 'SELECT name, code, callsign, livery_color FROM companies WHERE id = ?', companyId)!;
  const hub = b.hub ?? all<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY icao', companyId)[0]?.icao;
  if (!hub) throw new HttpError(409, 'no_hub', 'the company has no hub to restart from: name one');
  run(db, 'DELETE FROM companies WHERE id = ?', companyId);
  createCompany(db, {
    id: companyId, userId, name: c.name, hub, now, startMode: b.startMode,
    ...(c.code !== null ? { code: c.code } : {}), ...(c.callsign !== null ? { callsign: c.callsign } : {}), liveryColor: c.livery_color,
  });
  save(db, userId, { completed: false, step: 3, startMode: b.startMode, companyId, draft: {} }, now);
}

