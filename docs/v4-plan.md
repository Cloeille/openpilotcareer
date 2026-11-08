# OpenHangar v4: gap analysis and lot plan

Source: mockup v4 (`docs/design/`, snapshot of 7 Nov 2026, etag 852a1c44). Base: `career-v2-base` at cae2daa (v2 plus v3 waves 1 and 2). Format follows `docs/v3-plan.md`. **No product code in this PR.**

Method. I diffed the v3 and v4 pen files by node id (tree compared with positions ignored), then read each new frame's `texts/*.txt` and `screens-resolved/*.md` against the server code (`finance.ts`, `staff*.ts`, `lines*.ts`, `game.ts`, `auth.ts`, `db.ts`) and the bridge (`sim/bridge`). Every number the frames show that I could reproduce is marked **ok** (the formula is in B.8). Numbers no model produces are marked **[NO MODEL]**. The figures come from the texts and trees only; renders were used just to check the capture.

## Part A. Gap analysis

### A.0 The diff, verified

- **119 frames, 100 in v3, none removed.** 19 added: 2 section dividers (10 Finance & trésorerie, 11 Groupe, filiales & alliances) and **17 full screens** (7 Finance, 5 Groupe/Alliance, 4 Staff, 1 Réglages).
- **4 modified, all in text only:** Section 01 and Section 07 (descriptions mention the new screens), Section 12 Références pour les devs (renumbered from 10; the text is otherwise identical), Lisez-moi (rows 01 to 11, references in row 12). **3 only moved** (+2200 px: Schéma générique, Cabines, Carte des parcours); their trees are unchanged.
- **The keyboard map (Carte des parcours) was not updated.** Lisez-moi and the references row add no rule, key or route. The routes and keys in B.10 come from each new frame's HUD Bottom and are my inference. The Lisez-moi still says "three scripts to port"; the pen has **five** (`network-map.js` and `airport-chart.js` since v3, `alliance-map.js` new in v4).
- **Finance, Groupe, Alliance and the four Staff frames keep the Compagnie tab active** (HUD Top is unchanged). They are entered from `#hubs` as new doors (C8 pattern). The Finance backdrop is `generated-11` (all 7 Finance frames); `SCENES` has no entry for it yet.
- **One frame is empty.** *Finance · échéance impayée & découvert* has backdrop and HUD but its `Content` frame has **no children**. There is nothing to implement from it; the rules it should show are product questions (C19, C20).
- *Alliance · membres & réseau* embeds `alliance-map.js` (a Pen script node, not drawn in the viewer capture): combined member network on one tilted plate, own lines bright, allies grey, codeshares as a double arc, guaranteed connections as rings. Same port pattern as `network-map.ts`.

### A.1 What the server already has

| Need | Already there |
|---|---|
| Money in and out | `post()` in `ledger.ts`; `transactions(id, company_id, at, kind, amount, balance_after, flight_id, memo)`; `GET /me/transactions` (limit, before); CSV export `GET /me/export?format=transactions.csv` |
| Monthly costs, projected | `planMonth` (pure) plus `runBilling` (lazy, idempotent per company and month); `GET /me/finance` projects 3 months: rents, loan instalments, parking, insurance, payroll, facilities |
| Loans | `contracts` kind `loan` on an aircraft: `monthly`, `principal`, `months`, `months_paid`, JSON `terms`; `loanPayment`, `loanStep`, **fixed `LOAN_RATE = 6.9 %`**, no early repayment route |
| Negative balance | `post` never refuses; `pay` (staff) and `spend` refuse when short; `applyBailout` clears a negative balance once per season when the `bankruptcyBailout` toggle is on. No overdraft limit, no interest, no unpaid state |
| Lines and their money | `scheduled_flights` keeps revenue, fuel, fees, maintenance per leg; `GET /lines/:id` has `pnl`; `GET /lines/:id/problem` has `cost.perDay`; `POST /lines/:id/resolve {option:'recruit'}` hires the cheapest candidates |
| Staff | one row per person (`staff.role` is free text; `staff.family` has a CHECK), `staff_quals`, `staff_leave` (kind leave/rest/training), market `candidates` (deterministic per day), `hire`, `train`, `interim`, `fire`. **`morale` is written at hire and never changes.** No age, no medical model |
| Several companies | up to `MAX_COMPANIES_PER_USER = 5` per user; `X-OPC-Company` header; `ownedCompany(db, userId, companyId)` is the one ownership check; `createCompany` always posts a starting-capital `grant` |
| Leaderboard | `leaderboard()` ranks **every company** by net worth (`NET_WORTH_SQL`), AI included |
| Presence | `line_networks.seen_at`, refreshed by any web or bridge request (at most once a minute); active flight is known |
| Bridge | reads the **loaded** aircraft only (`ATC MODEL`, `TITLE`); `designatorOf(atcModel) ?? --aircraft`; the server checks `t.aircraftIcao === flight.aircraftIcao`. No package scan, no livery |

### A.2 Row 10: Finance & trésorerie (7 screens)

- **Trésorerie & cashflow** (`#finance`). Shows balance, month cashflow, runway, debt, a 12-month revenue/expense/net/end-balance chart, income and spend by category, next big debits.
  - Exists: the ledger (every posting with `balance_after`), `GET /me/finance` for upcoming debits, loan principals.
  - Missing: a monthly aggregation by category (kind to category map: tickets = `line_revenue`, jobs/freight = `payout` split by `flights.kind`, fuel, payroll, maintenance, fees, credits, leasing); end-of-month balance (last `balance_after` of the month); runway; debt and instalment totals.
  - Ok: runway = balance / (month spend / 30) = 21.1 days; sums of the sample add up. **[NO MODEL]**: annual fleet insurance of 280 000 on 1 Dec (server bills a monthly premium per aircraft); payroll on the 28th (server: the 1st).
  - Limit: a young company has fewer than 12 months of ledger; the chart shows only what exists.
- **Rentabilité par ligne & avion** (`#finance/lines`). Contribution margin per line (flights, revenue, costs, margin %), loss-making lines with a cost breakdown, "what-if" with a based crew.
  - Exists: per-leg money on `scheduled_flights`, crew cost prorated (`pnl.crews`), aircraft fixed costs in `planMonth`.
  - Missing: a monthly aggregate per line **and** per aircraft ("Par avion" has no data in the frame, only the toggle); an allocation rule for fixed costs (leasing, insurance, parking: split by block hours across the lines an aircraft flew); catering cost (lot SERVICE, not merged); the what-if (re-run the line forecast with a crew based at the origin and another fill factor).
  - **[NO MODEL] / inconsistent**: the frame excludes "loyers" yet the Lyon-Marseille breakdown has a Leasing line (so an allocation rule is needed); interim "2.6x an in-house crew" (server: `interimPrice` is 1.8 × the daily salary); Lyon-Marseille loses 31 200 a month here but the recruiter frame says suspending it loses 5 400 a day of margin.
- **Crédits en cours** (`#finance/credits`). Instalments, debt ratio, borrowing room, rating, amortisation chart to 2033, early-repayment simulator, per-credit detail (aircraft loan 4.6 % and consumer credit 9.8 %), renegotiate, repay.
  - Exists: aircraft loans and their principal; `loanStep`.
  - Missing: **rate per loan** (the rate is a constant; `terms` JSON can carry it but `loanStep` ignores it); **early repayment** (full or partial, with interest saved and new instalment); a consumer credit with no aircraft (`contracts.aircraft_id` is NOT NULL: new table); debt ratio; rating; borrowing ceiling; renegotiation.
  - Ok: debt 8 126 000 = 7 808 000 + 318 000; instalments 125 100; the A220 loan is an annuity at 4.6 % (80.9 months left, "July 2033"); the 224 000 prepayment is the balance after 9 instalments of the 9.8 % credit.
  - **Mismatch**: interest saved is shown as 30 000, the model gives about 18 900. Rating is A- here, B+ on the next frame. Room is 940 000 here, ceiling 600 000 next.
- **Nouveau crédit conso** (`#finance/credit-new`). Amount slider, 5 durations, 3 bank offers, cost split, load on forecast surplus, effect after signing.
  - Missing: the whole credit product (quote, sign, billing, fees, insurance, net worth).
  - Ok (all 5 durations reproduce): annuity at 7.2 % + 112 a month insurance + 3 500 fee gives 40 700 for 24 months; debt ratio 6.1 to 7.1 % = (125 100 + 20 300) / 2 049 600; balance after = + 450 000 − 3 500. Other banks: 7.9 % (fee 1 200, 1 % early penalty), 9.6 % (no fee).
  - **[NO MODEL]**: rating B+ and the cap of 600 000 (about 30 % of last month's revenue); "surplus 28 400 a month in winter" needs the forecast (below).
- **Prévisions 12 mois** (`#finance/forecast`). Lowest balance per month, central/prudent/optimistic scenarios, overdraft days, a "test a decision" panel with 4 decisions.
  - Exists: `planMonth` projection (3 months today), line forecast (`weeklyDemand`), lease and loan terms.
  - Missing: a 12-month projection of revenue (expected line revenue plus a seasonal factor), scenario factors, overdraft days, decision re-runs.
  - **[NO MODEL]**: seasonality (winter -22 %, summer +30 %), scenarios (fill -8 %, fuel +12 % / fill +6 %), **C-check 420 000 / 9 days / "180 h of potential"** (no scheduled checks exist), annual airport fees 180 000, launch cost of a line 65 000, a 300 000 credit line at 1.5 % (no revolving credit). 3 of the 4 decisions can be computed from existing rules; "defer the C check" and "credit line" cannot.
- **Relevé des opérations** (`#finance/ledger`). Filtered, day-grouped statement with category, linked line or aircraft, signed amount and running balance, period summary, CSV, next scheduled posting, authorised overdraft 250 000 at 11.5 %.
  - Exists: the rows, `balance_after`, `flight_id`, memo, the CSV.
  - Missing: filters (period, category, line), day grouping, **links to a line and an aircraft** (the ledger has `flight_id` and free text only), category from `kind`, period summary, "next scheduled posting" (from the plan). The overdraft line is C19.
- **Échéance impayée & découvert** (`#finance/overdue`). **Empty frame.** See C19 and C20.

### A.3 Row 11: Groupe, filiales & alliances (5 screens)

- **Société mère & filiales** (`#group`). Consolidated group figures, one card per company (balance, result, aircraft, staff, lines), what the subsidiary borrows (hangar share, seconded mechanic), internal flows, "create a subsidiary", "wire funds".
  - Exists: several companies per user with separate balance, fleet, hubs, staff, lines; `GET /me/companies`.
  - Missing: a **parent link** (no `parent_id`, no ownership share); a consolidated read model (sum of balances, aircraft, staff, lines); **internal flows neutralised**, which needs the ledger to know the counterparty; an "as a group" result.
  - Ok: 1 332 760 = 1 284 560 + 48 200; result 177 300 = 238 600 − 61 300. **[NO MODEL]**: "résultat" is not defined (the server has cashflow, not accrual P&L). Staff is 142 or 140 on other frames, 70 on Staff, 76 here; aircraft 9 on the alliance frame, 8 and 10 here.
- **Créer une filiale** (`#group/new`). Identity (name, ICAO and IATA code, base, activity), initial funding, aircraft to cede, staff to move, facilities to share or rent, effect on both companies, creation fees.
  - Exists: `GET /airlines/code/:code`; `createCompany`; `staff.transfer`.
  - Missing: creation **without** the starting-capital grant (today `createCompany` always grants); IATA code and activity (no fields); cession of an aircraft (registration kept, loan follows the aircraft); staff moved between companies (`staff.company_id`, qualifications kept); shared facility use (`facility_contracts` has one holder per building, enforced by a partial unique index).
  - Ok: balance after = 1 284 560 − (220 000 + 2 800 + 9 500 + 1 200); recharged each month 4 350 = 2 400 + 1 950. **[NO MODEL]**: fees 2 800 / 9 500 / 1 200; "charges ≈ 44 000" (the listed items sum to 33 250); "5 months of charges" = the funding presets 0 / 1 month / 5 months of what the moved assets cost, computed, not 44 000.
- **Transferts entre sociétés** (`#group/transfers`). One screen, four tabs (money, people, aircraft, facilities), validated together ("Valider les 4 transferts"), intra-group loan at 3.5 % over 36 months, aircraft cession or fee-loan, refused free loan, leased aircraft needs the lessor's consent, tax note.
  - Missing: an atomic batch route that moves money, people, aircraft and building rights in one transaction; intra-group loans (instalment 7 325 = annuity at 3.5 %: ok); fee-loan of an aircraft (**the aircraft would be operated by a company that does not own it**: `aircraft.company_id` is both today); market-price rule; refusal for leased, club and rented aircraft.
  - Ok: flows +36 925 = 7 325 + 26 500 + 3 100. **[NO MODEL]**: the whole tax panel (VAT, transfer-pricing file): not modelled, flavour only (C25).
- **Alliance · membres & réseau** (`#alliance`). Member list with traffic share, online status, fleet and reputation, the combined map, alliance buildings rented to members, rules (2 % dues, votes), a pending vote.
  - Exists: presence signal (`seen_at`), companies, fleets, lines, `GET /companies/:id`.
  - Missing: everything about alliances: tables, invitations, unanimous admission, 30-day notice, 2 % monthly dues (a billing charge from last month's revenue), votes (one per company, two thirds), traffic share per member (passengers carried), buildings held by the alliance and rented to members, the codeshare and guaranteed-connection layers of the map, port of `alliance-map.js`. **It is the first screen that shows one player's data to another player**: C23.
  - **[NO MODEL]**: "AI company contribution" and the AI offer on a free building; the member names shown are usernames; reputation in stars (C17 of v3: 4.6 stars = 92 stored).
- **Alliance · installations partagées** (`#alliance/shared`). Choose where to do a C check: own hangar (impossible, no CRJ tooling), ally hangar (queue, kit shipped from the alliance warehouse), external workshop; costs and days compared; shared buildings list; sharing rules; hangar-day quota.
  - Exists: workshop stay (`status = 'maintenance'`, `maintenance_until`), hangar effects at own hubs (S3), warehouse and kits (S5, wave 3, not merged), "one ground day = one day of expected line revenue" (v3 B.8).
  - Missing: a **choice of workshop** for a maintenance stay; convoy flight to it; owner-first queue; external workshop prices; quota of ally hangar days (11 of 20 a quarter, fee doubles beyond); hangar qualification per aircraft type (140 000 and 12 days of works); **scheduled C checks with a hard limit date** (no model; C28).
  - Ok: totals reproduce: Marseille 147 500 = 12 400 + 64 800 + 68 000 + 2 300, Lyon 159 700 = 116 000 + 2 900 + 40 800, with 6 800 a ground day. All inputs except the day cost are **[NO MODEL]**.

### A.4 Row 07: Staff (4 new screens)

- **Centre de formation** (`#staff/training`). Trainees in progress, simulator load per week (68 % = 41 / 60 h), instructors' hours (31 of 35), a training Gantt (type ratings, command upgrade, periodic checks, cabin initial and recurrent), in-house against outside prices, 24 600 a month.
  - Exists: `train` (type rating, cost and days by category, a `training` leave row), `staff_quals.valid_until`.
  - Missing: a training **building** with simulator hours; **instructors** (can be `role = 'instructor'` on a pilot or cabin row, no migration of the family CHECK); courses as scheduled jobs with a seat limit; command upgrade (role is derived from hours today); periodic checks; cabin courses (cabin crew have no qualifications); in-house price and "saved in 2026" history.
  - **Conflict with v3**: outside CRJ qualification is 42 000 / 18 days here; `TRAINING_COURSE` has 24 000 / 21 days for a jet airliner (v3 B.3 states the same). Server value kept (C26). **[NO MODEL]**: instructor age and medical class ("65 years", "class 1 refused").
- **Reconversion en formateur** (`#retrain/<id>`). A 64-year-old captain loses his class 1 medical: four options (ground instructor, flight instructor, chief pilot, retire with a bonus), each with salary, teaching effect, morale, coverage gap with a rotation calendar, quote.
  - Missing: **age** and a **medical event** (no field, no model); morale that moves (it never does today); an option engine that rewrites role and salary; the line coverage gap (reuse `coverageOf` and interim price); a retirement bonus (48 000, about 4.2 months).
  - **[NO MODEL]**: every effect (morale +6 / +18 / +3, simulator load 112 to 94 %, "hub punctuality +3 %", team -4 %).
- **Politique RH & climat social** (`#staff/hr`). An HR director's style (5 levels) and compliance (5 levels, from "irreproachable" to "outside the law"), with effects on morale per family, productivity, departures, strike risk, labour-inspection fines, reputation, unpaid overtime saving.
  - Exists: rest policy (`legal | standard | generous`: rest hours, headcount, `riskFactor`); fatigue; payroll.
  - Missing: **all of it** (morale dynamics, attrition, strike, inspection, a director). **[NO MODEL]**: every effect figure. The compliance axis lets the player **break the duty limits that `crewLeg` enforces**: it contradicts the existing rule (C27).
- **Cabinet de recrutement** (`#staff/agency`). Recruiter mission: three ways to get 2 CRJ pilots with a cost over a year, then the mission with candidates, commission, salary premium, start date.
  - Exists: candidates (deterministic), hire with notice, interim, the line problem cost, `recruit` option on a stopped line.
  - Missing: an **agency mission** (a pool of already-qualified candidates ready in days, commission, premium); the 3-option comparison.
  - Ok, **all derivable**: commission 34 080 = 20 % of (8 300 + 5 900) × 12; surcharge 1 400 a month (+11 % on grid); 94 080 = 34 080 + 16 800 + 8 days × 5 400; training 310 800 = 2 × 42 000 + 42 days × 5 400; classic 343 700 = 3 500 + 63 × 5 400. Uses one daily figure, the line's stoppage cost.

### A.5 Row 01: Réglages · avions du simulateur (`#settings/aircraft`)

- Shows aircraft detected in MSFS 2024 (name, source, mapped career type, liveries, state: matched / to confirm / ignored / not in catalogue), rescan, a detail panel (type choice, liveries per owned aircraft, "use company livery"), a warning for a career type with no installed aircraft.
- Exists: the bridge reads the **loaded** aircraft (`atcModel`, `title`); `--aircraft` overrides the designator; the server compares types on verify.
- Missing: a **scan of installed packages** (Official, Community, Marketplace aircraft; a Windows file-system reader in the bridge, a new local endpoint beside `/status`); the mapping sim aircraft to career type (per user, so it survives a PC change); state machine; per-aircraft livery (**MSFS has no external API to set a livery**: C29).
- Not touched by this task: `sim/` and `packages/` stay as they are.

## Part B. Contract and lots

Conventions as `docs/v2-contract.md` and `docs/v3-plan.md` B: routes under `/api/v1`; money in euros; times in epoch ms; one `routes-<lot>.ts` registered by one line in `app.ts`; pure rules and wire types in `shared/src/<lot>.ts` (type-only imports from `index.ts`); web strings in a `// ---- <lot>` block at the end of `messages.ts`; a typed `api-<lot>.ts` that answers `null` on 404/405 (feature off). Money goes through `post()`. Frontends code against fixtures until the backend merges.

### B.0 Migrations and shared seams

The live DB is at position 10 (`…V8, V9, V10`). v3 wave 3 takes `SCHEMA_V11` (parts) and `SCHEMA_V12` (service). **v4 starts at `SCHEMA_V13`.** One number per lot; the orchestrator renumbers at merge if the order changes.

| Migration | Lot | Tables and columns |
|---|---|---|
| `SCHEMA_V13` | REPORTS | `transactions` gains nullable `line_id`, `aircraft_id`, `counterparty_id`, index `(company_id, at)`. `post()` takes an optional link argument; old rows keep NULL and show category from `kind` |
| `SCHEMA_V14` | CREDIT | `credits(id, company_id, bank, principal0, principal, rate, months, months_paid, monthly, fee, insurance, early_penalty_pct, started_at, status)`; `credit_ratings` is derived, not stored |
| `SCHEMA_V15` | AGENCY | `recruit_missions(id, company_id, base, qual, count, started_at, ready_at, commission, premium_pct, status)` |
| `SCHEMA_V16` | SIMAC | `sim_aircraft(user_id, sim_key, title, source, icao, state, seen_at, PRIMARY KEY(user_id, sim_key))` |
| `SCHEMA_V17` | GROUP | `companies.parent_id`, `companies.iata`; `group_loans(id, lender_id, borrower_id, principal, rate, months, months_paid, …)`; `group_audit(id, at, user_id, from_id, to_id, kind, amount, ref)` |
| `SCHEMA_V18` | TRAINING | `staff.birth_year`; `training_courses(id, company_id, staff_id, kind, type_icao, start_day, end_day, place 'own'|'outside', cost)`; building kind `training` is catalogue code (S3 pattern, no table) |
| `SCHEMA_V19` | HR | `hr_policy(company_id, style, law, since)`; `staff_morale_log` only if C30 says so |
| `SCHEMA_V20` | ALLIANCE | `alliances`, `alliance_members(…, since, left_at)`, `alliance_votes`, `alliance_ballots(vote_id, company_id, choice, PRIMARY KEY(vote_id, company_id))`, `alliance_facilities`, `alliance_bookings` |

Shared seams, to keep merges trivial:
- `finance.ts` `planMonth` has 6 positional arguments today. CREDIT adds the 7th (`credits`, same pattern as S3's `facilities`); ALLIANCE adds the 8th as a precomputed `Charge[]` (dues); GROUP's monthly intra-group flows are two ledger lines posted by each company's own billing run, tagged with `counterparty_id`. **Merge CREDIT first**; the others rebase a 3-line hunk.
- `NET_WORTH_SQL` in `game.ts` must subtract credit principal and group loans (CREDIT, GROUP).
- `createCompany` gets one path without the starting grant (GROUP). The leaderboard ranks groups, not subsidiaries (GROUP, C21).
- `hubs-overview.ts` `doors` gets one line per new entry (Finance, Group, Alliance).

### B.1 Guards the lots must keep (trust boundaries)

- **Group transfers.** Authorise both companies through `ownedCompany` at user level, not through the active-company header; only parent to subsidiary or back; one `tx`; the sum of balances before and after is equal (a test); no transfer creates or destroys an aircraft or a person.
- **No farming.** A subsidiary gets **no** starting grant, counts against the 5-company cap (C21), and is hidden from the leaderboard; the parent's net worth includes its equity.
- **Credit.** Instalments go through idempotent billing; `bankruptcyBailout` must not erase a credit principal; the ceiling and rating are computed on the server from the ledger, never from a client number.
- **Alliance.** Members see only the fields the frames show; a vote is one ballot per company (primary key); a non-member gets 404, never 403; usernames are shown only inside the alliance (C23).
- **Sim mapping.** The mapping is advisory: it never relaxes `checkTelemetry` (the type, fuel, payload and speed checks stay).

### B.2 Lot table, ordered by playable value

Backend and frontend are a pair per lot. "Needs" lists what must merge first. Wave 1 is 4 parallel agents, wave 2 starts when REPORTS and CREDIT are in.

| # | Lot | Frames | Needs | Migration | Playable value | Owner files |
|---|---|---|---|---|---|---|
| 1 | **REPORTS** (cashflow, statement, profitability, forecast) | trésorerie, rentabilité, relevé, prévisions | nothing | V13 | See where the money goes; almost no new rules, a read model over data that exists | BE `reports.ts`, `reports-views.ts`, `routes-reports.ts`, `shared/src/reports.ts`, `ledger.ts` (link argument). FE `screens/finance-route.ts`, `finance-cash.ts`, `finance-lines.ts`, `finance-ledger.ts`, `finance-forecast.ts`, `api-reports.ts`, `scenes.ts` (`finance`) |
| 2 | **CREDIT** (consumer credit, early repayment, rate per loan, overdraft and unpaid rules) | crédits en cours, nouveau crédit conso, échéance impayée (design needed) | REPORTS (revenue helper) | V14 | A financial lever with a price; first real use of the cash screens | BE `credit.ts`, `routes-credit.ts`, `shared/src/credit.ts`, `finance.ts` (arg 7, per-loan rate in `loanStep`). FE `finance-credits.ts`, `finance-credit-new.ts`, `api-credit.ts` |
| 3 | **AGENCY** (recruiter mission, 3-option comparison) | cabinet de recrutement | nothing (uses S1 and S2) | V15 | Closes a stopped line with money; reuses `problem.cost.perDay` | BE `agency.ts`, `routes-agency.ts`, `shared/src/agency.ts`. FE `screens/staff-agency.ts`, `api-agency.ts` |
| 4 | **SIMAC** (simulator aircraft mapping) | avions du simulateur | nothing; touches `sim/bridge` (brief for that lot must allow it) | V16 | A real sim pilot can fly a line rotation in the right aircraft | BE `simair.ts`, `routes-simair.ts`, `shared/src/simair.ts`; bridge `sim/bridge/src/packages.ts` (scan, local endpoint). FE `screens/settings-aircraft.ts`, `api-simair.ts`, `settings.ts` (one section line) |
| 5 | **GROUP** (subsidiaries, consolidated view, transfers) | société mère, créer une filiale, transferts | REPORTS, CREDIT | V17 | A second way to grow (a cargo arm, a regional arm) | BE `group.ts`, `group-transfers.ts`, `routes-group.ts`, `shared/src/group.ts`, `game.ts` (grant-free create, net worth, leaderboard). FE `screens/group-route.ts`, `group.ts`, `group-new.ts`, `group-transfers.ts`, `api-group.ts` |
| 6 | **TRAINING** (centre, instructors, reconversion) | centre de formation, reconversion | AGENCY (shared staff helpers), S3 | V18 | Cheaper type ratings, a use for old pilots; needs age (C26) | BE `training.ts`, `routes-training.ts`, `shared/src/training.ts`. FE `screens/staff-training.ts`, `retrain.ts`, `api-training.ts` |
| 7 | **ALLIANCE** (alliances, votes, shared buildings, workshop choice, map) | alliance membres, installations partagées | REPORTS, GROUP, S5 | V20 | The multiplayer layer; last because it needs several players to be fun | BE `alliance.ts`, `routes-alliance.ts`, `shared/src/alliance.ts`. FE `screens/alliance.ts`, `alliance-shared.ts`, `alliance-map.ts` (port of `alliance-map.js`), `api-alliance.ts` |
| 8 | **HR** (climate, morale dynamics) | politique RH | TRAINING | V19 | Lowest value, most invented numbers: ship last or not at all (C27, C30) | BE `hr.ts`, `routes-hr.ts`, `shared/src/hr.ts`. FE `screens/staff-hr.ts`, `api-hr.ts` |

Order of merge: REPORTS, CREDIT, AGENCY, SIMAC, GROUP, TRAINING, ALLIANCE, HR (backend first, then each frontend). Wave 1: REPORTS, AGENCY, SIMAC, and CREDIT as soon as REPORTS exposes its revenue helper (or start it against a stub). Wave 2: GROUP, TRAINING, ALLIANCE, HR.

Definition of done per lot as in v3: tests next to the code (`shared/` rules, routes through `harness.ts`, a migration test from the previous version), `npm run typecheck` and `npm test` green, a web view-model test with fixtures, a `scripts/smoke.mjs` step, no edit to another lot's section of this file.

### B.3 Contracts in short (the exact wire types are written by each lot's backend half)

- **REPORTS.** `GET /finance/cash?months=12` returns `{ balance, runwayDays, debt: { total, monthly, credits }, months: { month, revenue, spend, net, endBalance, byCategory }[], upcoming }`. `GET /finance/lines?month=&by=line|aircraft` returns rows and the cost breakdown of a selected row. `GET /finance/ledger?from=&to=&category=&line=&before=&limit=` returns grouped rows with `lineId`, `aircraftId`, plus a `summary`. `GET /finance/forecast?scenario=` returns 12 points `{ month, low, central, prudent, optimistic }` and `POST /finance/forecast/decision` returns the new low point. Category map is code (`shared/src/reports.ts`).
- **CREDIT.** `GET /credits` (list, ratio, rating, room, schedule), `POST /credits/quote {amount, months, bank}`, `POST /credits` (409 `over_ceiling`, `too_many`, `debt_ratio`), `POST /credits/:id/prepay {amount|full}`, `POST /me/loans/:id/prepay`. Rating table and bank offers are constants. `409 insufficient_funds` as elsewhere.
- **AGENCY.** `GET /agency/options?base=&qual=&count=` (the three options with the per-day stoppage cost), `POST /agency/missions` (pays nothing until the signature), `POST /agency/missions/:id/sign {candidateIds}` (commission and premium paid then).
- **SIMAC.** `PUT /sim-aircraft` (the scan result from the bridge, session auth), `GET /sim-aircraft`, `PUT /sim-aircraft/:key {icao|ignore}`. A career type with no installed aircraft appears as a warning in `GET`.
- **GROUP.** `GET /group` (consolidated and per company), `POST /group/subsidiaries` (identity, base, funding, items), `POST /group/transfers` (a batch, one transaction, all or nothing). 409 codes: `not_your_company`, `leased_aircraft`, `aircraft_flying`, `insufficient_funds`, `limit_reached`.
- **TRAINING.** `GET /training` (week plan, load, instructors, price comparison), `POST /training/courses`, `GET /staff/:id/retrain`, `POST /staff/:id/retrain {option}`.
- **HR.** `GET /hr`, `PUT /hr/policy {style, law?}` with a preview (`GET /hr/preview?style=`).
- **ALLIANCE.** `GET /alliance`, `POST /alliance`, `POST /alliance/invite`, `POST /alliance/votes`, `POST /alliance/votes/:id/ballot`, `GET /alliance/shared`, `POST /alliance/bookings` (a workshop stay at a member's hangar), `POST /alliance/leave`.

### B.8 Numbers the mockup shows that no model produces (or that disagree)

"Ok" rows are reproduced by the formula in the right column. Server numbers win on a clash (C10 of v3).

| Number (screen) | Status | Lot adopts |
|---|---|---|
| Runway 21 days (cash) | ok | `balance / (monthly spend / 30)` |
| Debt ratio 6.1 % to 7.1 % (credits) | ok | instalments / last full month's revenue |
| Consumer credit 40 700 for 24 months (credit-new, all 5 durations) | ok | annuity at the bank's rate + monthly insurance × n + fee; banks 7.2 % (fee 3 500, insurance 112), 7.9 % (1 200, ≈135, 1 % early penalty), 9.6 % (none) |
| Credit ceiling 600 000, rating B+ | [NO MODEL] and inconsistent (A- and 940 000 on the list frame) | ceiling = 30 % of last full month revenue, floor to 10 000, at least 10 M and at most 100 M (amounts go by 10 000; the debt ratio is waived inside the 10 M); rating from debt ratio, B when there is no revenue (B+ up to 9 % as the frame states) |
| Interest saved by prepaying 224 000 = 30 000 | does not reproduce (≈18 900) | show the computed value |
| Aircraft loan 4.6 %, market 4.1 % | server has 6.9 % fixed | keep `LOAN_RATE` for aircraft; rate stored per credit; renegotiation not modelled (C22) |
| Payroll 486 000 / 492 000 on the 28th vs 345 500 elsewhere | inconsistent | payroll as staff computes it, on the 1st |
| Annual fleet insurance 280 000 on 1 Dec | [NO MODEL] | monthly premium per aircraft, as billed |
| Line margins, per-flight revenue and cost (rentabilité) | Against the autonomous model at 50 % (`settle`, load 78 %, 52 % on Lyon-Marseille): revenue per flight Orly -7 %, Lyon +11 %, Lyon-Marseille +22 %, Genève 1.9×, Calvi 2.8×. Costs are 1.7× to 3.4× the model's fuel + fees + maintenance (the mockup also counts crew, catering, leasing) | allocated model costs; screens show the server's value. The catalogue gives `CRJ7` **150 seats** where the mockup flies a CRJ700: check the entry before calibrating |
| Seasonality ±22 / +30 %, scenarios, C check 420 000, line launch 65 000, credit line 1.5 % | [NO MODEL] | monthly factor table and two scenario factors as constants; C check and credit line out (C28) |
| Overdraft 250 000 at 11.5 % | [NO MODEL] | C19 |
| Group figures: staff 142 / 140 / 70 / 76, aircraft 9 / 8 / 10 | inconsistent | server counts |
| Subsidiary charges ≈ 44 000, creation fees 2 800 / 9 500 / 1 200 | [NO MODEL] | fees are constants; charges computed from moved assets |
| Intra-group loan 7 325, flows +36 925 | ok | annuity at 3.5 % over 36 months |
| C check totals 147 500 and 159 700 | ok | `fee + work + convoy + days × daily revenue` (6 800 a day) |
| Training 16 800 / 31 000 (ATR), 27 500 / 46 000 (A220), 42 000 / 18 days (CRJ outside) | conflicts with `TRAINING_COURSE` (24 000 / 21 days) | server price outside; in-house = a factor (C26) |
| Simulator 68 % = 41 / 60 h; instructors 31 / 35 h | ok | capacity constants per building level |
| Reconversion and HR effects (morale, productivity, departures, fines 45 000, strike) | [NO MODEL] | C27, C30 |
| Recruiter: commission 34 080, +11 % salary, 94 080 / 310 800 / 343 700 | ok | commission 20 % of the annual salary; premium 11 %; 4 + 4 days; the line's stoppage cost per day |
| Suspending the line loses 5 400 a day of margin | inconsistent (the same line has a negative margin in Finance) | use `problem.cost.perDay` (lost revenue) and say "revenue" |

### B.10 Routes and keys (read from each frame's HUD Bottom; the keyboard map has none)

`Tab` is bound to a letter alias as in v3 (C17 of v3); the letter in brackets is my proposal. Doors on `#hubs`: Finance `B`, Group `G`, Alliance `L` (to be checked against the existing `doors` and `shortcutOf` when built).

| Screen | Hash | Back | Hint keys |
|---|---|---|---|
| Trésorerie & cashflow | `#finance` | `#hubs` | `Échap`, `Tab` [`T`] filtres, `Entrée` sélectionner, `F1` |
| Rentabilité par ligne & avion | `#finance/lines` | `#finance` | `Tab` [`T`] ligne ou avion, `↑↓` ligne, `Entrée` recruter un équipage CRJ |
| Crédits en cours | `#finance/credits` | `#finance` | `←→` mois, `Tab` [`T`] crédit, `Entrée` simuler un remboursement |
| Nouveau crédit conso | `#finance/credit-new` | `#finance/credits` | `←→` montant, `↑↓` durée, `Tab` [`T`] banque, `Entrée` signer |
| Prévisions 12 mois | `#finance/forecast` | `#finance` | frame has no hints: `←→` scénario, `Entrée` appliquer (inferred) |
| Relevé des opérations | `#finance/ledger` | `#finance` | `↑↓` parcourir, `Tab` [`T`] filtres, `Entrée` détail, `X` export CSV |
| Échéance impayée & découvert | `#finance/overdue` | `#finance` | none (empty frame) |
| Société mère & filiales | `#group` | `#hubs` | `↑↓` société, `Entrée` ouvrir, `F1` |
| Créer une filiale | `#group/new` | `#group` | `←→` montant ou choix, `Entrée` créer, `F1` |
| Transferts entre sociétés | `#group/transfers` | `#group` | `Tab` [`T`] type, `R` inverser le sens, `Entrée` valider |
| Alliance · membres & réseau | `#alliance` | `#hubs` | `↑↓` membre, `Tab` [`T`] vue, `Entrée` voir la compagnie |
| Alliance · installations partagées | `#alliance/shared` | `#alliance` | `↑↓` atelier, `Tab` [`T`] vue, `Entrée` réserver |
| Centre de formation | `#staff/training` | `#staff` | `←→` semaine, `Tab` [`T`] stagiaire ou formateur, `Entrée` planifier |
| Reconversion en formateur | `#retrain/<id>` | `#staff/<id>` | `1`-`4` option, `Entrée` confirmer, `F1` |
| Politique RH | `#staff/hr` | `#staff` | `↑↓` curseur, `←→` régler, `Entrée` appliquer |
| Cabinet de recrutement | `#staff/agency` | `#staff` | `↑↓` option, `Espace` retenir un candidat, `Entrée` lancer la mission |
| Avions du simulateur | `#settings/aircraft` | `#dashboard` | `Tab` [`T`] section, `Entrée` confirmer, `R` relancer l'analyse |

One-argument routes only (`parseHash` joins the rest): `finance`, `group`, `alliance` and the `staff` sub-views are one route name each with a small router file, as `staff-route.ts` does.

## Part C. Product questions for Chloé

Defaults are what the lots take until she answers: one constant or one flag each. Numbering continues from v3 (C17).

| # | Question | Proposed default | Why |
|---|---|---|---|
| C18 | **Consumer credit: offered at all?** (unsecured, 3 banks, ceiling, rating) | **Yes.** 3 fixed banks (7.2 / 7.9 / 9.6 %), ceiling `CREDIT_CEILING_PCT = 30` of last full month revenue, at most `CREDIT_MAX_ACTIVE = 2`, rating from the debt ratio | The frames price it and every figure reproduces; it is the only way out of a winter dip besides selling aircraft |
| C19 | **Overdraft: is there one, and what does it cost?** (frame shows 250 000 at 11.5 %) | **Yes.** `OVERDRAFT_LIMIT = 250_000`, interest `OVERDRAFT_RATE = 0.115` a year on the lowest negative balance of the month, billed monthly. Balance below `-limit` after a billing charge flags the company `unpaid` | Today a negative balance costs nothing and a bailout wipes it; a rate gives debt a price |
| C20 | **What happens on an unpaid instalment?** (the frame is empty) | Instalment is still taken; late fee `UNPAID_FEE_PCT = 5` of it; reputation `-2` stored points (a stoppage day); no seizure. The `bankruptcyBailout` toggle still clears the balance once a season but **never the credit principal** | I will not invent a seizure rule on a blank screen; this keeps the cost visible and reversible. **Needs a mockup frame** |
| C21 | **How do subsidiaries share money and count?** | A subsidiary is a full company owned 100 % by the parent, **funded only by transfer (no starting grant)**, counts toward the 5-company cap, hidden from the leaderboard (the parent's net worth includes it). Transfers only parent to subsidiary and back, at market price | Prevents grant farming (5 companies = 5 grants) and leaderboard stuffing. One flag `SUBSIDIARY_COUNTS_IN_CAP` |
| C22 | **Renegotiating a loan** (4.6 % shown, market 4.1 %) | **Not modelled.** Rate is fixed at signing; aircraft loans stay at `LOAN_RATE` | The market rate has no source; one more simulation for one button |
| C23 | **What do alliance members see of each other?** (first cross-player data) | Company name, fleet size, reputation, online state, **username**, only inside the alliance; no other player's lines or money. `ALLIANCE_MAX_MEMBERS = 6` | Joining is consent; nothing else leaks. Change one function to hide usernames |
| C24 | **Alliances with AI companies?** | Players only vote. AI companies appear as fixed **offers** on free alliance buildings (the Méridia Cargo offer in the frame), never as members | AI has no votes or accounts; it keeps the frame's scene without a second AI engine |
| C25 | **Codeshare and guaranteed connections: revenue?** | **No revenue sharing.** A pair flown by two members does not split demand between them (`captured = demand × own / (own + non-member rival seats)`); the map draws it. Guaranteed connections are not modelled; the tax and transfer-pricing panel is a text panel of the 3 rules we enforce | Money flowing between players invites abuse; this is observable and needs no ledger |
| C26 | **Training: centre, instructors, ages, prices** | Building kind `training` (courses cost `TRAINING_INHOUSE_FACTOR = 0.6` of the outside price, simulator hours per level). Instructor is `role = 'instructor'` on a pilot or cabin row. Staff gain `birth_year`; a pilot is retired at 65 (`RETIREMENT_AGE`), the reconversion screen opens from 12 months before. **No medical-refusal event.** Outside price stays the server's (24 000 / 21 days) | Keeps v3 prices, avoids a medical model nobody asked for; the screen's 42 000 / 18 days loses to the server |
| C27 | **HR policy: how much of it?** (and may the player break the law) | Only the style axis (5 levels): morale drift, attrition and payroll effect. **The compliance axis is out:** duty limits are enforced by `crewLeg` and an "illegal" setting would contradict them. No strikes, fines or productivity bonus | Every effect figure is invented; the legal axis breaks an existing rule |
| C28 | **Scheduled C checks with a hard limit date?** (forecast, shared workshops) | **No calendar checks.** The "workshop choice" books the **existing** wear workshop stay at a chosen workshop (own, ally, external): fee + convoy + lost days; the forecast drops the C-check decision | Calendar checks are a new maintenance system; the existing stay already immobilises the aircraft |
| C29 | **Aircraft liveries** (per aircraft, "take the company livery") | **Dropped.** MSFS has no external way to set one; the screen keeps type mapping only. Mapping is advisory (a type with no installed aircraft warns, never blocks) and stored per user on the server | The bridge can read a title, not apply a livery |
| C30 | **Morale model** (stored today, never changes) | Morale moves monthly toward a target set by the HR style, fatigue and refused leave; attrition is a seeded roll from morale. If HR (C27) is not built, morale stays static | One owner for morale, none for the rest |
| C31 | **Payroll date, mockup figures** (28th and 492 000 vs the 1st and 345 500) | **Server wins:** payroll on the 1st, computed from staff. The mockup's payroll lines are fixed later (C10 rule of v3) | Billing is lazy and monthly; a 28th date needs a second billing day |
| C32 | **Subsidiary activity and IATA code** (passengers / cargo / charter, code `N7`) | Stored as labels only (`companies.iata`, activity in the group row); no rule reads them | Fields cost nothing, rules that read them would need their own lot |
| C33 | **Aircraft transfer: cession or loan with a fee?** | **Cession only in the first GROUP PR** (ownership moves at book value, the loan follows, leased, club and rented aircraft refused, no flying aircraft). Fee-loans come second: they need an operator that is not the owner | A cession is one UPDATE; a loan touches fleet, flights, lines and hub parking |

## Appendix: what v4 does not touch

`packages/` and `sim/` (except the SIMAC lot, which needs its own brief), SayIntentions, the MSFS panel constraints, the flows accept, fly, complete, verify, anti-cheat. `settle` is unchanged. Nothing in this PR is product code: it adds the mockup import (`docs/design/`) and this file.
