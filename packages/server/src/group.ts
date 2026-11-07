// Lot GROUP (v4): a parent company, its subsidiaries, what the group moves between them and the consolidated view (docs/v4-plan.md A.3, B.1, C21, C32, C33).
// A subsidiary is a company row with `parent_id` (game.ts `createCompany`, the one creation path, in its zero-capital mode). Routes live in routes-group.ts and wrap the writes in `tx`.
//  - Cash goes through `post()` on both sides with `counterparty_id` set; the sum of the two balances never changes, and the sender is held to `spendable` like every other payment.
//  - An aircraft is ceded at book value: the row changes owner (its `value` is the book value and stays), no money is created or destroyed, a loan on it follows it.
//  - The consolidated view adds up the companies' own cash reports (reports.ts) and counts (company-lifecycle.ts `companyImpact`); nothing is recomputed here.
import {
  CESSION_REFUSALS, MAX_COMPANIES_PER_USER,
  type CashView, type CessionRefusal, type GroupAircraft, type GroupCompany, type GroupCreated, type GroupMonth, type GroupTotals, type GroupView, type SubsidiaryRequest, type GroupTransferRequest,
} from '@opc/shared';
import { ownedCompany } from './auth.ts';
import { companyImpact } from './company-lifecycle.ts';
import { all, get, run, type Db } from './db.ts';
import { assertHubSpot, assertIdle } from './fleet-extras.ts';
import { monthKey, runBilling } from './finance.ts';
import { addMonths, balanceOf, companyView, createCompany, snapshot, spendable, type AircraftRow } from './game.ts';
import { HttpError, refusalOf } from './http.ts';
import { post } from './ledger.ts';
import { ownAircraft } from './parts.ts';
import { cashView } from './reports.ts';

type Member = { id: number; name: string; code: string | null; iata: string | null; activity: GroupCompany['activity']; parent_id: number | null };

/** The parent (a root company) and the subsidiaries, in the order they were founded. `companyId` is any member and the caller has proven it is the player's own. */
function membersOf(db: Db, companyId: number): Member[] {
  const root = get<{ parent_id: number | null }>(db, 'SELECT parent_id FROM companies WHERE id = ?', companyId)!.parent_id ?? companyId;
  return all<Member>(db, 'SELECT id, name, code, iata, activity, parent_id FROM companies WHERE id = ?1 OR parent_id = ?1 ORDER BY parent_id IS NOT NULL, id', root);
}

// ---------------------------------------------------------------- cession (C33)

/** Why `a` cannot be ceded now, as the refusal a cession would answer with. Only an aircraft the company owns (outright or on a loan) moves: leased, club and rented ones belong to their lessor. */
function cessionRefusal(db: Db, a: AircraftRow, now: number): HttpError | null {
  if (a.ownership !== 'owned' && a.ownership !== 'financed') return new HttpError(409, 'leased_aircraft', `${a.registration ?? `#${a.id}`} is ${a.ownership}, not owned: only an owned aircraft can be ceded`);
  return refusalOf(() => assertIdle(db, a.id, now));
}

/** Hand the aircraft to `to` at book value. The registration, value, wear and the loan on it stay with it; it keeps its base when `to` has that hub, else it is based at `to`'s main hub, where a parking spot must be free. */
function cede(db: Db, from: number, to: number, aircraftId: number, now: number): void {
  const a = ownAircraft(db, from, aircraftId);
  const refusal = cessionRefusal(db, a, now);
  if (refusal) throw refusal;
  const hubs = all<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY rowid', to).map((h) => h.icao);
  const base = a.base !== null && hubs.includes(a.base) ? a.base : hubs[0]!;
  assertHubSpot(db, to, base, now);
  run(db, 'UPDATE aircraft SET company_id = ?, base = ? WHERE id = ?', to, base, a.id);
  run(db, "UPDATE contracts SET company_id = ? WHERE aircraft_id = ? AND status = 'active' AND kind = 'loan'", to, a.id);
}

// ---------------------------------------------------------------- cash

function wire(db: Db, from: number, to: number, amount: number, now: number): void {
  if (spendable(db, from) < amount) {
    const missing = amount - spendable(db, from);
    throw new HttpError(409, 'insufficient_funds', `needs ${missing} more`, { needed: amount, balance: balanceOf(db, from), missing });
  }
  const name = (id: number): string => get<{ name: string }>(db, 'SELECT name FROM companies WHERE id = ?', id)!.name;
  post(db, from, now, 'group_transfer', -amount, `transfer to ${name(to)}`, null, { counterpartyId: to });
  post(db, to, now, 'group_transfer', amount, `transfer from ${name(from)}`, null, { counterpartyId: from });
}

/** Move cash and aircraft from `from` to `to`, which are the player's own and one the parent of the other. All or nothing: the caller wraps it in `tx`, so the first refusal undoes the rest. */
function transferBatch(db: Db, from: number, to: number, b: { cash: number; aircraftIds: readonly number[] }, now: number): void {
  for (const id of b.aircraftIds) cede(db, from, to, id, now);
  if (b.cash > 0) wire(db, from, to, b.cash, now);
  snapshot(db, from, now);
  snapshot(db, to, now);
}

/** `POST /group/transfers`. Both companies are authorised at user level (not through the active-company header), and only a parent and its own subsidiary exchange anything, either way. */
export function transfer(db: Db, userId: number, b: GroupTransferRequest, now: number): GroupView {
  const from = ownedCompany(db, userId, b.from), to = ownedCompany(db, userId, b.to);
  if (!(get(db, 'SELECT 1 AS x FROM companies WHERE id = ? AND parent_id = ?', to, from) || get(db, 'SELECT 1 AS x FROM companies WHERE id = ? AND parent_id = ?', from, to))) {
    throw new HttpError(409, 'not_in_group', 'only a parent company and its subsidiary can exchange cash and aircraft');
  }
  runBilling(db, from, now); runBilling(db, to, now);
  transferBatch(db, from, to, b, now);
  return groupView(db, from, now);
}

/** `POST /group/subsidiaries`: the active company (`parentId`, the player's own) founds a subsidiary, then funds it by the same transfer a later one would be. No starting grant (C21): a refusal anywhere, the cap and a short balance included, founds nothing. */
export function createSubsidiary(db: Db, userId: number, parentId: number, b: SubsidiaryRequest, now: number): GroupCreated {
  const id = createCompany(db, { userId, parentId, name: b.name, hub: b.hub, now, code: b.code, activity: b.activity, ...(b.callsign !== undefined ? { callsign: b.callsign } : {}), ...(b.iata !== undefined ? { iata: b.iata } : {}) });
  runBilling(db, parentId, now);
  transferBatch(db, parentId, id, { cash: b.funding, aircraftIds: b.aircraftIds }, now);
  return { id, group: groupView(db, parentId, now) };
}

// ---------------------------------------------------------------- the consolidated view

/** The last closed month of one company from its own cash report, capital movements taken out: grants, bailouts and what the group wires between its companies are not results. */
function monthOf(cash: CashView, month: string): GroupMonth {
  const m = cash.months.find((x) => x.month === month);
  if (!m) return { revenue: 0, spend: 0, result: 0 };
  const capital = m.byCategory.find((c) => c.category === 'capital');
  return { revenue: m.revenue, spend: m.spend - (capital?.out ?? 0), result: m.net - (capital?.in ?? 0) + (capital?.out ?? 0) };
}

const cessionOf = (db: Db, a: AircraftRow, now: number): CessionRefusal | null => {
  const refusal = cessionRefusal(db, a, now);
  if (!refusal) return null;
  const code = CESSION_REFUSALS.find((c) => c === refusal.code);
  if (!code) throw refusal;
  return code;
};

const fleetOf = (db: Db, companyId: number, now: number): GroupAircraft[] =>
  all<AircraftRow>(db, 'SELECT * FROM aircraft WHERE company_id = ? AND returned_at IS NULL ORDER BY id', companyId)
    .map((a) => ({ id: a.id, registration: a.registration ?? `#${a.id}`, icao: a.icao, location: a.location, value: a.value, cession: cessionOf(db, a, now) }));

/** The group `companyId` belongs to, whichever member it is. The totals are the sums of the members' own figures; `netWorth` is the parent's, which already holds its subsidiaries (game.ts NET_WORTH_SQL). */
export function groupView(db: Db, companyId: number, now: number): GroupView {
  const month = monthKey(addMonths(now, -1));
  const members = membersOf(db, companyId);
  const companies = members.map((m): GroupCompany => {
    const impact = companyImpact(db, m.id, now);
    return {
      id: m.id, name: m.name, code: m.code, iata: m.iata, activity: m.activity, role: m.parent_id === null ? 'parent' : 'subsidiary',
      hub: get<{ icao: string }>(db, 'SELECT icao FROM hubs WHERE company_id = ? ORDER BY rowid LIMIT 1', m.id)?.icao ?? null,
      balance: impact.balance, month: monthOf(cashView(db, m.id, now, 2), month), aircraft: impact.aircraft, staff: impact.staff, lines: impact.lines, fleet: fleetOf(db, m.id, now),
    };
  });
  const sum = (pick: (c: GroupCompany) => number): number => companies.reduce((t, c) => t + pick(c), 0);
  const total: GroupTotals = {
    revenue: sum((c) => c.month.revenue), spend: sum((c) => c.month.spend), result: sum((c) => c.month.result), balance: sum((c) => c.balance),
    aircraft: sum((c) => c.aircraft), staff: sum((c) => c.staff), lines: sum((c) => c.lines), netWorth: companyView(db, members[0]!.id).netWorth,
  };
  const owned = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM companies WHERE user_id = (SELECT user_id FROM companies WHERE id = ?)', companyId)!.n;
  const createRefusal = members.some((m) => m.id === companyId && m.parent_id !== null) ? 'is_subsidiary' : owned >= MAX_COMPANIES_PER_USER ? 'limit_reached' : null;
  return { month, total, companies, createRefusal };
}
