# Simulator aircraft (lot SIMAC)

The aircraft MSFS can really fly are what the buy and lease screens offer ("Mes avions du simulateur"). The bridge scans, the server stores the list per user, the web filters.

## Bridge: `opc-bridge scan-aircraft` (also once per simulator session in auto mode)

1. **SimConnect** `SimConnect_EnumerateSimObjectsAndLiveries` for airplanes and helicopters (node-simconnect `enumerateSimObjectsAndLiveries`, protocol `SunRise` = MSFS 2024). It returns every spawnable title with its liveries, official and add-on: the default aircraft are `.fsarchive` files that no program can read, so a file scan alone would miss all of them. URLs are in the header of `sim/bridge/src/simconnect.ts`. It needs the sim running and a desktop session (a scheduled task with `/IT` from SSH).
2. **aircraft.cfg** of `Community` and `Community2024` under `InstalledPackagesPath` (read from `%APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt`): `SimObjects\Airplanes` and `SimObjects\Rotorcraft` only. Legacy (`aircraft.cfg`), livery packages (`[VARIATION] base_container`) and modular aircraft (`common\config` + `presets\*\*\config`) are read. Read-only.
3. **Not an aircraft** (`isFlyable`, `sim/bridge/src/aircraft-cfg.ts`): `isUserSelectable = 0`; `isAirTraffic = 1` without an explicit `isUserSelectable = 1`; `icao_generic = 1`; no engine (`icao_engine_count = 0`, `icao_engine_type = None`); `Category` other than airplane/helicopter. The ICAO and engine fields alone prove nothing: a jet bridge helper declares `B772` and two jet engines.
4. **One entry per model**: `{ title, icao, manufacturer, model, source: official | community, liveries }`. A title with a cfg is a model by manufacturer + type + ICAO (liveries fold into it); a title with none is its own `official` model. `title` is the shortest title of the model.
5. `PUT /api/v1/me/sim-aircraft` with the API key. An empty scan is never sent (it would erase a good list).

## Server

- `sim_aircraft` (migration `SCHEMA_SIM_AIRCRAFT`, appended at the end of `MIGRATIONS`), one row per (user, title). A PUT replaces the rows and keeps `hidden` of titles still present.
- `sim_aircraft.icao_override` (migration `SCHEMA_SIM_AIRCRAFT_OVERRIDE`, appended at the end of `MIGRATIONS`): the type the player picked by hand. `icao` stays the scan's value; a PUT rewrites it and keeps `hidden` and `icao_override` of the titles still present. The effective type (`icao` in the GET, `manual: true` when it is the override) is the override, else the scanned one.
- `PUT /me/sim-aircraft` (API key), `GET /me/sim-aircraft` and `PATCH /me/sim-aircraft {title, hidden?, icao?}` (session; at least one of `hidden`, `icao`). `icao` is a curated (non-derived) catalogue type, else 422 `sim_aircraft_type_unknown`; `null` clears it; an unknown title is 404. At most 2 000 entries, 1 MiB body, unique titles, `icao` 2-4 chars A-Z/0-9 or null.
- The designator an entry is bought as: the bridge's when the catalogue knows it; else the catalogue type whose name the title contains; else the bridge's own code (category estimate, shown "estimé"); else none. **Prices are never read from the list**: `GET` returns the catalogue type of each designator and the buy/lease routes price from the catalogue as always.

## Web

- Settings › "Avions du simulateur": the list, last scan, counts, a "Sans type (N)" filter, per-aircraft hide/show, a type picker (search over the curated catalogue types) on each untyped row and a "manuel" badge with a clear button on the types picked by hand, the "scan again" hint (`opc-bridge scan-aircraft`).
- Catalogue (buy and lease start here): filter "Mes avions du simulateur", on by default when the list has an offer; each type shows its simulator titles; estimated types carry the "≈ estimé" badge.
