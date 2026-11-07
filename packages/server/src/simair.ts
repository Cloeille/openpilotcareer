// Lot SIM-AIRCRAFT: store and read the aircraft models a player's simulator has (scanned by the bridge, shared/src/sim-aircraft.ts).
// The list decides what the buy and lease screens offer; prices never come from it (catalogType does the pricing, as for any other type).
import type { AircraftType, SimAircraftEntry, SimAircraftList, SimAircraftPatch, SimAircraftView } from '@opc/shared';
import { aircraftTypes, catalogType } from './catalog.ts';
import { all, get, run, tx, type Db } from './db.ts';
import { HttpError } from './http.ts';

type Row = { title: string; icao: string | null; manufacturer: string; model: string; source: 'official' | 'community'; liveries: number; hidden: number; icao_override: string | null; scanned_at: number };

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Catalogue names a title can be matched against, longest first (the most specific type wins): the full name ("Airbus A330-200") and, when it holds a digit, the name without
 *  its first word ("A330-200": the default aircraft are titled "A330-200 (GE)"; without the digit "Pietenpol Aerial" would match every "Aerial Advertising"). Under 5 characters they match too much. */
const NAMES = [...aircraftTypes.values()]
  .flatMap((t) => { const rest = t.name.split(' ').slice(1).join(' '); return [[norm(t.name), t.icao] as const, ...(/\d/.test(rest) ? [[norm(rest), t.icao] as const] : [])]; })
  .filter(([n]) => n.length >= 5).sort((a, b) => b[0].length - a[0].length);

/** Catalogue designators of 4 characters with a digit, longest first: the default aircraft are named after them ("C172SP G1000 Passengers", "C208B Cargo", "A321"). */
const CODES = [...aircraftTypes.keys()].filter((c) => c.length === 4 && /\d/.test(c) && /^[A-Z]/.test(c));

/** The catalogue type for a title: the designator a word of the title starts with (C172SP -> C172); else the type whose catalogue name the title (or "manufacturer model") contains. Null when neither applies. The match is a suggestion for what to offer, never a price. */
export function matchByName(e: Pick<SimAircraftEntry, 'title' | 'manufacturer' | 'model'>): string | null {
  for (const word of e.title.toUpperCase().split(/[^A-Z0-9]+/)) {
    const code = CODES.find((c) => word.startsWith(c) && (word.length === c.length || /^[A-Z]{1,2}$/.test(word.slice(c.length))));
    if (code) return code;
  }
  for (const text of [norm(e.title), norm(`${e.manufacturer} ${e.model}`)]) {
    const hit = NAMES.find(([n]) => text.includes(n));
    if (hit) return hit[1];
  }
  return null;
}

/** The designator an entry is bought as: the bridge's when the catalogue knows it; else a catalogue type the title names (a better estimate than the category fallback
 *  of an unknown code); else the bridge's own code (priced by the category fallback, shown as estimated); else null. */
export const resolveIcao = (e: SimAircraftEntry): string | null => (e.icao && aircraftTypes.has(e.icao) ? e.icao : (matchByName(e) ?? e.icao));

/** A PUT replaces the player's rows but keeps what the player decided about the titles still there: `hidden` and `icao_override`. */
export function saveSimAircraft(db: Db, userId: number, list: SimAircraftEntry[], now: number): { count: number; scannedAt: number } {
  tx(db, () => {
    const kept = new Map(all<Pick<Row, 'title' | 'hidden' | 'icao_override'>>(db, 'SELECT title, hidden, icao_override FROM sim_aircraft WHERE user_id = ?', userId).map((r) => [r.title.toLowerCase(), r]));
    run(db, 'DELETE FROM sim_aircraft WHERE user_id = ?', userId);
    for (const e of list) {
      const was = kept.get(e.title.toLowerCase());
      run(db, 'INSERT INTO sim_aircraft (user_id, title, icao, icao_override, manufacturer, model, source, liveries, hidden, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        userId, e.title, resolveIcao(e), was?.icao_override ?? null, e.manufacturer, e.model, e.source, e.liveries, was?.hidden ?? 0, now);
    }
  });
  return { count: list.length, scannedAt: now };
}

/** A type the player may pick by hand: a curated catalogue type. Derived ones are category estimates of an FAA code nobody flies in the sim, not an answer to "which aircraft is this". */
const isPickable = (icao: string): boolean => aircraftTypes.get(icao)?.derived === false;

/** Applies the fields of `p` that are present to the player's entry `p.title`. False when the player has no such aircraft; 422 when `p.icao` is not a curated catalogue type. */
export function patchSimAircraft(db: Db, userId: number, p: SimAircraftPatch): boolean {
  if (p.icao && !isPickable(p.icao)) throw new HttpError(422, 'sim_aircraft_type_unknown', `${p.icao} is not a type of the catalogue`);
  return tx(db, () => {
    if (!get(db, 'SELECT 1 FROM sim_aircraft WHERE user_id = ? AND title = ?', userId, p.title)) return false;
    if (p.hidden !== undefined) run(db, 'UPDATE sim_aircraft SET hidden = ? WHERE user_id = ? AND title = ?', p.hidden ? 1 : 0, userId, p.title);
    if (p.icao !== undefined) run(db, 'UPDATE sim_aircraft SET icao_override = ? WHERE user_id = ? AND title = ?', p.icao, userId, p.title);
    return true;
  });
}

export function simAircraftOf(db: Db, userId: number): SimAircraftList {
  const rows = all<Row>(db, 'SELECT * FROM sim_aircraft WHERE user_id = ? ORDER BY title', userId);
  const aircraft: SimAircraftView[] = rows.map((r) => ({ title: r.title, icao: r.icao_override ?? r.icao, manual: r.icao_override !== null, manufacturer: r.manufacturer, model: r.model, source: r.source, liveries: r.liveries, hidden: r.hidden === 1 }));
  const icaos = [...new Set(aircraft.map((a) => a.icao).filter((x): x is string => x !== null))];
  const types: AircraftType[] = icaos.map(catalogType);
  return { scannedAt: get<{ at: number | null }>(db, 'SELECT MAX(scanned_at) AS at FROM sim_aircraft WHERE user_id = ?', userId)?.at ?? null, aircraft, types };
}
