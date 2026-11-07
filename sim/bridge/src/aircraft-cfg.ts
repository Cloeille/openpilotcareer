// What the bridge knows about the aircraft installed in MSFS, as a pure core (no file, no SimConnect): parse aircraft.cfg, drop what is not
// an aircraft a pilot can fly, and fold liveries into one entry per model. docs/sim-aircraft.md.
//
// The rule that drops non-aircraft (`isFlyable`), from the MSFS 2024 aircraft.cfg documentation
//   https://docs.flightsimulator.com/msfs2024/flighting/content-configuration/cfg-files/aircraft.cfg/   ([FLTSIM.N]: isUserSelectable, isAirTraffic)
//   https://docs.flightsimulator.com/msfs2024/retail/content-configuration/cfg-files/aircraft-sim/air-traffic/   (icao_generic and AI traffic variations are not user selectable):
//   1. not selectable by the user: `isUserSelectable = 0`, or `isAirTraffic = 1` without an explicit `isUserSelectable = 1` (parked and AI traffic models:
//      jet bridge helpers, FSLTL traffic, generic airliners). An absent `isUserSelectable` means selectable.
//   2. `icao_generic = 1` (generic traffic models);
//   3. no engine: `icao_engine_count = 0` or `icao_engine_type = None` (gliders, balloons, static objects);
//   4. `Category` present and not airplane / helicopter.
// A jet bridge helper declares `icao_type_designator = "B772"` and two jet engines; only rule 1 catches it, which is why the ICAO and engine fields alone prove nothing.
// Titles with no cfg to read (the official aircraft are archived): `PassiveAircraft` in the title marks the parked / static copies Asobo ships for airports (measured: 274 of
// the 447 official titles of MSFS 2024); they are not user selectable either (rule 1), so they are dropped by title.
// Anything that is not under SimObjects/Airplanes or SimObjects/Rotorcraft (AirplaneParts, GroundVehicles, Misc, Boats, Landmarks) never reaches this file: see aircraft-scan.ts.
import type { SimAircraftEntry } from '@opc/shared';
import { simAircraftEntrySchema } from '@opc/shared';

export type CfgSection = { name: string; values: Record<string, string> };

/** Sections in file order, names and keys lower-cased. Values lose their quotes and any `; comment`; a `;` inside quotes stays. A repeated key keeps its last value. */
export function parseCfg(text: string): CfgSection[] {
  const sections: CfgSection[] = [];
  let current: CfgSection | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[([^\]]+)\]/.exec(line);
    if (head) { sections.push((current = { name: head[1]!.trim().toLowerCase(), values: {} })); continue; }
    const eq = line.indexOf('=');
    if (!current || eq < 1 || line.startsWith(';') || line.startsWith('//')) continue;
    current.values[line.slice(0, eq).trim().toLowerCase()] = value(line.slice(eq + 1));
  }
  return sections;
}

function value(rest: string): string {
  const s = rest.trim();
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    return end < 0 ? s.slice(1) : s.slice(1, end);
  }
  const semi = s.indexOf(';');
  return (semi < 0 ? s : s.slice(0, semi)).trim();
}

/** One aircraft.cfg: its [GENERAL] values, its `[VARIATION] base_container` folder (liveries only) and its [FLTSIM.N] sections in order. */
export type AircraftCfg = { folder: string; general: Record<string, string>; baseFolder: string | null; variations: Record<string, string>[] };

export function readAircraftCfg(text: string, folder: string): AircraftCfg {
  const sections = parseCfg(text);
  const base = sections.find((s) => s.name === 'variation')?.values.base_container;
  return {
    folder,
    general: sections.find((s) => s.name === 'general')?.values ?? {},
    baseFolder: base ? (base.split(/[\\/]/).filter((p) => p !== '' && p !== '..').pop() ?? null) : null,
    variations: sections.filter((s) => /^fltsim\.\d+$/.test(s.name)).map((s) => s.values),
  };
}

/** A modular SimObject (FlyByWire, PMDG 777, Fenix...) has no top-level aircraft.cfg: [GENERAL] and often a first [FLTSIM.0] sit in common/config/aircraft.cfg, the other titles in presets/<vendor>/<preset>/config/aircraft.cfg. */
export function mergeModular(folder: string, common: AircraftCfg | null, presets: AircraftCfg[]): AircraftCfg {
  return { folder, general: common?.general ?? {}, baseFolder: null, variations: [...(common?.variations ?? []), ...presets.flatMap((p) => p.variations)] };
}

/** One SimObject title as the cfg files describe it, with a livery package's missing values taken from its base container. */
export type CfgRecord = {
  title: string; folder: string; manufacturer: string; model: string; icao: string | null;
  category: string | null; engineType: string | null; engineCount: number | null; generic: boolean;
  userSelectable: boolean | undefined; airTraffic: boolean | undefined;
};

const flag = (v: string | undefined): boolean | undefined => (v === undefined ? undefined : v === '1' || v.toLowerCase() === 'true');
const designator = (v: string | undefined): string | null => { const s = v?.trim().toUpperCase() ?? ''; return /^[A-Z0-9]{2,4}$/.test(s) ? s : null; };
/** MSFS fills an untranslated manufacturer or type with its localisation key (`TT:AIRCRAFT.UI_MANUFACTURER`): that is no name. */
const plain = (s: string): string => (s.startsWith('TT:') ? '' : s);
const PASSIVE = /passiveaircraft/i;
export const normTitle = (s: string): string => s.trim().toLowerCase();

/** Every titled variation of every cfg, by lower-cased title. The first cfg to declare a title wins (MSFS would do the same with a duplicate). */
export function indexCfgs(cfgs: AircraftCfg[]): Map<string, CfgRecord> {
  const byFolder = new Map<string, AircraftCfg>();
  for (const c of cfgs) if (!byFolder.has(c.folder.toLowerCase())) byFolder.set(c.folder.toLowerCase(), c);
  const index = new Map<string, CfgRecord>();
  for (const c of cfgs) {
    const base = c.baseFolder ? byFolder.get(c.baseFolder.toLowerCase()) : undefined;
    const g = { ...base?.general, ...c.general };
    const baseUi = base?.variations.find((v) => v.ui_type || v.ui_manufacturer);
    for (const v of c.variations) {
      const title = v.title?.trim();
      if (!title || index.has(normTitle(title))) continue;
      const count = Number(g.icao_engine_count);
      index.set(normTitle(title), {
        title, folder: c.baseFolder ?? c.folder,
        manufacturer: plain((v.ui_manufacturer ?? baseUi?.ui_manufacturer ?? g.icao_manufacturer ?? '').trim()),
        model: plain((v.ui_type ?? baseUi?.ui_type ?? g.icao_model ?? '').trim()),
        icao: designator(g.icao_type_designator),
        category: g.category?.trim().toLowerCase() || null,
        engineType: g.icao_engine_type?.trim().toLowerCase() || null,
        engineCount: g.icao_engine_count === undefined || !Number.isFinite(count) ? null : count,
        generic: flag(g.icao_generic) === true,
        userSelectable: flag(v.isuserselectable) ?? flag(baseUi?.isuserselectable),
        airTraffic: flag(v.isairtraffic) ?? flag(baseUi?.isairtraffic),
      });
    }
  }
  return index;
}

/** The documented rule at the top of this file. */
export function isFlyable(r: CfgRecord): boolean {
  if (r.category !== null && r.category !== 'airplane' && r.category !== 'helicopter') return false;
  if (r.generic || r.engineCount === 0 || r.engineType === 'none') return false;
  return r.userSelectable ?? r.airTraffic !== true;
}

/** One row of SimConnect's list: a SimObject title and one of its liveries ('' for a legacy aircraft whose liveries are titles of their own). */
export type Listing = { title: string; livery: string };

export type ScanResult = { entries: SimAircraftEntry[]; stats: { listed: number; dropped: number; invalid: number; cut: number } };

/**
 * One entry per aircraft model. `listing` is everything the simulator offers (official and community); `index` what the Community cfg files say about
 * their titles. A title with a cfg is a model identified by manufacturer, type and ICAO (a legacy livery is a title of its own and joins its model);
 * a title without one (the default aircraft are only .fsarchive files) is its own model, `official`. The entry is named by the shortest title of its
 * model (the base name, without the livery's suffix); `liveries` counts the listing rows folded into it.
 */
export function buildSimAircraft(listing: Listing[], index: Map<string, CfgRecord>, max: number): ScanResult {
  const models = new Map<string, { titles: string[]; rec: CfgRecord | null; rows: number }>();
  let dropped = 0;
  for (const row of listing) {
    const rec = index.get(normTitle(row.title)) ?? null;
    if ((rec && !isFlyable(rec)) || (!rec && PASSIVE.test(row.title))) { dropped++; continue; }
    const key = rec ? (rec.manufacturer || rec.model ? `${rec.manufacturer}|${rec.model}|${rec.icao ?? ''}`.toLowerCase() : `dir:${rec.folder.toLowerCase()}`) : `title:${normTitle(row.title)}`;
    const m = models.get(key) ?? { titles: [], rec, rows: 0 };
    if (!m.titles.includes(row.title)) m.titles.push(row.title);
    m.rows++;
    models.set(key, m);
  }
  const all = [...models.values()].map((m): SimAircraftEntry => ({
    title: [...m.titles].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!,
    icao: m.rec?.icao ?? null, manufacturer: (m.rec?.manufacturer ?? '').slice(0, 80), model: (m.rec?.model ?? '').slice(0, 80),
    source: m.rec ? 'community' : 'official', liveries: m.rows,
  }));
  const valid = all.filter((e) => simAircraftEntrySchema.safeParse(e).success).sort((a, b) => a.title.localeCompare(b.title));
  return { entries: valid.slice(0, max), stats: { listed: listing.length, dropped, invalid: all.length - valid.length, cut: Math.max(0, valid.length - max) } };
}
