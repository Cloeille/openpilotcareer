# Data licences

OpenPilotCareer's code is under the GNU AGPL-3.0 (see `LICENSE`). The datasets in `data/` are third-party and keep their own terms. `data/build.py` regenerates them from the sources below; the generated JSON is committed so the app needs no network access at build or run time.

| File | Source | Licence / terms |
|---|---|---|
| `data/aircraft-types.json` | **FAA Order JO 7360.1K, *Aircraft Type Designators*, Appendix A** (effective 2025-06-12). <https://www.faa.gov/documentLibrary/media/Order/FAA_Order_JO_7360.1K_Aircraft_Type_Designators.pdf> | Work of the US federal government, not subject to copyright in the United States (17 U.S.C. § 105). Only ICAO type designator, manufacturer/model name, class, engine count/type and wake class are extracted. |
| `data/airports.json` | **OurAirports** `airports.csv`, <https://ourairports.com/data/> | Released into the **public domain** by its maintainer ("All data is released to the Public Domain"). Filtered to large/medium/small airports with a 4-letter ICAO code. |
| `data/aircraft-curated.csv` | Hand-written for this project: approximate seats, cargo capacity, cruise speed and range of about 70 common types, rounded from manufacturers' public specifications, plus the add-on Flying Fries Quasar (`QASR`, not in the FAA order), whose figures are read from its MSFS package. | Original work of this project, released under the project licence (GNU AGPL-3.0). Figures are gameplay approximations, **not** certified performance data. |

## What is derived, not sourced

For every type that is not in `aircraft-curated.csv`, seats, cargo capacity, cruise speed and range are **estimates** computed from the type's category, engine count and wake class (`deriveAircraft` in `packages/shared/src/index.ts`) and are flagged `derived: true` in the API. They are gameplay defaults and must not be used for real flight planning or operations.

## Not included

- No SimBrief data is stored in the repository. The server fetches a player's own latest flight plan on request through SimBrief's public fetcher API, <https://www.simbrief.com/api/xml.fetcher.php>, and keeps only origin, destination, aircraft ICAO, payload, planned fuel and route. Use is subject to SimBrief's terms.
- No data, names, logos or code from Pilops or any other commercial product.

## Regenerating

```sh
python3 -m venv .venv && .venv/bin/pip install pypdf
.venv/bin/python data/build.py     # downloads both sources; rewrites the two JSON files
```
