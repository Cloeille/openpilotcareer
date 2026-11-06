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
- `Me` gains `onboarding: Onboarding`. `Me.company` becomes `Company | null`, and is null while the player has no company yet.

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

## Lot LIVE: live flight telemetry (owner: live)

- `LiveSample = { t, lat, lon, altFt, gsKts, vsFpm, headingDeg, fuelKg, phase, paused, simRate, flags: string[], engines: { torquePct?: number; n1Pct?: number; ittC?: number; oilPsi?: number }[] }`
- `POST /flights/:id/live` (API key) takes a `LiveSample` and returns 204. It is rate-limited to 1 per second per flight, and the body is validated with zod. Only the latest sample is kept in memory per flight, plus `last_live_at` on the flight.
- `GET /flights/:id/live` (session, ownership) returns `{ sample: LiveSample|null; receivedAt: number|null; bridgeLost: boolean; remainingNm: number|null; etaAt: number|null }`. `bridgeLost` is true when an active flight has received no sample for more than 30 s.
- The bridge `GET http://127.0.0.1:7878/status` gains `sim: 'connected'|'waiting'|'unavailable'` and `version: string`. The web onboarding step 5 reads it directly from the player's PC (CORS `*` is already sent).
