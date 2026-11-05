# OpenPilotCareer

An open-source flight-sim career and economy hub, in the spirit of Pilops. Fly jobs in your simulator, get paid, grow a company, and compete with other pilots and AI-run airlines on a monthly leaderboard. **Phase 1 (this repository): the career core, the server and web app, and the verification contract** that a later simulator bridge will plug into.

- Self-hostable: `docker run` and you have your own server. No account on anyone else's.
- Any aircraft: compatibility comes from data per ICAO type (2 561 FAA type designators), plus your own custom aircraft.
- A shared job board that human pilots and AI companies compete for. A job taken by anyone disappears for everyone.
- Honest verification: simulator telemetry is checked server-side and pays in full; manual completion pays 60 %.
- Your data is yours: full JSON/CSV export and password-confirmed account deletion.

## Quickstart

### Docker

```sh
docker build -t openpilotcareer .
docker run -d --name opc -p 8080:8080 -v opc-data:/data openpilotcareer
# open http://localhost:8080
```

The container runs as an unprivileged user and keeps its SQLite database in `/data` (WAL mode). To back it up, stop the container and copy the whole `/data` directory; players can also export their own data from the app.

### From source (developed and tested on Node 26; Node runs the TypeScript directly, nothing is transpiled)

```sh
npm install
npm test                       # shared + server + web unit tests
npm run build                  # builds the web app into packages/web/dist
npm run start -w @opc/server   # serves API and web app on http://localhost:8080
npm run smoke                  # end-to-end check against a throwaway server
```

For development run the server (`npm run dev:server`) and the Vite dev server (`npm run dev:web`) side by side; in the app pick *Custom server* and enter `http://localhost:8080`.

### Server settings (environment)

| Variable | Default | Meaning |
|---|---|---|
| `OPC_DB` | `opc.sqlite` (`/data/opc.sqlite` in Docker) | SQLite file |
| `OPC_PORT` / `OPC_HOST` | `8080` / `0.0.0.0` | Listen address |
| `OPC_SERVER_NAME` | `OpenPilotCareer` | Name shown in `/api/v1/info` |
| `OPC_REGISTRATION` | open | `closed` stops new sign-ups |
| `OPC_TRUST_PROXY` | off | `1` behind a reverse proxy, so rate limiting uses the real client IP |
| `OPC_WEB_ROOT` | `packages/web/dist` | Built web app to serve (skipped when absent: API only) |

Put the server behind HTTPS (a reverse proxy such as Caddy or nginx) before exposing it: logins and API keys are bearer tokens.

## Server choice and identity

There is no central account system. **Every server has its own accounts, companies, economy and leaderboard, and identities are not shared across servers**: `alice` on one server is unrelated to `alice` on another, and nothing moves between them except an export you do yourself.

- The web app defaults to the **global server**, set at build time by `VITE_OPC_GLOBAL_URL` (the `npm run build` here builds a self-hosted app whose default is whichever server serves it; `npm run build:static -w @opc/web` builds against the constant `OPC_GLOBAL_URL` in `packages/shared`).
- At login you can pick **Custom server** and enter any URL. The app checks `GET /api/v1/info` → `{ name, version, apiVersion, registrationOpen }` before sending credentials, and remembers the choice in `localStorage`. Switching server signs you out.
- The API allows cross-origin requests (`Access-Control-Allow-Origin: *`) so any static host can serve the web app. Authentication is a `Bearer` header, never a cookie.

## Architecture

```
packages/shared   types, zod schemas and ALL economy rules in one file (src/index.ts)
packages/server   Fastify API + node:sqlite; one SQLite file; also serves the built web app
  catalog.ts      aircraft types + airports from data/*.json     board.ts     deterministic job board
  game.ts         every state change (ledger, claims, flights)   ai.ts        AI companies' tick
  app.ts          routes, auth hooks, CORS                       simbrief.ts  SimBrief fetch + validation
  db.ts           schema + migrations (PRAGMA user_version)      auth.ts      scrypt, sessions, API keys
packages/web      Vite + vanilla TypeScript, no framework; DOM built with textContent only
data/             generated aircraft-types.json, airports.json (+ build.py to regenerate)
```

1. **One rulebook.** `packages/shared` holds every number: payout `distance × payload × rate`, fuel, landing fee, maintenance, ranks, telemetry plausibility. Server, AI and UI import it; nothing is duplicated.
2. **One profit formula.** Players and AI companies both go through `game.ts` (`startFlight` → `finishFlight` → `settle`), so a human and an AI flying the same job are paid identically.
3. **Deterministic shared board.** Each airport's jobs are a pure function of (airport, 6-hour window): no job table to maintain. A job exists in the database only once claimed.
4. **A job can be taken once.** `job_claims.job_id` is the primary key; claiming is `INSERT … ON CONFLICT DO NOTHING` inside a `BEGIN IMMEDIATE` transaction. A test races six OS processes on one database file: exactly one wins.
5. **AI companies** (8 seeded, aggressive or cautious, each with hubs and preferred aircraft) play deterministic ticks every 6 hours. Ticks are computed from server time and run lazily on the first API request after they fall due. `ai_ticks.tick` is unique, so a tick can never run twice, and each tick's randomness is seeded by (company, tick).
6. **Money has one door.** `post()` is the only code that changes a balance, and it appends the matching ledger line in the same transaction; tests assert that every ledger sums to its balance.
7. **Seasons** are UTC months. Company stats are snapshotted into `season_stats` on every change; the current season is read live, past seasons from the snapshot.

## Aircraft data

`data/aircraft-types.json` is generated from the FAA type-designator order (see `DATA-LICENSES.md`): ICAO code, name, category, engines, wake class. About 70 common types in `data/aircraft-curated.csv` carry real-world seats/cargo/cruise/range. Every other type gets **estimates from its category, engine count and wake class**, flagged `derived: true` in the API and shown as "estimated" in the UI. An ICAO designator the list does not know still works through the generic category fallback, and you can define **custom aircraft** (add-ons, homebuilts) per company. Payload and revenue maths only ever read these fields.

## API overview (`/api/v1`)

Errors are `{ "error": "<code>", "message": "<text>" }`. Session routes take `Authorization: Bearer <token>`.

| Area | Endpoints |
|---|---|
| Server | `GET /info` |
| Reference data | `GET /airports?q=`, `/airports/:icao`, `/aircraft-types?q=`, `/aircraft-types/:icao` |
| Accounts | `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /me`; `DELETE /me` (needs password) |
| Your data | `GET /me/export?format=json\|flights.csv\|transactions.csv`, `/me/flights`, `/me/transactions` |
| API keys | `GET`/`POST /me/api-keys`, `DELETE /me/api-keys/:id` |
| Company | `POST /me/hubs`, `/me/fleet`, `/me/custom-aircraft`; `DELETE /me/custom-aircraft/:icao` |
| Jobs | `GET /jobs[?airport=]`, `POST /jobs/:id/accept`, `POST /jobs/import-simbrief` |
| Flights | `POST /flights/:id/complete` (manual, unverified), `/flights/:id/cancel` |
| Verification | `GET /flights/active`, `POST /flights/:id/telemetry-verify` (API key): see [docs/telemetry-api.md](docs/telemetry-api.md) |
| Competition | `GET /leaderboard[?season=YYYY-MM]`, `GET /companies/:id` |

### SimBrief

`POST /jobs/import-simbrief {"simbriefUsername": "…"}` makes the **server** fetch your latest plan from `https://www.simbrief.com/api/xml.fetcher.php?username=…&json=1` (8 s timeout, 4 MB cap, redirects refused, response validated with zod) and turn it into a private job for the aircraft type you planned. SimBrief being down, slow, unknown-user or returning garbage gives a clear 404/502/504 message instead of an error page.

## Simulator integration

- [docs/telemetry-api.md](docs/telemetry-api.md): the API-key contract a simulator client uses to find the active flight and submit telemetry. Live.
- [docs/simbrief.md](docs/simbrief.md): how a SimBrief plan becomes a job, limits, errors, privacy, and differences from SimBrief's own documentation.
- [docs/sayintentions.md](docs/sayintentions.md): what SayIntentions.AI documents for third parties and why the supported flow goes through SimBrief.
- [sim/bridge](sim/bridge): the SimConnect bridge. *In progress; not on `main` yet, so this link is dead until it lands.*
- [sim/msfs-package](sim/msfs-package): the MSFS package with the in-sim panel. *In progress; same caveat.*

## Privacy

A server stores your username, a scrypt password hash, a hashed session token, hashed API keys (shown once), and your game data. No email, no analytics, no third-party requests except the SimBrief fetch you trigger. The operator of a server can see everything on it, so choose a server you trust or run your own. **Export** (Settings) gives you all of it as JSON/CSV; **Delete account** (Settings, password required) permanently removes the account, company, fleet, flights, ledger and keys from that server, and releases any jobs you had claimed. Telemetry you submit is stored with the flight.

## Not in this phase

The SimConnect bridge, an MSFS 2024 package and voice/ATC integrations. The telemetry contract they will use is already live and documented.

## Licence

Code: [GNU AGPL-3.0](LICENSE). If you run a modified server for others, you must offer them its source. Data: see [DATA-LICENSES.md](DATA-LICENSES.md). Not affiliated with Pilops or any other commercial product.
