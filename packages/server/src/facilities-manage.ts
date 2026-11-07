// Lot FACILITIES (v3), server side, part 2: what the player does with buildings (lease, buy, upgrade, end the contract). Domain operations: callers wrap them in `tx` and
// settle the company's month first (routes-facilities.ts). Money goes through game.ts `post`; a payment the balance cannot cover is 409 insufficient_funds, as in finance.ts.
import {
  DAY_MS, FACILITY_MAX_LEVEL, LEASE_MONTHS, LEASE_NOTICE_MONTHS, LEVEL_WORKS_DAYS, MAX_LEVEL_AT_SIGNING, facilityLevelCost, leaseExitFee, nextLevelAt, resaleValue, signing,
  type FacilityContractKind, type FacilitySignResult, type FacilityTerminateResult, type FacilityUpgradeResult, type Financing,
} from '@opc/shared';
import { run, type Db } from './db.ts';
import { assertHub, facilityById, forRent, heldFacility, holderOf, hubCapacity, labelOf, levelAt, levelSinceAt, seedOf, worksAt, type Held } from './facilities.ts';
import { facilityContractView } from './facilities-views.ts';
import { hubUsed } from './fleet-extras.ts';
import { balanceOf, post, snapshot, spendable } from './game.ts';
import { HttpError } from './http.ts';

const short = (needed: number, available: number, balance: number): HttpError => new HttpError(409, 'insufficient_funds', `needs ${needed - available} more`, { needed, balance, missing: needed - available });

/** Pay (a negative amount is money coming in) if the balance can take the net of all `lines` at once; one check so a signing never half-books. */
function book(db: Db, companyId: number, at: number, lines: readonly { kind: string; amount: number; memo: string }[]): void {
  const net = lines.reduce((t, l) => t + l.amount, 0);
  const available = spendable(db, companyId);
  if (available + net < 0) throw short(-net, available, balanceOf(db, companyId));
  for (const l of lines) if (l.amount !== 0) post(db, companyId, at, l.kind, l.amount, l.memo);
  snapshot(db, companyId, at);
}

function sign(db: Db, companyId: number, facilityId: number, kind: FacilityContractKind, level: number, financing: Financing | undefined, now: number): FacilitySignResult {
  const f = facilityById(db, facilityId);
  assertHub(db, companyId, f.hub_icao);
  const seed = seedOf(f.hub_icao, f.slot)!;
  if (seed.owner === 'airport') throw new HttpError(409, 'not_offered', `${seed.name} is not for rent or sale`);
  if (!forRent(seed, !!holderOf(db, facilityId))) throw new HttpError(409, 'occupied', `${seed.name} is already taken`);
  if (level > FACILITY_MAX_LEVEL[seed.effect] || level > MAX_LEVEL_AT_SIGNING) throw new HttpError(422, 'invalid_level', `${seed.name} can start at level ${Math.min(FACILITY_MAX_LEVEL[seed.effect], MAX_LEVEL_AT_SIGNING)} at most`);
  const s = signing(seed.rent, kind, level, financing);
  const label = labelOf(f);
  const lines = kind === 'lease'
    ? [{ kind: 'facility_deposit', amount: -s.deposit, memo: `${label} security deposit` }]
    : [{ kind: 'facility_purchase', amount: -s.down, memo: `${label} ${s.principal > 0 ? 'down payment' : 'purchase'}` }];
  if (s.works > 0) lines.push({ kind: 'facility_works', amount: -s.works, memo: `${label} works to level ${level}` });
  book(db, companyId, now, lines);
  const works = level > 1 ? { to: level, until: now + LEVEL_WORKS_DAYS[level]! * DAY_MS } : null;
  const id = run(db, `INSERT INTO facility_contracts (facility_id, company_id, kind, started_at, months, monthly, upkeep, deposit, price, principal, value, notice_months, level, level_since, works_to, works_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  facilityId, companyId, kind, now, s.months, kind === 'lease' ? s.monthly : s.instalment, s.upkeep, s.deposit, s.price, s.principal, kind === 'purchase' ? resaleValue(s.price) : 0,
  kind === 'lease' ? LEASE_NOTICE_MONTHS : 0, now, works?.to ?? null, works?.until ?? null).id;
  const held = heldFacility(db, companyId, facilityId)!;
  return { contract: facilityContractView(held, now), due: s.today, balanceAfter: balanceOf(db, companyId) };
}

export const leaseFacility = (db: Db, companyId: number, facilityId: number, level: number, now: number): FacilitySignResult => sign(db, companyId, facilityId, 'lease', level, undefined, now);
export const buyFacility = (db: Db, companyId: number, facilityId: number, level: number, financing: Financing | undefined, now: number): FacilitySignResult =>
  sign(db, companyId, facilityId, 'purchase', level, financing, now);

const owned = (db: Db, companyId: number, facilityId: number): Held => {
  facilityById(db, facilityId);
  const h = heldFacility(db, companyId, facilityId);
  if (!h) throw new HttpError(404, 'not_held', 'you do not hold this building');
  return h;
};

/** Start the works to the next level. The rent does not change with the level. During the works the building keeps working at the level below. */
export function upgradeFacility(db: Db, companyId: number, facilityId: number, toLevel: number, now: number): FacilityUpgradeResult {
  const h = owned(db, companyId, facilityId);
  const seed = seedOf(h.hub_icao, h.slot)!;
  if (toLevel > FACILITY_MAX_LEVEL[seed.effect]) throw new HttpError(422, 'invalid_level', `${seed.name} has no level ${toLevel}`);
  const level = levelAt(h, now), since = levelSinceAt(h, now);
  const works = worksAt(h, now);
  if (works) throw new HttpError(409, 'works_in_progress', `works to level ${works.toLevel} end ${new Date(works.until).toISOString()}`, { until: works.until });
  if (toLevel !== level + 1) throw new HttpError(422, 'invalid_level', `the next level is ${level + 1}`);
  const opensAt = nextLevelAt(level, since);
  if (opensAt > now) throw new HttpError(409, 'too_early', `level ${toLevel} opens ${new Date(opensAt).toISOString()}`, { availableAt: opensAt });
  const cost = facilityLevelCost(seed.rent, toLevel), until = now + LEVEL_WORKS_DAYS[toLevel]! * DAY_MS;
  book(db, companyId, now, [{ kind: 'facility_works', amount: -cost, memo: `${labelOf(h)} works to level ${toLevel}` }]);
  run(db, 'UPDATE facility_contracts SET level = ?, level_since = ?, works_to = ?, works_until = ? WHERE id = ?', level, since, toLevel, until, h.id);
  return { toLevel, cost, until, balanceAfter: balanceOf(db, companyId) };
}

/** End the contract. A lease pays the notice (or the rest of the term when that is longer) and gets the deposit back; a purchase is sold: the credit left is settled and the resale value comes in.
 *  The building is on offer again; its works in progress are lost. */
export function terminateFacility(db: Db, companyId: number, facilityId: number, now: number): FacilityTerminateResult {
  const h = owned(db, companyId, facilityId);
  // the aircraft a hangar houses must still have a spot once it is gone
  const spots = hubCapacity(db, companyId, h.hub_icao, now, h.id), used = hubUsed(db, companyId, h.hub_icao);
  if (used > spots) throw new HttpError(409, 'hub_in_use', `${h.hub_icao} would have ${spots} parking spots for ${used} aircraft: move some away first`, { spots, used });
  const label = labelOf(h);
  const lease = h.kind === 'lease';
  const fee = lease ? leaseExitFee(h.monthly, h.months ?? 0, h.months_paid, h.notice_months) : h.principal;
  const refund = lease ? h.deposit : h.value;
  book(db, companyId, now, lease
    ? [{ kind: 'facility_rent', amount: -fee, memo: `${label} exit` }, { kind: 'facility_deposit_refund', amount: refund, memo: `${label} deposit returned` }]
    : [{ kind: 'facility_loan', amount: -fee, memo: `${label} credit settled` }, { kind: 'facility_sale', amount: refund, memo: `${label} sold` }]);
  run(db, "UPDATE facility_contracts SET status = 'ended', ended_at = ? WHERE id = ?", now, h.id);
  return { ended: true, kind: h.kind, fee, refund, balanceAfter: balanceOf(db, companyId) };
}
