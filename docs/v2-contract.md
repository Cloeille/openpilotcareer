# OpenHangar v2: API contract shared by the parallel lots

Source: mockup v2 (`docs/design/`, rendered screens in `docs/design/renders/`, resolved trees in `docs/design/screens-resolved/`, plain texts in `docs/design/texts/`).
All routes are under `/api/v1`. Session auth and the `X-OPC-Company` header work as they do today, except where a route says "API key".
Money is an integer in euros. Times are epoch milliseconds. ICAO codes are uppercase.
Each lot owns the routes and types in its own section. A lot never edits another lot's section. If a lot finds a gap, it adds an "Open question" line under its own section and picks a default.

## Lot START: onboarding, start modes, company identity, realism (owner: be-start)

Shared constants (in `packages/shared/src/career.ts`, re-exported from `index.ts`):
- `START_MODES`:
  - `airliner`: capital 2 500 000, hub size `large`, suggested realism `balanced`, starter types `A20N`, `B738`, `E295`.
  - `hardcore`: capital 45 000, hub size `small`, suggested realism `hardcore`, starter types `C172`, `C152`.
- `REALISM_TOGGLES`: `wearAndFailures`, `realFuelPrice`, `delayPenalties`, `realWeatherRequired`, `bankruptcyBailout`, `pauseTolerance`. Each toggle has the pay % and reputation % shown in frame "Onboarding · 4 réalisme & difficulté".
- `REALISM_PRESETS`:
  - `relaxed`: pay −5 %, rep −10 %.
  - `balanced`: pay +10 %, rep +10 %. 4 of the 6 toggles are on; the Switch states in the resolved tree say which.
  - `hardcore`: pay +30 %, rep +30 %, all toggles that make the game harder are on.
  - `custom`: modifiers are the sum of the active toggles.

Types:
- `Realism = { preset: 'relaxed'|'balanced'|'hardcore'|'custom'; toggles: Record<RealismToggle, boolean>; payModifierPct: number; repModifierPct: number; enforced: Record<RealismToggle, boolean> }`. `enforced[t]` is false for a toggle the server stores but cannot apply yet. That is the case for `delayPenalties` (jobs have no schedule) and `realWeatherRequired` (no weather data). The UI must say "pas encore appliqué" for those.
- `Onboarding = { completed: boolean; step: 1|2|3|4|5|6; startMode: 'airliner'|'hardcore'|null; companyId: number|null; draft: Record<string, unknown> }`. `draft` is client-owned JSON of at most 8 KB, for "Enregistrer et quitter".
- `Company` gains these fields: `code: string|null` (3 letters, unique per server, immutable once set), `callsign: string|null` (3 to 12 letters A-Z, immutable), `liveryColor: string|null` (`#RRGGBB`), `startMode: 'airliner'|'hardcore'|null`, `realism: Realism`.
- `Me` type is UNCHANGED (company stays non-null). A user without any company gets `409 no_company` from `GET /me` and from every company-scoped route (never a crash). The web client calls `GET /onboarding` right after login/register and routes to the onboarding while `completed` is false.

Routes:
- `POST /auth/register` accepts `onboarding?: boolean`. When it is true, no company is created. The web app always sends true. Without it, today's behaviour stays, so existing tests and the smoke test keep passing.
- Every company-scoped route, called by a user with no company, returns `409 no_company`. It must never crash.
- `GET /onboarding` returns `Onboarding`.
- `PUT /onboarding` with `{ step?, startMode?, draft? }` returns `Onboarding`.
- `POST /onboarding/complete` returns `Onboarding`. It requires that the onboarding company exists and has at least one aircraft.
- `GET /onboarding/hubs?mode=airliner|hardcore&q=` returns at most 6 `{ icao, name, city, size, parkingMonthly, jobsNearby, aiCompaniesBased, note }`. Without `q`, these are curated suggestions for the mode (airports of the mode's size).
- `GET /airlines/code/:code` returns `{ available: boolean }`.
- `POST /me/companies` accepts these extra fields: `code`, `callsign`, `liveryColor?`, `startMode?`. When `startMode` is set:
  - the balance is the mode's capital;
  - there is NO starter aircraft;
  - the first hub is free;
  - the onboarding's `companyId` is set.
  Without `startMode`, the legacy behaviour stays.
- `PUT /companies/:id/realism` with `{ preset }` or `{ toggles }` returns `Realism`. Changing one toggle switches the preset to `custom`.
- `GET /companies/:id/first-job` returns `{ job: Job, reservedUntil: number }`. It picks a board job from the company hub that the fleet can fly and reserves it for 2 h. Other players and the AI cannot take a reserved job. Calling it again returns the same job while the reservation lasts.

Effects the server enforces:
- Pay and reputation modifiers apply to every paid flight.
- `pauseTolerance` makes the server ignore the bridge's `long_pause` flag.
- `realFuelPrice` replaces the flat fuel price with a deterministic price per airport and per UTC day, within ±25 %.
- `bankruptcyBailout` clears a negative balance once per season, when the monthly billing (lot FINANCE) runs. Expose a function for that.
- `wearAndFailures` is read by lot FINANCE. Expose `wearEnabled(db, companyId): boolean`.

Implementation notes (be-start, as built):
- Open question (default taken): `GET /me`-style responses for a user with no company. `POST /auth/register` with `onboarding: true` and `POST /auth/login` of such a user return `{ token, username, onboarding: Onboarding }` instead of a `Me`. The web calls `GET /onboarding` anyway.
- Open question (default taken): `Company.realism` is neutral (`preset: 'custom'`, all toggles off, modifiers 0) for companies that predate v2 and for AI companies. Founding with `startMode` stores the mode's suggested preset. `wearEnabled` is false for them, so lot FINANCE must treat a neutral company as "no wear" (the contract's "default true" applies only while this lot is not merged).
- `POST /me/companies` now lives in `routes-start.ts` (the legacy handler in `app.ts` was removed). With `startMode`, `code` and `callsign` are required (400 otherwise); a duplicate code is `409 code_taken`; an unfinished onboarding company of the same player is replaced (it is deleted, never if it has flown: `409 company_exists`). The onboarding moves to step 3.
- `PUT /onboarding` with a `startMode` on a completed onboarding re-opens it (new additional company). Changing the start mode drops the unfinished onboarding company.
- `PATCH /companies/:id` with `code` or `callsign` is `409 immutable`.
- `PUT /companies/:id/realism` body is strict: `{ preset: 'relaxed'|'balanced'|'hardcore' }` or `{ toggles: Partial<Record<RealismToggle, boolean>> }`. `GET /companies/:id/realism` also exists. Toggle modifiers are in `REALISM_TOGGLE_INFO` (`packages/shared/src/career.ts`). The preset headline numbers of the mockup (relaxed -5/-10, balanced +10/+10, hardcore +30/+30) are exactly the sums of the toggles each preset switches on (asserted in `career.test.ts`), so the server always applies `realismModifiers(toggles)`.
- `GET /onboarding/hubs` rows also carry `noteKey` (`most_jobs|least_competition|balanced|match`) so the client can translate `note`. `jobsNearby` counts departures within 300 nm on the 4 boards of the current UTC day.
- `GET /companies/:id/first-job`: `409 no_aircraft` when the fleet is empty, `409 no_flyable_job` when nothing at the hub fits. Accepting a job reserved for another company is `409 job_reserved`. The reservation survives the 6 h board refresh for its owner and is consumed on accept. `GET /jobs` hides other companies' reservations; the AI tick hides all of them.
- Server hooks for other lots (`packages/server/src/start.ts`): `wearEnabled(db, companyId)`, `applyBailout(db, companyId, at): number` (posts a `bailout` ledger line, once per UTC season, returns the amount cleared; call it inside the monthly billing transaction), `toleratedFlags`. Fuel: `fuelPriceFactor(icao, atMs)` in shared, applied at settlement with the origin airport and the acceptance time.
- `access-control-allow-methods` now includes `PUT`.
- Company-scoped routes answer `409 no_company` through `sessionAuth`; account-level routes (onboarding, API keys, company list, export JSON, logout, delete) use `sessionUser` and work without a company.

## Lot FINANCE: leasing, credit, club rental, registrations, wear, parking, monthly billing (owner: be-finance)

Shared constants and types (in `packages/shared/src/finance.ts`, re-exported):
- `LOAN_RATE = 0.069`, loan length 36 to 120 months, down payment 20 to 50 %.
- `PARKING_SPOTS_PER_HUB = 10`.
- `PARKING_FEE_BY_SIZE` (for example large 3 900, medium 1 800, small 450 per aircraft per month).
- `CLUB` hourly rental: `C172` at 210 €/h, fuel included, no fixed cost. `MONTHLY_RENTAL`: `C172` with a 5 000 € deposit refunded at the end, 1 900 €/month, 110 €/h for fuel, 6 months minimum. These are the 3 hardcore options of frame "Onboarding · 3b". The third one, a used C152 bought on credit, goes through the loan route.

- `FleetAircraft` gains these fields:
  - `registration` (for example `F-HAZA`: a country prefix from the hub's country, then letters, unique per server);
  - `ownership: 'owned'|'leased'|'financed'|'club'|'rented'`;
  - `wearPct` (0 to 100);
  - `status: 'available'|'flying'|'maintenance'`;
  - `maintenanceUntil: number|null`;
  - `contract: null | { kind: 'lease'|'loan'|'club'|'rental'; id: number; monthly: number; hourly: number|null; endsAt: number|null }`.
- `LeaseOffer = { id, lessor, icao, typeName, year, airframeHours, maintenanceIncluded, insuranceMonthly: number|null, deposit, ferryFee, deliveryHours, minMonths, durations: { months: 12|24|36; monthlyRent: number }[], purchaseOptionPrice, earlyExit: { afterMonths: number; penaltyRents: number } }`. Offers are deterministic, by type and day. Lessor names come from the mockup: AerCap, SMBC Aviation, Azorra, Viking Air Leasing.

Routes:
- `GET /leasing/offers?icao=&hub=` returns `LeaseOffer[]`. Without `icao`, it returns 3 offers for the company's start mode (airliner: `A20N`, `B738`, `E295`).
- `POST /me/leases { offerId, months, hub }` returns `{ aircraft: FleetAircraft, firstPayment: number, balanceAfter: number }`. It debits the first rent, the deposit and the ferry fee. When funds are short it returns `409 insufficient_funds { needed }`.
- `POST /me/leases/:id/terminate` is an early exit with the penalty. `POST /me/leases/:id/buyout` exercises the purchase option.
- `GET /me/fleet/quote?icao=&hub=` returns `{ cash: number, loans: { downPct, months, monthly, total }[], leaseOffers: number }`.
- `POST /me/fleet` accepts `financing?: { downPct, months }`, which creates a loan. A cash purchase with short funds returns `409 insufficient_funds { needed, options: ['loan','lease'] }`.
- `POST /me/club-rental { hub, icao }` and `POST /me/monthly-rental { hub, icao }` give the company a usable aircraft (`ownership` club or rented). Club hours are billed at settlement, per block hour.
- `GET /me/hubs` returns `{ icao, spots, used }[]`. Buying or leasing into a full hub returns `409 hub_full`.
- `GET /me/finance` returns `{ upcoming: { at, kind, amount, memo }[]; contracts: {...}[] }`.

Monthly billing is lazy and idempotent per (company, UTC month). It covers rents, loan instalments, parking for every aircraft based at a hub on the 1st, and insurance. It writes ledger kinds `lease_rent`, `loan_installment`, `parking`, `insurance`, `deposit`, `deposit_refund`, `ferry`, `club_hours`.

Wear accrues per block hour by category, and only when `wearEnabled` is true. That function comes from lot START; until the merge, default it to true. When wear crosses the threshold, the aircraft goes to `maintenance` for N hours. A lease with maintenance included pays no maintenance cost.

### Lot FINANCE: implementation notes (be-finance)
Defaults picked where the contract is silent (all in `packages/shared/src/finance.ts` and `packages/server/src/`):
- Registrations: country prefix from the hub airport's country (`F-` FR, `D-` DE, `G-` GB, `I-` IT, `EC-` ES, `HB-` CH, `N` US, `C-` CA, `VH-` AU, `JA` JP, see `REGISTRATION_PREFIX_BY_COUNTRY`), else the ICAO location prefix table (`REGISTRATION_PREFIX_BY_ICAO`, two letters before one), else `N`. Hyphenated prefixes run `F-HAZA`, `F-HAZB`... `F-HBAA`; US `N100AA`...; Japan `JA0001`. The Nth free one per prefix, unique per server (unique index). Migration 4 backfills existing aircraft in id order (done in `openDb`, it needs the airport data).
- Errors: `409 insufficient_funds { needed, missing, balance, options? }` (`options: ['loan','lease']` only on a cash purchase). The existing `purchase_aircraft` 402 is replaced by this 409 on `POST /me/fleet`; other flows (hub purchase) keep their 402.
- Cash purchase and lease also pay a convoy and registration fee (`ferry`, 0.3 % of the price, 250 to 12 500). AI companies pay the price only and are not limited by hub parking.
- `GET /me/fleet/quote` returns `{ cash (= price + ferry), loans[12] (downPct 20/30/50 x months 36/60/84/120: monthly, total, down, dueToday), leaseOffers, price, ferryFee, balance }`. Loan: annuity at 6.9 %, down payment + ferry due today, last instalment clears the principal.
- Leases: offer ids are `L-<ICAO>-<UTC day>`, valid today and yesterday. Delivery is at signing (`deliveryHours: 0`). First rent, deposit (2 rents of the 24-month price) and ferry fee are debited at signing; rents then run on the 1st of each month. `POST /me/leases/:id/terminate` and `/buyout` return `{ ended, penalty, depositRefunded, balanceAfter }` and a `PurchaseResult`; both are `409 too_early` before `earlyExit.afterMonths` paid months. The `:id` is the contract id (`aircraft.contract.id`). Net worth counts the deposit, not the leased aircraft; a financed aircraft counts at its value minus the loan principal.
- Club (`C172`, 210 euros per block hour, ledger `club_hours`) and monthly rental (`C172`, deposit 5 000, 1 900 per month, 110 euros per block hour) replace fuel and maintenance with the hourly rate. Both are limited to one open contract each. Rented and club aircraft use no parking spot and pay no parking or insurance. The monthly rental ends through `POST /me/leases/:id/terminate` after 6 paid months (no penalty, deposit back).
- Monthly billing runs on any API request (`onRequest` hook) and before the finance routes, for player companies only, once per (company, UTC month), at most 12 months of catch-up; postings are dated the 1st. Companies that already existed when migration 4 ran start being billed from that month. Things bought during a month are billed from the next one.
- Wear: per block hour by category (`WEAR_PCT_PER_HOUR`), player companies only, when `wearEnabled`. At 80 % the aircraft is in `maintenance` for 12 to 72 h by category, `409 in_maintenance` on accept, then back at 5 % wear. A lease with `maintenanceIncluded` pays no `maintenance` on its flights.
- Hooks for lot START in `packages/server/src/finance-hooks.ts`: `wearEnabled(db, companyId)`, `applyBailout(db, companyId, at)` (called once per billed month), `startModeOf(db, companyId)` (picks the three default lease offers: airliner `A20N/B738/E295`, hardcore `C172/C152/DA40`).
- `FleetAircraft.status` is `flying` while a flight is active. The `aircraft` row keeps `returned_at` for handed-back aircraft (flight history keeps its key); they are hidden from the fleet.
- Open question: the third hardcore option (used C152 on credit) goes through `POST /me/fleet` with `financing`; there is no used-aircraft market, so it is a new C152.

## Lot LIVE: live flight telemetry (owner: live)

- `LiveSample = { t, lat, lon, altFt, gsKts, vsFpm, headingDeg, fuelKg, phase, paused, simRate, flags: string[], engines: { torquePct?: number; n1Pct?: number; ittC?: number; oilPsi?: number }[] }`
- `POST /flights/:id/live` (API key) takes a `LiveSample` and returns 204. It is rate-limited to 1 per second per flight, and the body is validated with zod. Only the latest sample is kept in memory per flight, plus `last_live_at` on the flight.
- `GET /flights/:id/live` (session, ownership) returns `{ sample: LiveSample|null; receivedAt: number|null; bridgeLost: boolean; remainingNm: number|null; etaAt: number|null }`. `bridgeLost` is true when an active flight has received no sample for more than 30 s.
- The bridge `GET http://127.0.0.1:7878/status` gains `sim: 'connected'|'waiting'|'unavailable'` and `version: string`. The web onboarding step 5 reads it directly from the player's PC (CORS `*` is already sent).

## Merge plan (orchestrator only)
Merge order into `career-v2-base`: be-start, be-finance, be-live, fe-onboarding, fe-finance, fe-live, bridge, efb. Conflicts in `packages/web/src/messages.ts` and `routes.ts` are expected (each lot appends): resolve by keeping both sides.
To keep conflicts trivial every lot follows these rules:
- Server: put new routes in a NEW file `packages/server/src/routes-<lot>.ts` exporting `register<Lot>(app, ctx)`; touch `app.ts` with ONE line that calls it. New tables in a NEW migration constant appended to `MIGRATIONS` in `db.ts` (be-start = SCHEMA_V3, be-finance = SCHEMA_V4, be-live = SCHEMA_V5 — fixed numbering, even if another lot merges first). Shared types in a NEW file `packages/shared/src/<lot>.ts` re-exported by ONE line in `index.ts`.
- Web: new screens in NEW files under `packages/web/src/screens/`; add routes with ONE line each in `routes.ts`; add strings ONLY in a block `// ---- <lot>` appended at the end of the `table` in `messages.ts`.
- Frontend lots code against this contract with a typed client module `packages/web/src/api-<lot>.ts`; while the backend lot is not merged, test pure view-models with fixtures (no live server needed).
