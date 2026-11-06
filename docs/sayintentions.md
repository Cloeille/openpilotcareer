# SayIntentions.AI integration

What SayIntentions.AI (SI) documents for third parties, what OpenPilotCareer (OPC) can legitimately do with it, and what it should not.

Researched 2026-11-05 from SI's own pages, its knowledge base (KB), and SimBrief/Navigraph pages (sources at the end). A claim without a source is marked **unverified** or **inferred**.

## Verdict

- **A documented public API exists**, but it controls SI's voices, radios and weather. **None of its endpoints accepts a flight plan, a job, or a flight result.** I found no import format (PLN, FMS, ICAO FPL or otherwise) for sending a plan into SI.
- **The only documented way SI gets an IFR plan is SimBrief.** The pilot enters their SimBrief username or User ID in the SI Pilot Portal; SI fetches the plan from SimBrief. (A portal setting, "Allow VFR Departures in Jets", lets a pilot skip it; see below.)
- So the feasible integration is **SimBrief-mediated, and needs no SI API and no SI key**: the pilot plans in SimBrief, SI reads that plan, and OPC reads the same plan with the existing importer ([simbrief.md](simbrief.md)).
- The SAPI route exists but costs more than it gives. See [Not recommended](#sapi-from-the-opc-server-not-recommended).

## What SI documents

### SAPI (SayIntentions API), in "PREVIEW"

Docs: <https://p2.sayintentions.ai/p2/docs/>, announced in the KB at <https://kb.sayintentions.ai/article/full-documentation-of-our-api-sapi-and-flight-json>.

| Fact | Detail |
|---|---|
| Base URL | `https://apipri.sayintentions.ai/sapi/<endpoint>`, HTTP GET (one POST: `importVAData`) |
| Credentials, both on every call | `X-Developer-Key` header (identifies the *application*) + `api_key` parameter (identifies the *pilot*) |
| Developer key | Requested in the Pilot Portal (company, website, product, plan); an older mirror of the docs says to email support instead (see Sources). **Personal key**: instant, works only with its owner's own `api_key`. **Distribution key**: for apps other pilots use, reviewed by SI, emailed when approved. "Keep your developer key private. Don't publish it in public source code." |
| Pilot `api_key` | Shown on the Pilot Portal account page, or in `flight.json` |
| Availability | "currently in PREVIEW and Free. This may change at some point in the future." Not available to demo customers; a subscription is required |
| Rate limit | "no strict rate limits", but abuse can get access restricted; guideline: a few dozen voice requests per flight |
| Content rule | Messages must be "family friendly" and "aviation themed" or the account is terminated |

Endpoints (all listed in the docs page): `sayAs`, `getCommsHistory`, `getWX`, `getTFRs`, `getVATSIM`, `assignGate`, `getParking`, `getAirport`, `setFreq`, `getTransponder`, `setTransponder`, `acceptLastHandoff`, `getCurrentFrequencies`, `getAirSpaceFrequencies`, `setVar`, `setPause`, `importVAData`. Most need an active flight session. **Nothing sets or imports a flight plan, and nothing reports takeoff, landing or a completed flight.**

`importVAData` (POST) lets an *established virtual airline* push free-text prompts (`crew_data`, `dispatcher_data`, `copilot_data`, `skyops_data`) that shape the AI's behaviour. It needs a separate VA key from SI; the KB says "THIS IS FOR ESTABLISHED VIRTUAL AIRLINES ONLY" (<https://kb.sayintentions.ai/article/va-link-virtual-airline-integration-api>). It carries context, not a plan.

### flight.json (local, read-only)

Same docs page. While the SI Windows client runs, it serves the current flight at `http://localhost:43117/flightJSON` (also on the LAN, `Access-Control-Allow-Origin: *`) and writes `%LOCALAPPDATA%\SayIntentionsAI\flight.json`. Updated every 3 to 30 s; `{}` when no flight. "Access to Flight.JSON and SimAPI will remain free and open indefinitely."

Relevant fields: `flight_details.current_flight.flight_origin`, `flight_destination`, `flight_plan_route`, `flight_plan_sid`, `flight_plan_star`, runways, `callsign`, `current_airport`. **It also contains the pilot's `Email` and `api_key`** in clear.

### Active Flights API

<https://kb.sayintentions.ai/article/active-flights-api>: `GET https://tracker.sayintentions.ai/api/public/active-flights`, header `x-api-key`, 60 requests/min, to be called from a backend. Returns **all** currently active SI flights (position, `origin`, `final_destination`, `flight_icao`, `displayname`, `userId` unless the pilot opted out). It is a public-tracker feed, not a per-pilot lookup.

### Partner access

<https://kb.sayintentions.ai/article/getting-a-partner-api-key>: partner keys are granted case by case via SI's Discord. For ordinary integrations "your application should allow each user to provide their own SayIntentions.AI API key". Whoever collects those keys is responsible for storing them securely and for the privacy policy; SI takes no liability.

### SimAPI

<https://kb.sayintentions.ai/article/simapi-integrate-with-any-flight-simulator>: a file-based adapter protocol (`simAPI_input.json`, `simAPI_output.jsonl` in `%localappdata%\SayIntentionsAI`) for simulators SI does not support itself. Windows only. MSFS is natively supported (<https://kb.sayintentions.ai/article/feature-comparison-by-flight-simulator-and-product-line>), so it does not apply to us.

### How SI reads a flight plan

- Pilot Portal → Settings → General → "SimBrief: input your Username or UserID" (<https://kb.sayintentions.ai/article/pilot-portal-settings-explained>).
- Without it, IFR service is blocked ("Before you can fly IFR, you'll need to have your SimBrief username setup, and you'll need to file your IFR flight plan on SimBrief"); a setting allows VFR departures in jets. The fix list ends with "In the SayIntentions.AI app, press New Flight" (<https://kb.sayintentions.ai/article/why-am-i-getting-the-message-before-you-can-fly-ifr-you-ll-need-to-have-your-simbrief-username-setup-and-you-ll-need-to-file-your-ifr-flight-plan-on-simbrief>). **Inferred**: the plan is fetched at New Flight. The KB does not say so.
- From the plan SI uses the callsign and aircraft type if the pilot ticks "Use SimBrief", the ICAO equipment string and PBN (decides SID vs radar vectors), the `SEL/` code (oceanic SELCAL), and a virtual-airline ICAO code (<https://kb.sayintentions.ai/article/aircraft-identity-settings>, <https://kb.sayintentions.ai/article/aircraft-equipment-on-your-ifr-flight-plan>). Fields beyond these: **unverified**.
- An SI developer said in 2024 that SI imports a plan from the pilot's SimBrief username and proposed a SimBrief "Prefile on a Network" entry at `portal.sayintentions.ai/simbrief/prefile.html?username=…` (<https://forum.navigraph.com/t/sayintentions-ai-how-do-we-get-added-to-the-list-of-prefile-networks/14976>). **Unverified** whether it shipped; irrelevant to OPC either way.

## Feasible integration: SimBrief-mediated

```
pilot ──plans in──▶ SimBrief ◀──reads latest plan── SI client   (pilot saved SimBrief username/ID in SI portal)
                       ▲
                       └──reads latest plan── OPC server (POST /jobs/import-simbrief) ──▶ pending job ──accept──▶ fly ──▶ telemetry (bridge)
```

1. The pilot has one SimBrief account and sets it in both places: the OPC job board's import form and the SI Pilot Portal.
2. The pilot generates a plan in SimBrief. Both products read that **latest** plan: SI for ATC, clearance, callsign and equipment; OPC for origin, destination, aircraft type, load, fuel and route.
3. Import into OPC, accept, fly. SI provides the ATC; OPC's own verification (bridge telemetry → [telemetry-api.md](telemetry-api.md)) pays the flight. SI is not involved in payment and not trusted for it.

Nothing to build on the server for this; it works today. Caveats:

- **Identifier mismatch.** SI's portal accepts a SimBrief username *or* User ID; OPC's importer accepts only the username (F3 in simbrief.md). A pilot who gave SI only their User ID must look up their username for OPC.
- **"Latest" is shared state.** If the pilot generates another plan after importing, SI follows the new plan while the OPC job keeps the old one. OPC then rejects a flight whose airports or aircraft differ from the job (check 1 and 2 in the telemetry contract).
- **Board jobs have no SimBrief plan.** A pilot who wants SI's IFR service on a board job must plan the same airports in SimBrief themselves. Importing that plan would create a *second*, separate job; they should accept the board job and not import.
- **Optional convenience, not implemented at `94f807c`** (web client only, no server change): an "Open in SimBrief" link on a job, using SimBrief's documented dispatch redirect, `https://dispatch.simbrief.com/options/custom?type=A320&orig=LFPG&dest=EGLL&pax=150` (parameters `type`, `orig`, `dest`, `route`, `pax`, … per <https://forum.navigraph.com/t/dispatch-redirect-guide/5299>; the user must be logged in). Limits: the URL answers 200, but `dispatch.simbrief.com` is a single-page app, so that proves nothing about the parameters; I could not confirm the form pre-fills because that needs a login. The unit of the `cargo` parameter is **unverified**, so do not send it. SimBrief lists 208 aircraft types (<https://www.simbrief.com/api/inputs.list.json>, fetched 2026-11-05); only 184 of OPC's 2 561 designators are in that list, and 11 of the 70 curated types are not (C150, C152, C206, P28A, PA46, SR20, R44, R22, EC35, B06, H500). Show the link only for types in the list.
- **Optional read-only cross-check, not planned**: the OPC bridge (`sim/bridge`, separate work) could read `localhost:43117/flightJSON` to show which route SI thinks is active. If it ever does, it must read only the fields it needs and discard `Email` and `api_key` at once (see below).

## SAPI from the OPC server: not recommended

- No endpoint serves OPC's purpose (see Verdict).
- A **distribution** developer key needs SI's approval, and a personal key works only for its owner. OPC is open source (AGPL): a key committed to the repo breaks SI's rule, and a server holding one key for all users needs SI's blessing first.
- It would make every OPC server a custodian of its users' SI `api_key`, with the security duties SI assigns to the integrator.
- The API is in preview and "may change", and excludes demo users.

If someone later wants in-cockpit flavour (for example `sayAs` to have the co-pilot announce "job accepted"), do it **client-side in the bridge**, with the pilot's own personal developer key and `api_key` stored only on their PC, and never send either to an OPC server. Not planned.

## What we do NOT do

- **No scraping or reverse engineering of SI.** SI's terms (§11) end the account of anyone who reverse engineers, decompiles or disassembles the service (<https://www.sayintentions.ai/terms>). Only documented endpoints, nothing found by inspecting the app or portal.
- **No SI developer key in this repository, ever**, and no shared server-side key.
- **No storage, logging or forwarding of an SI `api_key` or `Email`** by any OPC server. The `flight.json` HTTP endpoint is unauthenticated and CORS-open on the user's LAN; that is SI's design, but OPC must not widen it.
- **No pushing of plans or jobs into SI.** There is no documented way, so we do not guess one.
- **No use of the Active Flights API.** It exposes other pilots' flights and has no role in a career game.
- **No `simAPI_input.json` or `simAPI_output.jsonl` writer.** MSFS is natively supported by SI; we are not a simulator adapter.
- **No VA-Link (`importVAData`)** unless SI explicitly approves OPC as an integration. We are not an airline and SI says it does not host or run any.
- **No dependence on SDKs or webhooks.** A Sept 2025 SI blog post advertises "SDK Libraries" and "Webhook Support" (<https://www.sayintentions.ai/blog/sayintentionsai-developer-api-toolkit-is-here-and-traffic-just-got-another-major-upgrade>). The SAPI docs I fetched mention neither (0 occurrences of "webhook" or "SDK"). Treat them as **unverified** until documented.
- **No payment decision based on SI data.** Money moves only on OPC's own telemetry checks.
- **No polling of SimBrief** from this flow (see F4 in [simbrief.md](simbrief.md)).

## Unverified or open

1. Whether SI fetches the SimBrief plan at "New Flight" or continuously. Inferred from one KB troubleshooting step.
2. Which SimBrief fields SI uses beyond callsign, type, equipment/PBN, `SEL/` and VA ICAO code.
3. Whether SI's SimBrief prefile page shipped.
4. Whether the SimBrief dispatch link pre-fills the form for a logged-in user, and the unit of `cargo`.
5. SAPI pricing and stability after "PREVIEW"; whether SI would grant OPC a distribution or partner key (ask on SI's Discord, <https://sayintentions.ai/discord>; developer questions: `#developer-support`, per <https://kb.sayintentions.ai/article/developer-support>).
6. The webhooks and SDKs from the blog post.
7. Whether SI's reading of a SimBrief username has the same character rules as OPC's `^[A-Za-z0-9._ -]{1,64}$` filter. A name SI accepts could still be rejected by OPC (see F3 in simbrief.md).

## Sources

Fetched 2026-11-05. The KB (`kb.sayintentions.ai`) renders through JavaScript; I read articles via its own JSON endpoint `https://kb.sayintentions.ai/api/kb/articles/<slug>` (the one its page script calls), or in a browser.

SI:
- <https://p2.sayintentions.ai/p2/docs/> (full HTML; the `p2d` mirror at <https://p2d.sayintentions.ai/p2d/docs> has the same API content but a different developer-key procedure: it says to email support@sayintentions.ai, the `p2` page says to use the Pilot Portal form. I followed `p2`, which is the page the KB links to)
- <https://kb.sayintentions.ai/developer-integrations> (article list)
- <https://kb.sayintentions.ai/article/full-documentation-of-our-api-sapi-and-flight-json>
- <https://kb.sayintentions.ai/article/getting-a-partner-api-key>
- <https://kb.sayintentions.ai/article/va-link-virtual-airline-integration-api>
- <https://kb.sayintentions.ai/article/active-flights-api>
- <https://kb.sayintentions.ai/article/developer-support>
- <https://kb.sayintentions.ai/article/simapi-integrate-with-any-flight-simulator>
- <https://kb.sayintentions.ai/article/pilot-portal-settings-explained>
- <https://kb.sayintentions.ai/article/why-am-i-getting-the-message-before-you-can-fly-ifr-you-ll-need-to-have-your-simbrief-username-setup-and-you-ll-need-to-file-your-ifr-flight-plan-on-simbrief>
- <https://kb.sayintentions.ai/article/aircraft-equipment-on-your-ifr-flight-plan>
- <https://kb.sayintentions.ai/article/aircraft-identity-settings>
- <https://kb.sayintentions.ai/article/feature-comparison-by-flight-simulator-and-product-line>
- <https://www.sayintentions.ai/blog/sayintentionsai-developer-api-toolkit-is-here-and-traffic-just-got-another-major-upgrade>
- <https://www.sayintentions.ai/terms>

Third party:
- <https://forum.navigraph.com/t/sayintentions-ai-how-do-we-get-added-to-the-list-of-prefile-networks/14976> (SI developer and SimBrief staff, 2024)
- <https://forum.navigraph.com/t/dispatch-redirect-guide/5299> (SimBrief dispatch URL parameters)
- <https://www.simbrief.com/api/inputs.list.json> (supported aircraft types)
- <https://dispatch.simbrief.com/options/custom?orig=LFPG&dest=EGLL&type=A320> (HTTP status only)
- <https://forums.flightsimulator.com/t/sayintentions-ai-atc-master-thread/623726?page=14> (a user post saying IFR plans come from SimBrief; **not** an official source, used only as a cross-check)
