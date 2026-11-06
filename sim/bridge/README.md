# opc-bridge

Reads your aircraft from Microsoft Flight Simulator while you fly an accepted job, builds the telemetry report the
OpenPilotCareer server verifies (`POST /api/v1/flights/:id/telemetry-verify`, see [docs/telemetry-api.md](../../docs/telemetry-api.md)),
delivers it, and tells the in-sim panel what is going on.

> **Live-simulator proof is NOT done.** Everything except the SimConnect socket is tested: the flight logic on sample
> streams, the network layer against a real server, the CLI end to end. The adapter that talks to MSFS
> (`src/simconnect.ts`) is tested for decoding, mapping and the "no simulator running" path only. It has never met a running
> MSFS 2020 or 2024. Read [What is not verified](#what-is-not-verified) before relying on it.

## How it fits together

```
MSFS ──SimConnect──▶ simconnect.ts ─┐                     (fly)
fixture file ───────▶ fixture.ts ───┴▶ SimSample ▶ tracker.ts ▶ Telemetry ▶ deliver.ts ▶ OpenPilotCareer server
                                          (replay)   phases, flags         outbox/ + backoff
                                                           │
                                                      session.ts ▶ status.ts ▶ GET 127.0.0.1:7878/status ▶ MSFS panel
```

- `tracker.ts` is pure (no I/O, no SimConnect): `preflight → taxiOut → airborne → landed → parked`. Touch-and-go and go-around are
  not landings. At `parked` it builds the report: nearest airport from `data/airports.json` for departure and arrival, aircraft from
  ATC MODEL (the accepted flight's aircraft when ATC MODEL is not a valid designator), payload = total − empty − fuel at takeoff,
  fuel used, touchdown rate, great-circle distance, `source: "simconnect"`.
- Anti-cheat flags, always sent with the report: `slew_detected`, `time_acceleration_above_1x`, `teleport_jump_over_50nm`,
  `long_pause`. The server rejects any flagged flight and tells the pilot why, unless its owner turned anti-cheat off (`antiCheat: false` in `/api/v1/info`; `flights` and `fly` print a note then). The client never decides; it only reports.
- `deliver.ts` writes the report to `outbox/` in the config directory **before** the first send, then retries with exponential
  backoff (1 s … 5 min). One file per (server, flight), so re-sending is idempotent; a `409` means an earlier send got through.
  Reports left by a previous run are sent when `fly` starts.
- `live.ts` posts a live position (`POST /api/v1/flights/:id/live`, see [docs/telemetry-api.md](../../docs/telemetry-api.md)) every 2 s while `fly` or `replay` runs, so the web app can show the flight in progress. It is best effort: one request at a time, a 4 s timeout, every failure is logged once and swallowed, and the flight tracker never waits for it. Altitude, heading and engine gauges (`PLANE ALTITUDE`, `PLANE HEADING DEGREES TRUE`, `TURB ENG MAX TORQUE PERCENT`, `TURB ENG N1`, `TURB ENG ITT`, `GENERAL ENG OIL PRESSURE`, per engine) come from a second SimConnect data definition, so a SimVar the sim refuses cannot touch the tracker's own readings; a gauge the aircraft does not have is omitted. A replay of a recording carries neither, so the heading is the track between samples and the altitude the integrated vertical speed (relative to the field). **Like the rest of `simconnect.ts`, these SimVars have not met a running MSFS.**
- `status.ts` serves the fixed panel contract on `127.0.0.1:7878` only (Host header checked against DNS rebinding), with
  `Access-Control-Allow-Origin: *`. Besides the panel fields it reports `sim` (`connected | waiting | unavailable`: SimConnect link, or no SimConnect client on this machine) and `version` (the bridge's version) for the web app's onboarding; the panel ignores them. It is read-only and contains no secrets.

## Install and use

Needs Node.js ≥ 26 (it runs the TypeScript sources directly) and, for flying, MSFS on the same Windows machine.

```
npm ci                                         # from the repository root
node sim/bridge/src/cli.ts setup               # server URL + API key (web app → Settings → API keys); checked against the server, then saved
node sim/bridge/src/cli.ts flights             # your active flights; accept a job in the web app first
node sim/bridge/src/cli.ts fly 42              # follow MSFS and report flight 42 when you park. Ctrl+C quits
node sim/bridge/src/cli.ts replay sim/bridge/fixtures/ga-c172-lfpn-lfaq.json --server URL --key KEY
```

`npm link -w @opc/bridge` puts `opc-bridge` on your PATH. `--server`/`--key` (or `OPC_API_KEY`) override the saved setup for one run.
The key is only ever sent in the `Authorization` header and never printed or logged. It lives in
`$XDG_CONFIG_HOME/openpilotcareer/config.json` (`%APPDATA%\OpenPilotCareer` on Windows), created with mode 600; a config readable by
other users is refused. The bridge warns when the key would cross a network over plain `http://`.

`replay` feeds a stream through the same session code as `fly`, headless, and picks the active flight that flies the same route in
the same aircraft (or use `--flight ID`). It plays the stream as if the flight started when the job was accepted, because the
server checks the times against its own clock. Exit code: 0 verified, 2 rejected, 1 nothing reported.

### Fixtures

`fixtures/*.json` are **synthetic**: generated by `scripts/make-fixtures.ts` from airport coordinates and a simple flight model,
never recorded from a simulator. They cover an airliner, a GA piston, a helicopter, a touch-and-go, a go-around, and three cheats
(slew, 4× simulation rate, teleport). `node sim/bridge/scripts/make-fixtures.ts FROM TO airliner|ga|helicopter OUT.json` makes a
clean flight for any airport pair, to match a job you accepted.

## Stack: why node-simconnect

The bridge is TypeScript so it reuses `@opc/shared` (the telemetry schema and the same airport data the server uses). The
alternative was a C# .NET 8 host for the SimConnect part only. Evaluated: [`node-simconnect`](https://github.com/EvenAR/node-simconnect) 4.2.1.

| | |
|---|---|
| Licence | LGPL-3.0-or-later. Used unmodified as a dependency of this AGPL-3.0 project. |
| Maintenance | Releases 4.2.0 (May 2026) and 4.2.1 (Oct 2026), several outside contributors, listed users include FSLTL Injector and the Virtual Norwegian client. |
| MSFS 2024 | Documented as supporting "Microsoft Flight Simulator (X, 2020, 2024)". The `FSX_SP2` protocol the bridge asks for works on 2020 and 2024 (its README says so); 2024-only protocol levels are not needed. |
| Runtime | **No `SimConnect.dll` and no SDK.** It implements the SimConnect wire protocol in TypeScript over the named pipe / TCP port MSFS opens. Its only dependencies are `debug` and `ini`. |
| Fit | Typed, promise-based `open()` and exactly the calls needed (`addToDataDefinition`, `requestDataOnSimObject`, `subscribeToSystemEvent`). |

Consequences: nothing native to compile, the package installs and the whole test suite runs on Linux, and `simconnect.ts` loads it
with a dynamic `import()` so `replay`, `setup` and the other tests never touch it. Checked here: on Linux with no simulator,
`open()` fails with a connection error and `watchSim` logs "waiting for the simulator" and retries every 5 s.
Cost: a community protocol implementation is a smaller project than Microsoft's own client, so a protocol change in a future MSFS
update could break it until a new release. Only `src/simconnect.ts` (about 130 lines) depends on it, so a replacement host stays a
one-file change: it only has to produce `SimSample`s.

### SimVars read (once per second, user aircraft)

`ATC MODEL`, `TITLE`, `CATEGORY`, `ENGINE TYPE`, `SIM ON GROUND`, `IS SLEW ACTIVE`, `PLANE LATITUDE`, `PLANE LONGITUDE`,
`GROUND VELOCITY`, `VERTICAL SPEED`, `PLANE TOUCHDOWN NORMAL VELOCITY`, `FUEL TOTAL QUANTITY WEIGHT`, `TOTAL WEIGHT`, `EMPTY WEIGHT`,
`SIMULATION RATE`, plus the `Pause` system event. Units are requested in the SimVar definition (knots, feet/minute, kilograms,
degrees), so the core never converts. Every reading is validated against the `SimSample` schema before it reaches the core; an
invalid reading is dropped and mentioned once in the log.

## What is not verified

- **Anything against a running MSFS** (2020 or 2024): that the SimVars and units behave as documented on every aircraft class, that
  the data-buffer layout in `FIELDS` matches what MSFS sends (the read order follows the node-simconnect API and its samples),
  connection discovery on Windows, reconnecting after the sim quits, and the touchdown-rate latch (`PLANE TOUCHDOWN NORMAL VELOCITY`
  is treated as the sim's latched value; without it the tracker falls back to the vertical speed before touchdown).
- **Pause detection.** The brief lists `SIMULATION PAUSED`; the MSFS SDK documents no such SimVar, so the `Pause` system event is
  used. MSFS 2024 has reported bugs with its pause events (and photo mode sends none). While the sim is paused no data
  arrives, so a long pause also shows up as a time gap, which raises `long_pause` independently.
- `ATC TYPE` is not read: nothing consumes it.
- **Add-on aircraft** reporting an empty weight of 0 cannot be reported (the payload cannot be measured; the panel shows why).
  A non-designator ATC MODEL falls back to the aircraft of the accepted flight.
- Windows specifics: the config path under `%APPDATA%` and the missing file-permission check there; the hidden key prompt of
  `setup` on an interactive terminal (tested with piped input only; `--key` and `OPC_API_KEY` avoid the prompt).
- The thresholds in `tracker.ts` (3 s off the ground = airborne, 30 s stopped = parked, 15 min = long pause) are reasoned, not
  tuned on recorded flights.

## Tests

`npm test -w @opc/bridge`: tracker on all fixtures, network layer against local stub servers (validation, 0600 config, outbox,
backoff, idempotent resend), session and status endpoint (panel contract, CORS, Host check), CLI subprocess tests, SimConnect
decoding and mapping. The end-to-end run against the real `packages/server` is in the pull request description.
