// Lot FINANCE domain: monthly billing (pure planner + lazy idempotent runner), leases, rentals, loans. Like game.ts, nothing
// here opens a transaction (callers use `tx`) and rule violations throw HttpError. The money still moves through game.ts `post`.
import {
  CLUB, CREDIT_INSTALMENT, LOAN_QUOTE_DOWN_PCTS, LOAN_QUOTE_MONTHS, MONTHLY_RENTAL, PARKING_FEE_BY_SIZE, aircraftPrice, aircraftValue, loanOption, loanStep, NO_CREDIT, planCreditMonth, planFacilityMonth,
  type AircraftCategory, type CreditInputs, type CreditState, type FinanceCharge, type FinanceContract, type FinanceOverview, type FleetQuote, type LeaseOffer, type Ownership, type PlanFacility, type PurchaseResult,
} from '@opc/shared';
import { airports } from './catalog.ts';
import { activeCredits, overdraftLow, saveCredits, settleLate } from './credit.ts';
import { planRows, savePlanRows } from './facilities.ts';
import { all, get, run, type Db } from './db.ts';
import { applyBailout, startModeOf } from './start.ts';
import {
  assertHubSpot, ferryFee, insertAircraft, insuranceMonthly, releaseMaintenance, type ContractRow, type LeaseTerms,
} from './fleet-extras.ts';
import { addMonths, balanceOf, fleetView, post, snapshot, spendable, typeFor } from './game.ts';
import { insuranceRise } from './safety.ts';
import { HttpError } from './http.ts';
import { dayOf, leaseOffer, parseOfferId } from './leasing.ts';

const MAX_CATCHUP_MONTHS = 12;
const MAX_CLUB_AIRCRAFT = 1;
export const monthKey = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
const monthStart = (key: string): number => Date.parse(`${key}-01T00:00:00Z`);
const nextMonthKey = (key: string): string => monthKey(addMonths(monthStart(key), 1));

const hasHub = (db: Db, companyId: number, icao: string): boolean => !!get(db, 'SELECT 1 AS x FROM hubs WHERE company_id = ? AND icao = ?', companyId, icao);
const short = (needed: number, extra: Record<string, unknown> = {}): HttpError => new HttpError(409, 'insufficient_funds', `needs ${needed} more`, { needed, ...extra });

// ---------------------------------------------------------------- monthly plan (pure)

export type PlanContract = Pick<ContractRow, 'id' | 'aircraft_id' | 'kind' | 'started_at' | 'ends_at' | 'months' | 'months_paid' | 'monthly' | 'insurance' | 'deposit' | 'principal'>;
export type PlanAircraft = { id: number; registration: string; base: string | null; ownership: Ownership; value: number; category: AircraftCategory; acquired_at: number; busy: boolean };
export type Charge = { kind: string; amount: number; memo: string; /** The aircraft the charge is about (the reports file it under that aircraft). */ aircraftId?: number };
/** Who is on the payroll: employees on a permanent contract (a temporary one is paid up front when it is booked). */
/** `since`: the later of the contract start and the day the person was hired, so a starter crew granted at the upgrade is paid from the next month, never retroactively. */
export type PlanStaff = { salary: number; since: number; ends_at: number | null };
export type MonthPlan = { charges: Charge[]; contracts: PlanContract[]; facilities: PlanFacility[]; credits: CreditState[]; ended: number[]; returned: number[]; owned: number[] };

/** What the month starting at `start` (UTC, the 1st) costs. Everything signed or bought before `start` is billed; things signed this month were paid at signing.
 *  Returns the new contract states without touching the input, so `GET /me/finance` can project several months with the same rules billing uses. */
export function planMonth(start: number, contracts: PlanContract[], fleet: PlanAircraft[], staff: PlanStaff[] = [], facilities: PlanFacility[] = [], rise = 0, credit: CreditInputs = NO_CREDIT): MonthPlan {
  const charges: Charge[] = [];
  const ended: number[] = [], returned: number[] = [], owned: number[] = [];
  const reg = (id: number): string => fleet.find((a) => a.id === id)?.registration ?? `#${id}`;
  // v3 SAFETY: the premium rises by the share the last month's incidents earned (shared/safety.ts `insuranceSurcharge`), on every insurance charge.
  const premium = (base: number, who: string, aircraftId: number): Charge => ({ kind: 'insurance', amount: -Math.round(base * (1 + rise)), memo: `${who} insurance${rise > 0 ? ` +${Math.round(rise * 100)} %` : ''}`, aircraftId });
  const next = contracts.map((c) => {
    if (c.started_at >= start) return { ...c };
    const n = { ...c };
    const a = fleet.find((x) => x.id === c.aircraft_id);
    if (c.kind === 'lease') {
      if (n.months_paid < (n.months ?? 0)) {
        n.months_paid++;
        charges.push({ kind: 'lease_rent', amount: -n.monthly, memo: `${reg(c.aircraft_id)} rent ${n.months_paid}/${n.months}`, aircraftId: c.aircraft_id });
        if (n.insurance > 0) charges.push(premium(n.insurance, reg(c.aircraft_id), c.aircraft_id));
      } else if (n.ends_at !== null && start >= n.ends_at && !a?.busy) {
        if (n.deposit > 0) charges.push({ kind: 'deposit_refund', amount: n.deposit, memo: `${reg(c.aircraft_id)} deposit returned` });
        ended.push(n.id); returned.push(n.aircraft_id);
      }
    } else if (c.kind === 'rental') {
      n.months_paid++;
      charges.push({ kind: 'lease_rent', amount: -n.monthly, memo: `${reg(c.aircraft_id)} monthly rental ${n.months_paid}`, aircraftId: c.aircraft_id });
    } else if (c.kind === 'loan' && n.months_paid < (n.months ?? 0)) {
      const step = loanStep(n.principal, n.monthly, n.months_paid, n.months!);
      n.principal = step.principal;
      n.months_paid++;
      charges.push({ kind: 'loan_installment', amount: -step.pay, memo: `${reg(c.aircraft_id)} instalment ${n.months_paid}/${n.months}`, aircraftId: c.aircraft_id });
      if (step.last) { ended.push(n.id); owned.push(n.aircraft_id); }
    }
    return n;
  });
  const gone = new Set(returned);
  for (const a of fleet) {
    if (a.acquired_at >= start || gone.has(a.id)) continue;
    if ((a.ownership === 'owned' || a.ownership === 'financed') ) charges.push(premium(insuranceMonthly(a.value, a.category), a.registration, a.id));
    if (a.ownership !== 'club' && a.ownership !== 'rented' && a.base) {
      charges.push({ kind: 'parking', amount: -PARKING_FEE_BY_SIZE[airports.get(a.base)?.size ?? 'small'], memo: `${a.registration} parking ${a.base}`, aircraftId: a.id });
    }
  }
  // C7: payroll is its own charge. Whoever started before the 1st and has not left by it is paid for the month (the hiring premium covered the month they joined).
  const paid = staff.filter((p) => p.since < start && (p.ends_at === null || p.ends_at > start));
  if (paid.length > 0) charges.push({ kind: 'payroll', amount: -paid.reduce((t, p) => t + p.salary, 0), memo: `payroll ${paid.length} people` });
  // v3 facilities: rent, upkeep, instalments and the sale of maintenance of the buildings she holds (shared/facilities.ts), billed like everything else
  const built = planFacilityMonth(start, facilities);
  charges.push(...built.charges);
  // v4 CREDIT: the overdraft interest of the month just over and the consumer-credit instalments come last, so the late rule reads the account after every other bill
  const lent = planCreditMonth(start, credit);
  charges.push(...lent.charges);
  return { charges, contracts: next, facilities: built.rows, credits: lent.credits, ended, returned, owned };
}

export type PlanInputs = { contracts: PlanContract[]; fleet: PlanAircraft[]; staff: PlanStaff[]; facilities: PlanFacility[]; credit: CreditInputs };

/** What the next billing charges, seen from `at`. `low`: the lowest balance of the month whose overdraft interest it bills; by default the month in progress (a projection), billing passes the month that just ended. */
export function planInputs(db: Db, companyId: number, at: number, low: number = overdraftLow(db, companyId, addMonths(at, 0), at + 1)): PlanInputs {
  const contracts = all<ContractRow>(db, "SELECT * FROM contracts WHERE company_id = ? AND status = 'active' ORDER BY id", companyId);
  const fleet = all<{ id: number; icao: string; registration: string | null; base: string | null; ownership: Ownership; value: number; acquired_at: number; busy: number }>(db,
    `SELECT a.*, EXISTS (SELECT 1 FROM flights f WHERE f.aircraft_id = a.id AND f.status = 'active') AS busy FROM aircraft a WHERE a.company_id = ? AND a.returned_at IS NULL ORDER BY a.id`, companyId)
    .map((a) => ({ id: a.id, registration: a.registration ?? `#${a.id}`, base: a.base, ownership: a.ownership, value: a.value, category: typeFor(db, companyId, a.icao).category, acquired_at: a.acquired_at, busy: !!a.busy }));
  const staff = all<PlanStaff>(db, "SELECT salary, MAX(starts_at, hired_at) AS since, ends_at FROM staff WHERE company_id = ? AND contract = 'cdi'", companyId);
  return { contracts, fleet, staff, facilities: planRows(db, companyId, at), credit: { credits: activeCredits(db, companyId), overdraftLow: low } };
}

// ---------------------------------------------------------------- monthly billing (lazy, idempotent per company and UTC month)

/** Bill every UTC month since the last run (at most 12) up to the one containing `now`. Running it again in the same month changes nothing.
 *  Postings are dated the 1st of the month they belong to. Returns the number of months billed. */
export function runBilling(db: Db, companyId: number, now: number): number {
  const cur = monthKey(now);
  const last = get<{ m: string | null }>(db, 'SELECT MAX(month) AS m FROM billing_runs WHERE company_id = ?', companyId)?.m ?? null;
  if (last === null) { // a company the server never billed: start tracking now, no retroactive charges
    run(db, 'INSERT INTO billing_runs (company_id, month, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', companyId, cur, now);
    return 0;
  }
  const months: string[] = [];
  for (let m = nextMonthKey(last); m <= cur && months.length < 60; m = nextMonthKey(m)) months.push(m);
  let billed = 0;
  for (const m of months.slice(-MAX_CATCHUP_MONTHS)) {
    if (run(db, 'INSERT INTO billing_runs (company_id, month, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', companyId, m, now).changes === 0) continue;
    const at = monthStart(m);
    const { contracts, fleet, staff, facilities, credit } = planInputs(db, companyId, at, overdraftLow(db, companyId, addMonths(at, -1), at));
    const plan = planMonth(at, contracts, fleet, staff, facilities, insuranceRise(db, companyId, m), credit);
    for (const c of plan.charges) {
      post(db, companyId, at, c.kind, c.amount, c.memo, null, c.aircraftId === undefined ? {} : { aircraftId: c.aircraftId });
      if (c.kind === CREDIT_INSTALMENT) settleLate(db, companyId, at, -c.amount, c.memo);
    }
    savePlanRows(db, facilities, plan.facilities);
    saveCredits(db, credit.credits, plan.credits);
    for (const c of plan.contracts) {
      const before = contracts.find((x) => x.id === c.id)!;
      if (c.months_paid !== before.months_paid || c.principal !== before.principal) run(db, 'UPDATE contracts SET months_paid = ?, principal = ? WHERE id = ?', c.months_paid, c.principal, c.id);
    }
    for (const id of plan.ended) run(db, "UPDATE contracts SET status = 'ended', ended_at = ? WHERE id = ?", at, id);
    for (const id of plan.returned) run(db, 'UPDATE aircraft SET returned_at = ? WHERE id = ?', at, id);
    for (const id of plan.owned) run(db, "UPDATE aircraft SET ownership = 'owned' WHERE id = ?", id);
    applyBailout(db, companyId, at);
    snapshot(db, companyId, at);
    billed++;
  }
  return billed;
}

const memo = new WeakMap<Db, string>();
/** Request hook body: free the workshop and bill the player companies that are behind. A per-process memo makes the common case one string compare. */
export function maintenanceTick(db: Db, now: number): void {
  if (get(db, "SELECT 1 AS x FROM aircraft WHERE status = 'maintenance' AND maintenance_until <= ? LIMIT 1", now)) releaseMaintenance(db, now);
  const cur = monthKey(now);
  if (memo.get(db) === cur) return;
  const behind = all<{ id: number }>(db, 'SELECT c.id FROM companies c WHERE c.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM billing_runs b WHERE b.company_id = c.id AND b.month = ?) ORDER BY c.id', cur);
  for (const c of behind) runBilling(db, c.id, now);
  memo.set(db, cur);
}

// ---------------------------------------------------------------- quote & offers

export function quote(db: Db, companyId: number, icao: string, hub: string): FleetQuote {
  if (!hasHub(db, companyId, hub)) throw new HttpError(422, 'not_a_hub', `${hub} is not one of your hubs`);
  const price = aircraftPrice(typeFor(db, companyId, icao));
  const ferry = ferryFee(price);
  const loans = LOAN_QUOTE_DOWN_PCTS.flatMap((d) => LOAN_QUOTE_MONTHS.map((m) => loanOption(price, ferry, d, m)));
  return { cash: price + ferry, loans, leaseOffers: 1, price, ferryFee: ferry, balance: balanceOf(db, companyId) };
}

const STARTER_OFFERS = { airliner: ['A20N', 'B738', 'E295'], hardcore: ['C172', 'C152', 'DA40'] } as const;

export function offersFor(db: Db, companyId: number, now: number, icao?: string): LeaseOffer[] {
  const types = icao ? [icao] : STARTER_OFFERS[startModeOf(db, companyId) ?? 'airliner'];
  return types.map((t) => leaseOffer(typeFor(db, companyId, t), dayOf(now)));
}

// ---------------------------------------------------------------- leases

function aircraftResult(db: Db, companyId: number, aircraftId: number, firstPayment: number, now: number): PurchaseResult {
  return { aircraft: fleetView(db, companyId, now).find((a) => a.id === aircraftId)!, firstPayment, balanceAfter: balanceOf(db, companyId) };
}

export function signLease(db: Db, companyId: number, o: { offerId: string; months: number; hub: string }, now: number): PurchaseResult {
  const ref = parseOfferId(o.offerId);
  if (!ref || dayOf(now) - ref.day > 1 || ref.day > dayOf(now)) throw new HttpError(404, 'offer_not_found', 'lease offer not found or expired');
  const offer = leaseOffer(typeFor(db, companyId, ref.icao), ref.day);
  const term = offer.durations.find((d) => d.months === o.months);
  if (!term) throw new HttpError(422, 'invalid_term', `this offer runs ${offer.durations.map((d) => d.months).join(', ')} months`);
  if (!hasHub(db, companyId, o.hub)) throw new HttpError(422, 'not_a_hub', `${o.hub} is not one of your hubs`);
  assertHubSpot(db, companyId, o.hub, now);
  const type = typeFor(db, companyId, offer.icao);
  const first = term.monthlyRent + offer.deposit + offer.ferryFee;
  const missing = first - spendable(db, companyId);
  if (missing > 0) throw short(first, { missing, balance: balanceOf(db, companyId) });
  const aircraftId = insertAircraft(db, { companyId, icao: offer.icao, hub: o.hub, value: aircraftValue(type), ownership: 'leased', at: now });
  const registration = get<{ registration: string }>(db, 'SELECT registration FROM aircraft WHERE id = ?', aircraftId)!.registration;
  const terms: LeaseTerms = { maintenanceIncluded: offer.maintenanceIncluded, purchaseOptionPrice: offer.purchaseOptionPrice, value: aircraftValue(type), earlyExit: offer.earlyExit, minMonths: offer.minMonths };
  run(db, `INSERT INTO contracts (company_id, aircraft_id, kind, started_at, ends_at, months, months_paid, monthly, deposit, insurance, terms)
    VALUES (?, ?, 'lease', ?, ?, ?, 1, ?, ?, ?, ?)`, companyId, aircraftId, now, addMonths(now, term.months), term.months, term.monthlyRent, offer.deposit, offer.insuranceMonthly ?? 0, JSON.stringify({ ...terms, lessor: offer.lessor, year: offer.year, airframeHours: offer.airframeHours }));
  const on = { aircraftId };
  post(db, companyId, now, 'lease_rent', -term.monthlyRent, `${registration} first rent (${offer.lessor})`, null, on);
  post(db, companyId, now, 'deposit', -offer.deposit, `${registration} security deposit`, null, on);
  post(db, companyId, now, 'ferry', -offer.ferryFee, `convoy and registration ${registration}`, null, on);
  snapshot(db, companyId, now);
  return aircraftResult(db, companyId, aircraftId, first, now);
}

function activeContract(db: Db, companyId: number, id: number): ContractRow {
  const c = get<ContractRow>(db, "SELECT * FROM contracts WHERE id = ? AND company_id = ? AND status = 'active' AND kind != 'loan'", id, companyId);
  if (!c) throw new HttpError(404, 'contract_not_found', 'no such active contract');
  if (get(db, "SELECT 1 AS x FROM flights WHERE aircraft_id = ? AND status = 'active'", c.aircraft_id)) throw new HttpError(409, 'aircraft_busy', 'this aircraft is on a flight');
  return c;
}
const termsOf = (c: ContractRow): LeaseTerms & { lessor?: string } => JSON.parse(c.terms ?? '{}');

function endContract(db: Db, c: ContractRow, now: number, ownership?: Ownership): void {
  run(db, "UPDATE contracts SET status = 'ended', ended_at = ? WHERE id = ?", now, c.id);
  if (ownership) run(db, 'UPDATE aircraft SET ownership = ? WHERE id = ?', ownership, c.aircraft_id);
  else run(db, 'UPDATE aircraft SET returned_at = ? WHERE id = ?', now, c.aircraft_id);
}

/** Early exit: allowed after `earlyExit.afterMonths` paid months, costs `penaltyRents` rents, returns the aircraft and the deposit.
 *  A monthly rental can be stopped after its minimum term, a club membership at any time. */
export function terminateContract(db: Db, companyId: number, id: number, now: number): { ended: true; penalty: number; depositRefunded: number; balanceAfter: number } {
  const c = activeContract(db, companyId, id);
  const reg = get<{ registration: string }>(db, 'SELECT registration FROM aircraft WHERE id = ?', c.aircraft_id)!.registration;
  let penalty = 0;
  if (c.kind === 'lease') {
    const exit = termsOf(c).earlyExit ?? { afterMonths: c.months ?? 0, penaltyRents: 2 };
    if (c.months_paid < exit.afterMonths) throw new HttpError(409, 'too_early', `early exit starts after ${exit.afterMonths} months`, { afterMonths: exit.afterMonths, monthsPaid: c.months_paid });
    penalty = exit.penaltyRents * c.monthly;
  } else if (c.kind === 'rental' && c.months_paid < (c.months ?? 0)) {
    throw new HttpError(409, 'too_early', `the rental runs at least ${c.months} months`, { afterMonths: c.months, monthsPaid: c.months_paid });
  }
  const net = c.deposit - penalty;
  if (spendable(db, companyId) + net < 0) throw short(-net - spendable(db, companyId), { penalty });
  if (penalty > 0) post(db, companyId, now, 'lease_rent', -penalty, `${reg} early exit penalty`, null, { aircraftId: c.aircraft_id });
  if (c.deposit > 0) post(db, companyId, now, 'deposit_refund', c.deposit, `${reg} deposit returned`, null, { aircraftId: c.aircraft_id });
  endContract(db, c, now);
  snapshot(db, companyId, now);
  return { ended: true, penalty, depositRefunded: c.deposit, balanceAfter: balanceOf(db, companyId) };
}

/** Purchase option: pay the option price (the deposit comes back), the aircraft becomes owned and the lease ends. Same earliest date as early exit. */
export function buyoutLease(db: Db, companyId: number, id: number, now: number): PurchaseResult {
  const c = activeContract(db, companyId, id);
  if (c.kind !== 'lease') throw new HttpError(422, 'not_a_lease', 'only a lease has a purchase option');
  const t = termsOf(c);
  if (c.months_paid < (t.earlyExit?.afterMonths ?? 0)) throw new HttpError(409, 'too_early', `the purchase option opens after ${t.earlyExit.afterMonths} months`, { afterMonths: t.earlyExit.afterMonths, monthsPaid: c.months_paid });
  const needed = t.purchaseOptionPrice - c.deposit;
  const missing = needed - spendable(db, companyId);
  if (missing > 0) throw short(needed, { missing, price: t.purchaseOptionPrice, deposit: c.deposit });
  const reg = get<{ registration: string }>(db, 'SELECT registration FROM aircraft WHERE id = ?', c.aircraft_id)!.registration;
  post(db, companyId, now, 'purchase_aircraft', -t.purchaseOptionPrice, `${reg} purchase option`, null, { aircraftId: c.aircraft_id });
  if (c.deposit > 0) post(db, companyId, now, 'deposit_refund', c.deposit, `${reg} deposit applied`, null, { aircraftId: c.aircraft_id });
  endContract(db, c, now, 'owned');
  snapshot(db, companyId, now);
  return aircraftResult(db, companyId, c.aircraft_id, t.purchaseOptionPrice, now);
}

// ---------------------------------------------------------------- club and monthly rental (hardcore start)

function rentAircraft(db: Db, companyId: number, kind: 'club' | 'rental', hub: string, icao: string, now: number): PurchaseResult {
  const plan = kind === 'club' ? CLUB[icao] : MONTHLY_RENTAL[icao];
  if (!plan) throw new HttpError(422, 'not_offered', `${icao} is not offered ${kind === 'club' ? 'by the club' : 'for monthly rental'}`);
  if (!hasHub(db, companyId, hub)) throw new HttpError(422, 'not_a_hub', `${hub} is not one of your hubs`);
  const open = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM contracts WHERE company_id = ? AND kind = ? AND status = 'active'", companyId, kind)!.n;
  if (open >= MAX_CLUB_AIRCRAFT) throw new HttpError(409, 'already_rented', `you already have ${kind === 'club' ? 'a club aircraft' : 'a monthly rental'}`);
  const rental = kind === 'rental' ? MONTHLY_RENTAL[icao]! : null;
  const first = rental ? rental.deposit + rental.monthly : 0;
  const missing = first - spendable(db, companyId);
  if (missing > 0) throw short(first, { missing, balance: balanceOf(db, companyId) });
  const type = typeFor(db, companyId, icao);
  const aircraftId = insertAircraft(db, { companyId, icao, hub, value: aircraftValue(type), ownership: kind === 'club' ? 'club' : 'rented', at: now });
  const registration = get<{ registration: string }>(db, 'SELECT registration FROM aircraft WHERE id = ?', aircraftId)!.registration;
  run(db, `INSERT INTO contracts (company_id, aircraft_id, kind, started_at, ends_at, months, months_paid, monthly, hourly, deposit)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`, companyId, aircraftId, kind, now, rental?.minMonths ?? null, rental ? 1 : 0, rental?.monthly ?? 0, kind === 'club' ? CLUB[icao]!.hourly : rental!.hourly, rental?.deposit ?? 0);
  if (rental) {
    post(db, companyId, now, 'deposit', -rental.deposit, `${registration} rental deposit`, null, { aircraftId });
    post(db, companyId, now, 'lease_rent', -rental.monthly, `${registration} first month`, null, { aircraftId });
  }
  snapshot(db, companyId, now);
  return aircraftResult(db, companyId, aircraftId, first, now);
}
export const rentFromClub = (db: Db, companyId: number, hub: string, icao: string, now: number): PurchaseResult => rentAircraft(db, companyId, 'club', hub, icao, now);
export const rentMonthly = (db: Db, companyId: number, hub: string, icao: string, now: number): PurchaseResult => rentAircraft(db, companyId, 'rental', hub, icao, now);

// ---------------------------------------------------------------- overview

const UPCOMING_MONTHS = 3;

/** What the next `months` billing runs will post, by the rules billing itself uses (`planMonth` on the contracts as they will be). Each charge is dated the 1st of its month. `inputs` lets the forecast ask "what if" (an extra contract, another fleet). */
export function projectCharges(db: Db, companyId: number, now: number, months: number, inputs: PlanInputs = planInputs(db, companyId, now)): FinanceCharge[] {
  const { contracts, fleet, staff, facilities } = inputs;
  const upcoming: FinanceCharge[] = [];
  let state = contracts, buildings = facilities, lent = inputs.credit;
  for (let i = 1; i <= months; i++) {
    const at = addMonths(now, i);
    const plan = planMonth(at, state, fleet, staff, buildings, insuranceRise(db, companyId, monthKey(at)), lent);
    for (const c of plan.charges) upcoming.push({ at, kind: c.kind, amount: c.amount, memo: c.memo });
    state = plan.contracts.filter((c) => !plan.ended.includes(c.id));
    buildings = plan.facilities;
    lent = { credits: plan.credits, overdraftLow: 0 }; // only the first month has a balance to read; the later ones are projected without an overdraft
  }
  return upcoming;
}

export function overview(db: Db, companyId: number, now: number): FinanceOverview {
  const { contracts, fleet } = planInputs(db, companyId, now);
  const upcoming = projectCharges(db, companyId, now, UPCOMING_MONTHS);
  const regs = new Map(fleet.map((a) => [a.id, a]));
  const icaos = new Map(all<{ id: number; icao: string }>(db, 'SELECT id, icao FROM aircraft WHERE company_id = ?', companyId).map((a) => [a.id, a.icao]));
  return {
    upcoming,
    contracts: contracts.map((c): FinanceContract => {
      const row = get<ContractRow>(db, 'SELECT * FROM contracts WHERE id = ?', c.id)!;
      return {
        id: c.id, kind: c.kind, aircraftId: c.aircraft_id, registration: regs.get(c.aircraft_id)?.registration ?? '', icao: icaos.get(c.aircraft_id) ?? '',
        startedAt: row.started_at, endsAt: row.ends_at, monthly: c.monthly, hourly: row.hourly, deposit: c.deposit, months: c.months, monthsPaid: c.months_paid,
        balance: c.kind === 'loan' ? c.principal : null,
      };
    }),
  };
}
