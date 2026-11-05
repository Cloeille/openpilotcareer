# Telemetry verification API

The contract between OpenPilotCareer servers and simulator clients (a SimConnect/MSFS companion, a manual tool, anything that can send HTTPS). It is part of API version 1. The client itself is out of scope for this repository; this document is what it must implement.

## Authentication

Create a key in **Settings → API keys** in the web app. A key is shown **once**; the server stores only its SHA-256 hash. Send it as a bearer token:

```
Authorization: Bearer opc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A key is bound to one **account**, not to one company: a player can own several companies (up to 5) and one key serves all of them. Every flight carries its `companyId`, and the server pays the company that accepted the job. The client needs no company selection and sends no `X-OPC-Company` header (it is ignored here). A key can do exactly two things: list the active flights of all of that account's companies and submit telemetry for any of them. It cannot read the account, spend money or change anything else. Revoke it in the same screen; a revoked key is rejected immediately. Session tokens from the web login are **not** accepted here (401), and API keys are not accepted elsewhere.

## Find the flight

```
GET /api/v1/flights/active
→ 200 [ { "id": 42, "companyId": 7, "status": "active", "aircraftIcao": "C172",
          "job": { "origin": "LFPG", "destination": "EGLL", "distanceNm": 195, "payloadKg": 300, "pax": 3, "requiredAircraft": "A320"?, ... },
          "acceptedAt": 1783166400000, ... } ]
```

The player accepts a job in the web app first; the flight is then `active` until verified, rejected, completed manually or cancelled.

## Submit telemetry

```
POST /api/v1/flights/:id/telemetry-verify
Content-Type: application/json
```

```json
{
  "takeoffAt": "2026-11-04T10:30:00Z",
  "landedAt": "2026-11-04T11:15:00Z",
  "departureIcao": "LFPG",
  "arrivalIcao": "EGLL",
  "aircraftIcao": "A320",
  "payloadKg": 8000,
  "fuelUsedKg": 1450,
  "landingFpm": -240,
  "distanceNm": 205,
  "source": "simconnect"
}
```

| Field | Type | Meaning |
|---|---|---|
| `takeoffAt`, `landedAt` | ISO 8601 date-time with `Z` or offset | Wheels-off and wheels-on, simulator-reported |
| `departureIcao`, `arrivalIcao` | 4 letters A–Z | Airports where the flight actually started and ended |
| `aircraftIcao` | 2–4 chars A–Z/0–9 | ICAO type designator of the aircraft flown |
| `payloadKg` | number ≥ 0 | Payload on board at takeoff |
| `fuelUsedKg` | number ≥ 0 | Fuel burned between takeoff and landing |
| `landingFpm` | number | Vertical speed at touchdown (negative = descending). ±10 000 max in the schema |
| `distanceNm` | number ≥ 0 | Distance flown |
| `source` | `"simconnect"` or `"manual"` | Where the data came from |

Unknown fields are ignored; wrong types or missing fields are a `400`.

### Server-side checks

All must pass, otherwise the flight is **rejected**:

1. `departureIcao` / `arrivalIcao` equal the job's origin and destination.
2. `aircraftIcao` equals the aircraft assigned to the flight.
3. `landedAt` is after `takeoffAt`, not in the future (5 min clock skew allowed), and `takeoffAt` is not before the job was accepted (5 min skew).
4. Duration is plausible for the distance and the aircraft's cruise speed: not faster than 125 % of cruise, not slower than 40 % of cruise plus one hour.
5. `distanceNm` is between 85 % and 2× (+20 nm) of the job distance.
6. `payloadKg` is at least 90 % of the job payload.
7. `fuelUsedKg` is between 25 % and 300 % of the aircraft type's expected burn.
8. `|landingFpm|` ≤ 1500.

### Response `200`

```json
{ "verification": "verified", "reason": null, "flight": { "id": 42, "status": "verified", "revenue": 3100, "fuelCost": 1305, "landingFee": 160, "maintenance": 90, "net": 1545, ... } }
```

| `verification` | `flight.status` | Effect |
|---|---|---|
| `verified` | `verified` | Paid in full. Measured fuel, block time and landing rate replace the estimates. Reputation up (down on a hard landing, ≥ 600 fpm, which also doubles maintenance). |
| `unverified` | `unverified` | `source: "manual"` passes the same checks but is never trusted: paid at **60 %** (`MANUAL_PAY_FACTOR` in `packages/shared`), costs use the type's estimates, small reputation gain. |
| `rejected` | `rejected` | Unpaid. `reason` says which check failed. Reputation −2. The job stays claimed, so a failed flight cannot be retried. |

A rejected report is a normal `200`; clients should show `reason` to the pilot. The same flight cannot be submitted twice: a closed flight answers `409 flight_closed`.

### Errors

Every non-2xx response is `{ "error": "<code>", "message": "<text>" }`.

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_request` | Body failed schema validation (message lists the fields) |
| 401 | `unauthorized` | Missing, wrong or revoked API key |
| 404 | `flight_not_found` | No such flight in **any company of this account** (other players' flights look identical) |
| 409 | `flight_closed` | Flight is no longer `active` |
| 429 | `rate_limited` | Too many credential attempts from one IP |

## Manual completion without a client

The web app offers **Complete manually** on an active flight. It is equivalent to a `manual` report: `unverified`, 60 % pay, estimated costs, and only allowed once the fastest believable flight time (distance ÷ 1.25 × cruise speed) has elapsed.
