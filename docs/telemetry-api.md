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
  "source": "simconnect",
  "flags": []
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
| `flags` | optional array of up to 16 names (`a-z`, `0-9`, `_`, max 40 chars) | Anti-cheat flags the client raised during the flight: `slew_detected`, `time_acceleration_above_1x`, `teleport_jump_over_50nm`, `long_pause`, `reload_after_crash`. Always send them, never decide yourself: any flag rejects the flight (unless the server has anti-cheat off). `long_pause` alone is tolerated by companies with pause tolerance; `reload_after_crash` never is. Stored with the report |
| `interruptions` | optional `{ reloads, simRestarts, downtimeMs }`: integers ≥ 0, counts ≤ 1 000, `downtimeMs` ≤ 7 days | Reloads of an earlier save and simulator restarts (game crashes) the client saw and **allowed**, and how long the simulator was away. Send it whenever one happened; bridges that predate it omit it. Not a flag: nothing is rejected for it, pay is unchanged, the flight detail shows it. The downtime is subtracted from the block time for the "too long" check only |

Unknown fields are ignored; wrong types or missing fields are a `400`.

### Server-side checks

All must pass, otherwise the flight is **rejected**. Checks 1-3 tie the report to the accepted job and always apply; the rest are anti-cheat ([see below](#turning-anti-cheat-off)).

1. `departureIcao` / `arrivalIcao` equal the job's origin and destination.
2. `aircraftIcao` equals the aircraft assigned to the flight.
3. `landedAt` is after `takeoffAt`, not in the future (5 min clock skew allowed), and `takeoffAt` is not before the job was accepted (5 min skew).
4. *(anti-cheat)* Duration is plausible for the distance and the aircraft's cruise speed: not faster than 125 % of cruise, not slower than 40 % of cruise plus one hour. For the "slower than" bound only, `interruptions.downtimeMs` is subtracted from the duration, so a game crash and restart is not rejected as a slow flight; the duration used for pay and for the "faster than" bound is the real one.
5. *(anti-cheat)* `distanceNm` is between 85 % and 2× (+20 nm) of the job distance.
6. *(anti-cheat)* `payloadKg` is at least 90 % of the job payload.
7. *(anti-cheat)* `fuelUsedKg` is between 25 % and 300 % of the aircraft type's expected burn.
8. *(anti-cheat)* `|landingFpm|` ≤ 1500.
9. *(anti-cheat)* `flags` is empty or absent.

### Reloads and game crashes

The simulator can crash, and an aircraft can bug out, so the client **allows** reloading a flight from an earlier save and restarting the sim mid-flight. The client does the judging (the server cannot see the track); how the bridge decides is in [sim/bridge/README.md](../sim/bridge/README.md#reloads-and-game-crashes). What reaches the server:

- a plain reload or game crash: no flag, `interruptions` filled in;
- a reload (or a restart) right after the aircraft crashed or was in a violent descent: the flag `reload_after_crash`, which rejects the flight like any other flag;
- a forward jump (to near the destination), which is still `teleport_jump_over_50nm`.

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

## Live position (optional)

While the player flies, the client may also push its position so the web app can show the flight in progress. It is best effort: a client that never sends it still gets its flight verified exactly as above.

```
POST /api/v1/flights/:id/live        (API key; the flight must be active and yours)
→ 204 No Content
```

Body (every field required, validated; units are feet, knots, feet/minute, degrees, kilograms, °C, psi):

```json
{ "t": 1793782805000, "lat": 48.75, "lon": 2.1, "altFt": 3500, "gsKts": 110, "vsFpm": 0, "headingDeg": 45, "fuelKg": 90,
  "phase": "airborne", "paused": false, "simRate": 1, "flags": [], "engines": [ { "n1Pct": 88.5, "ittC": 640, "oilPsi": 62 } ] }
```

`phase` is `preflight | taxiOut | airborne | landed | parked`. An engine gauge the aircraft does not have is left out (`engines: []` when it has none); it is never sent as 0.

- At most **one sample per second per flight**: a faster one gets `429 rate_limited` and is simply dropped. The bridge sends one every 2 s.
- `404 flight_not_found` (not your flight, or unknown), `409 flight_closed` (verified, cancelled, ...), `400 invalid_request` (the body), `401` (not an API key). Stop sending after a 404 or 409.
- The server keeps only the **latest** sample per flight, in memory, plus `last_live_at` on the flight. A restart forgets the sample, not the time.

The web app reads it back with the player's session:

```
GET /api/v1/flights/:id/live
→ 200 { "sample": LiveSample | null, "receivedAt": 1793782806000 | null, "bridgeLost": false, "remainingNm": 23.4 | null, "etaAt": 1793784210000 | null }
```

`bridgeLost` is true when the flight is active, has reported before, and nothing arrived for more than 30 s (a flight whose bridge never started is not "lost", it has `sample: null`). `remainingNm` is the great-circle distance to the destination airport; `etaAt` (epoch ms) is that distance at the current ground speed and sim rate, only while airborne, not paused and above 30 kt.

## Manual completion without a client

The web app offers **Complete manually** on an active flight. It is equivalent to a `manual` report: `unverified`, 60 % pay, estimated costs, and only allowed once the fastest believable flight time (distance ÷ 1.25 × cruise speed) has elapsed (no wait when anti-cheat is off).

## Turning anti-cheat off

A server owner can disable anti-cheat for the whole server with `OPC_ANTICHEAT=off` (default on), for example for a private server where people use time acceleration. It is a single switch, there are no per-check settings. `GET /api/v1/info` reports it as `"antiCheat": false`; servers that predate the setting omit the field and always verify. Clients should tell the pilot.

With anti-cheat off:

- **Skipped:** client `flags`, duration, flown distance, payload, fuel used and landing rate (the checks marked *anti-cheat* above), and the minimum wait before **Complete manually**. Reported values are accepted as they are, so a report is `verified` and paid in full with the measured fuel, block time and landing rate. Flags and numbers are still stored with the flight.
- **Still enforced:** departure, arrival and aircraft must match the job, and landing must come after takeoff, not in the future and not before the job was accepted. These make the report about the accepted job; they are not cheating checks.
- **Unchanged:** `source: "manual"` and **Complete manually** remain `unverified` at 60 % pay with estimated costs, because they carry no measurement.
