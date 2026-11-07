// Lot SIM-AIRCRAFT: store and read the aircraft models a player's simulator has (scanned by the bridge, shared/src/sim-aircraft.ts).
// The list decides what the buy and lease screens offer; prices never come from it (catalogType does the pricing, as for any other type).
import type { AircraftType, SimAircraftEntry, SimAircraftList, SimAircraftView } from '@opc/shared';
import { aircraftTypes, catalogType } from './catalog.ts';
import { all, get, run, tx, type Db } from './db.ts';

type Row = { title: string; icao: string | null; manufacturer: string; model: string; source: 'official' | 'community'; liveries: number; hidden: number; scanned_at: number };

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Catalogue names a title can be matched against, longest first (the most specific type wins). Names under 6 characters ("A-1") match too much. */
const NAMES = [...aircraftTypes.values()].map((t) => [norm(t.name), t.icao] as const).filter(([n]) => n.length >= 6).sort((a, b) => b[0].length - a[0].length);

/** The catalogue type whose name the title (or "manufacturer model") contains, else null. */
export function matchByName(e: Pick<SimAircraftEntry, 'title' | 'manufacturer' | 'model'>): string | null {
  for (const text of [norm(e.title), norm(`${e.manufacturer} ${e.model}`)]) {
    const hit = NAMES.find(([n]) => text.includes(n));
    if (hit) return hit[1];
  }
  return null;
}

/** The designator an entry is bought as: the bridge's when the catalogue knows it; else a catalogue type the title names (a better estimate than the category fallback
 *  of an unknown code); else the bridge's own code (priced by the category fallback, shown as estimated); else null. */
export const resolveIcao = (e: SimAircraftEntry): string | null => (e.icao && aircraftTypes.has(e.icao) ? e.icao : (matchByName(e) ?? e.icao));

export function saveSimAircraft(db: Db, userId: number, list: SimAircraftEntry[], now: number): { count: number; scannedAt: number } {
  tx(db, () => {
    const hidden = new Set(all<{ title: string }>(db, 'SELECT title FROM sim_aircraft WHERE user_id = ? AND hidden = 1', userId).map((r) => r.title.toLowerCase()));
    run(db, 'DELETE FROM sim_aircraft WHERE user_id = ?', userId);
    for (const e of list) {
      run(db, 'INSERT INTO sim_aircraft (user_id, title, icao, manufacturer, model, source, liveries, hidden, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        userId, e.title, resolveIcao(e), e.manufacturer, e.model, e.source, e.liveries, hidden.has(e.title.toLowerCase()) ? 1 : 0, now);
    }
  });
  return { count: list.length, scannedAt: now };
}

/** False when the player has no such aircraft. */
export const setSimAircraftHidden = (db: Db, userId: number, title: string, hidden: boolean): boolean =>
  run(db, 'UPDATE sim_aircraft SET hidden = ? WHERE user_id = ? AND title = ?', hidden ? 1 : 0, userId, title).changes > 0;

export function simAircraftOf(db: Db, userId: number): SimAircraftList {
  const rows = all<Row>(db, 'SELECT * FROM sim_aircraft WHERE user_id = ? ORDER BY title', userId);
  const aircraft: SimAircraftView[] = rows.map((r) => ({ title: r.title, icao: r.icao, manufacturer: r.manufacturer, model: r.model, source: r.source, liveries: r.liveries, hidden: r.hidden === 1 }));
  const icaos = [...new Set(aircraft.map((a) => a.icao).filter((x): x is string => x !== null))];
  const types: AircraftType[] = icaos.map(catalogType);
  return { scannedAt: get<{ at: number | null }>(db, 'SELECT MAX(scanned_at) AS at FROM sim_aircraft WHERE user_id = ?', userId)?.at ?? null, aircraft, types };
}
