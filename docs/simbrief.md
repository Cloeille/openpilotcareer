# SimBrief import

How a SimBrief flight plan becomes an OpenPilotCareer job, what can go wrong, what leaves your server, and where the importer differs from SimBrief's own documentation.

Describes the code at commit `94f807c` (`packages/server/src/simbrief.ts`, `importJob` in `packages/server/src/game.ts`, route in `packages/server/src/app.ts`). Checked against SimBrief's live endpoint and documentation on 2026-11-05. Statements marked **unverified** could not be confirmed from a fetched source.

## What it does

`POST /api/v1/jobs/import-simbrief` makes **the server** (never the browser) fetch the pilot's *latest* SimBrief flight plan (OFP), reads seven fields from it, and stores them as a private pending job. The pilot then accepts that job like any board job.

```
browser ──POST {simbriefUsername}──▶ OPC server ──GET xml.fetcher.php?username=…&json=1──▶ simbrief.com
                                         │ validate (zod) → map → importJob()
                                         ▼
                              201 Job { source: "simbrief", id: "sb-<uuid>", … }
```

Auth: session bearer token only. API keys (telemetry clients) are not accepted here (`user(req)` → `sessionAuth`).

### Request

```http
POST /api/v1/jobs/import-simbrief
Authorization: Bearer <session token>
Content-Type: application/json

{ "simbriefUsername": "someone" }
```

`simbriefUsername` must match `^[A-Za-z0-9._ -]{1,64}$` (`simbriefImportSchema` in `packages/shared`). The server trims it, URL-encodes it and requests:

```
GET https://www.simbrief.com/api/xml.fetcher.php?username=<encoded>&json=1
Accept: application/json        (8 s timeout, no redirects, 4 MiB cap)
```

### Response `201`

```json
{ "id": "sb-5f0c…", "source": "simbrief", "kind": "pax", "origin": "LFPG", "destination": "EGLL",
  "distanceNm": 188, "payloadKg": 15000, "pax": 150, "payout": 11944,
  "requiredAircraft": "A320", "plannedFuelKg": 5200, "route": "DCT" }
```

(Numbers from a local run: 150 pax LFPG → EGLL.)

## Field mapping

| SimBrief JSON field | Required | Becomes | Notes |
|---|---|---|---|
| `origin.icao_code` | yes, `^[A-Z]{4}$` | `origin` | Must also exist in the bundled airport database, else `422 unknown_airport` |
| `destination.icao_code` | yes, `^[A-Z]{4}$` | `destination` | same |
| `aircraft.icaocode` | yes, `^[A-Z0-9]{2,4}$` | `requiredAircraft` | The job can only be flown with exactly this ICAO type (`cannotFly`), checked at accept time |
| `weights.payload` | yes, number ≥ 0 | `payloadKg` for **cargo** jobs | Converted to kg, rounded |
| `weights.pax_count_actual` | no (default 0) | `pax` | `> 0` makes the job `pax` |
| `fuel.plan_ramp` | yes, number ≥ 0 | `plannedFuelKg` | Stored and shown only; not used in payout or settlement |
| `general.route` | no (default `""`), ≤ 4000 chars | `route` | Longer routes fail validation (not truncated) |
| `params.units` | yes, string | unit switch | starts with `k` (case-insensitive) → kg, anything else → lbs × 0.45359237 |

Numeric fields are coerced from strings (SimBrief sends numbers as strings). Everything else in the OFP (about 410 KB in the sample I fetched) is read and discarded.

What the server computes itself, not from the OFP:

- **`distanceNm`**: great-circle distance between the two airports in the bundled database.
- **`kind`**: `pax` when `pax_count_actual > 0`, otherwise `cargo`.
- **`payloadKg`** for a `pax` job is `pax × 100 kg` (`PAX_KG`), **not** SimBrief's payload. SimBrief's `weights.payload` is the *total* load. In the one plan I inspected it equalled pax weight + bag weight + freight (176 × 185 + 176 × 35 + 5 271 = 43 991 lb). So on a mixed passenger + freight plan the freight is dropped. This is intentional (`importJob` comment: "pax jobs pay for pax × PAX_KG only").
- **`payout`**: `round(distance × payloadKg × rate)` with the same `jobRate` as board jobs.
- **`id`**: `sb-` + random UUID. Importing the same plan twice creates two jobs (no de-duplication).

## Lifecycle and limits

| Rule | Value | Source |
|---|---|---|
| Visibility | only the importing account; listed under `imported` in `GET /api/v1/jobs`; another account gets `404` on accept | `pendingImports`, `resolveJob`, `app.test.ts` |
| Lifetime | 7 days (`IMPORT_TTL_MS`). Older rows are hidden at once and **deleted on that company's next import** (claimed or not; the flight keeps its own copy) | `game.ts` |
| Pending cap | 25 unclaimed jobs per company → `409 limit_reached` | `MAX_PENDING_IMPORTS` |
| SimBrief timeout | 8 s (`AbortSignal.timeout`), also covers reading the body | `simbrief.ts`, checked with a server that stalls mid-body |
| SimBrief response size | 4 MiB, checked on `content-length` and while streaming | `MAX_BYTES` |
| Request body | 64 KiB (global Fastify limit) | `app.ts` |
| Request rate | **no import-specific limit.** `authLimiter` (20/min/IP) only guards register and login | `app.ts` |
| Redirects | refused (`redirect: 'error'`) | `simbrief.ts` |

## Errors

Every error is `{ "error": "<code>", "message": "<text>" }`. Checks run in this order; the SimBrief request happens **before** the airport, load and cap checks.

| # | When | Status | `error` |
|---|---|---|---|
| 1 | No or invalid session token | 401 | `unauthorized` |
| 2 | Body fails schema (bad characters, empty, > 64 chars) | 400 | `invalid_request` |
| 3 | Network error, DNS/TLS failure, redirect, or timeout | 504 | `simbrief_unavailable` ("did not answer in time" / "could not be reached") |
| 4 | `content-length` > 4 MiB, no body, or streamed body > 4 MiB | 502 | `simbrief_invalid` |
| 5 | Body is not JSON (this includes an HTML maintenance page, whatever its status) | 502 | `simbrief_invalid` |
| 6 | HTTP 400 whose JSON has `fetch.status` (e.g. `Error: Unknown UserID`) | 404 | `simbrief_not_found`, message `SimBrief: Unknown UserID` |
| 7 | Any other non-2xx with a JSON body | 502 | `simbrief_unavailable` ("SimBrief answered HTTP n") |
| 8 | JSON does not match the schema above | 502 | `simbrief_invalid` ("a flight plan this server cannot read") |
| 9 | Airport not in the database | 422 | `unknown_airport` |
| 10 | Origin equals destination | 422 | `invalid_plan` |
| 11 | No passengers and payload 0 | 422 | `invalid_plan` |
| 12 | 25 pending imports already | 409 | `limit_reached` |

Failures at accept time (wrong aircraft type, not at the origin, too few seats, out of range) belong to `POST /jobs/:id/accept`, not to the import.

## Privacy

- **What leaves the server:** the SimBrief username, as a query-string parameter, from the server's IP to `www.simbrief.com`. The browser never contacts SimBrief. It will appear in SimBrief's logs and in any egress proxy log on your side.
- **What is stored:** only the seven mapped values (plus the computed distance, kind and payout) in `custom_jobs`, and later in the flight. **The username is not stored and not in the export** (no column; checked against `/me/export` after an import). The Fastify request logger is off (`logger: false`).
- **SimBrief's endpoint is unauthenticated.** SimBrief returned a full plan for Pilot ID `1` to a request with no credentials. Anyone who knows a username or Pilot ID can read that pilot's latest plan, and an OPC user can import someone else's latest plan by typing their name. The resulting job is private to the importer, and OPC exposes nothing SimBrief does not already.
- Per-user rate limiting and the shared egress IP: see finding F4.

## Tests at `94f807c`

`node --test packages/server/src/simbrief.test.ts` → 7/7 pass; the route test in `app.test.ts` passes.

Covered: kg parsing; lbs → kg; the exact request (URL, encoded username, timeout signal, `redirect: 'error'`); unknown user → 404 with SimBrief's message; network error and timeout → 504; HTTP 500 JSON, non-JSON 200, bad ICAO code, negative payload, empty object → 502; oversized responses (declared and streamed); route validation (`../etc` → 400), `201`, listing under `imported`, other accounts get `404`, accept works.

**Not covered** (confirmed by search and by probes I ran locally): `422 unknown_airport`, same-airport and empty-load rejections at the route; the 25-job cap; TTL purge; the `pax × 100 kg` rule; whitespace-only usernames; HTML 5xx bodies; a stalled body.

## Importer vs SimBrief's documentation

SimBrief's published material on this endpoint is a short page on the Navigraph developer portal and a newer Navigraph forum post with the same title (last edited 2026-10-14 per the forum's JSON). They do not agree with each other on `json`, and neither lists the OFP field names (the portal's SimBrief section has five pages: introduction, how-it-works, using-the-api, fetching-ofp-data, layout-options; none is a field reference). Field names below are therefore verified only against one live response.

| ID | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | **No `client=` parameter.** SimBrief asks apps to identify themselves with `&client=<app>[-version]`. The importer sends none. | forum post 5297 | Low; may matter if SimBrief ever filters anonymous callers |
| F2 | **`json=1` vs `json=v2`.** The portal page documents `json=1`. The newer forum post says `json=1` is still supported but has "formatting issues" and recommends `json=v2` for new code. Live, `json=1` emits `{}` for empty elements (`fetch.static_id`, `general.sid_ident`, …) where `json=v2` emits `""`. The schema would reject a `{}` in any field it reads (tested: `general.route = {}` → 502). Whether SimBrief can send an empty `general.route` is **unverified**. I ran the importer against a live `json=v2` response and it produced identical output. | portal page; forum post 5297; live probes | Low |
| F3 | **Identifier.** SimBrief now calls the `username` value the pilot's *Navigraph Alias* and offers `userid` (Pilot ID, 1–7 digits) as an alternative. The importer only supports `username`, its UI says "SimBrief username", and an unknown name comes back as `Unknown UserID`. Whether aliases can contain characters outside `[A-Za-z0-9._ -]` is **unverified**. | forum post 5297; live probe | Low |
| F4 | **Usage restriction.** SimBrief: call only in response to a user action, never poll, "excessive calls may result in your app being automatically banned by the server's firewall". The importer is user-triggered, but has no per-user or per-IP throttle on this route, all users of one server share one egress IP, and the fetch runs **before** the cap check, so a client already at 25 pending jobs still triggers SimBrief calls (probe: 24 import attempts → 24 outbound calls, the last one answered `409`). SimBrief gives no numeric limit. | forum post 5297; local probe | **Medium** for a busy shared server |
| F5 | **Blank username passes validation.** `" "` matches the regex, is trimmed to `""`, and goes out as `username=&json=1`. Live, SimBrief answers `400 Unknown UserID`, so the client sees a clean `404`, at the cost of one wasted call. | local probe; live probe | Low |
| F6 | **Any 400 is "not found".** SimBrief documents `400` for "an invalid user … or an error occurs". The importer maps every 400 with a `fetch.status` to `404 simbrief_not_found`. Other `Error:` texts exist or not: **unverified**. | portal page | Low |
| F7 | **Status check comes after JSON parsing.** A `503` HTML maintenance page is reported as `simbrief_invalid` "not JSON", not as `simbrief_unavailable` "answered HTTP 503". | local probe | Low |
| F8 | **Stalled body.** The 8 s timeout does abort a body that stops mid-stream, but the error is `502 simbrief_invalid` "not JSON" (after 8 010 ms), not `504`. | local probe | Info |
| F9 | **`redirect: 'error'`.** A future redirect (host move, scheme change) would surface as `504 could not be reached`. The current endpoint answers directly (200/400, no redirect). | live probe | Info |
| F10 | **Single live sample.** The one live plan checked was a lbs plan for a B752; no kgs plan and no cargo-only plan was checked live. Unit handling is covered only by the unit tests. | live probe | Info |

Matches: endpoint host and path; `username` and `json` parameters; `400` + small error body for an unknown user (`{"fetch":{"userid":"","static_id":"","status":"Error: Unknown UserID","time":"0.0004"}}`, `application/json`; XML without `json`); `200` with the full OFP for a valid user.

No server code was changed. Cheap fixes if wanted: add `&client=opc`, switch to `json=v2`, reuse `Limiter` on the route and check the cap before fetching, reject blank names after trimming, and check the status before parsing.

## Sources

Fetched 2026-11-05:

- https://developers.navigraph.com/docs/simbrief/fetching-ofp-data (endpoint, `username`/`userid`, `json=1`, 200/400 behaviour)
- https://developers.navigraph.com/docs/simbrief/introduction, `/using-the-api`, `/how-it-works` (SimBrief login is not bypassed; API key for dispatch generation; not needed for fetching)
- https://forum.navigraph.com/t/fetching-a-users-latest-ofp-data/5297 (`client=`, `json=v2`, Navigraph Alias, usage restrictions)
- Live: `https://www.simbrief.com/api/xml.fetcher.php` with `username=<unknown>` (with and without `json=1`), `username=`, `userid=1&json=1`, `userid=1&client=…&json=v2`
