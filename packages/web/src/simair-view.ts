/** Pure logic of the simulator-aircraft screens: what the buy and lease catalogue offers when it is filtered to the player's simulator, and the rows of the settings tab. No DOM, no network. */
import type { AircraftType, SimAircraftList, SimAircraftView } from '@opc/shared';
import { inGroup, type Group } from './catalogue.ts';

/** One career type the player can really fly: the aircraft of their simulator that map to it, shown by their simulator titles. `estimated`: the catalogue only has a category estimate for it. */
export type SimOffer = { type: AircraftType; titles: string[]; estimated: boolean };

/** The types of the list she can buy: visible entries with a designator, one offer per type. A type the company defined itself (`custom`) is the player's own numbers, so it is not an estimate. */
export function offersOf(list: SimAircraftList | null, custom: readonly AircraftType[] = []): SimOffer[] {
  if (!list) return [];
  const byIcao = new Map<string, SimOffer>();
  for (const a of list.aircraft) {
    if (a.hidden || a.icao === null) continue;
    let offer = byIcao.get(a.icao);
    if (!offer) {
      const type = custom.find((c) => c.icao === a.icao) ?? list.types.find((x) => x.icao === a.icao);
      if (!type) continue;
      byIcao.set(a.icao, (offer = { type, titles: [], estimated: type.derived }));
    }
    offer.titles.push(a.title);
  }
  return [...byIcao.values()].sort((x, y) => x.type.name.localeCompare(y.type.name) || x.type.icao.localeCompare(y.type.icao));
}

/** The catalogue's choice: `null` while the player has not chosen. The filter is on by default when there is something to filter by, and never on when it would show nothing. */
export type CatalogueChoice = 'mine' | 'all' | null;
export const filterIsOn = (choice: CatalogueChoice, offers: readonly SimOffer[]): boolean => offers.length > 0 && choice !== 'all';

/** The offers matching what the player typed (type name, designator or a simulator title) and the category tab. */
export function narrow(offers: readonly SimOffer[], query: string, group: Group): SimOffer[] {
  const q = query.trim().toLowerCase();
  return offers.filter((o) => inGroup(o.type, group) && (q === '' || o.type.icao.toLowerCase().includes(q) || o.type.name.toLowerCase().includes(q) || o.titles.some((t) => t.toLowerCase().includes(q))));
}

/** `Cessna 172 Skyhawk (Asobo)` or `... +2` when more than one simulator aircraft maps to the type. */
export const titlesLabel = (titles: readonly string[]): string => (titles.length <= 1 ? (titles[0] ?? '') : `${titles[0]} +${titles.length - 1}`);

/** What the settings tab says about one entry of the list. */
export type RowState = 'offered' | 'hidden' | 'noType';
/** `manual`: the player picked `type` by hand (a rescan keeps it). */
export type SimRow = { title: string; detail: string; source: SimAircraftView['source']; liveries: number; type: AircraftType | null; estimated: boolean; manual: boolean; hidden: boolean; state: RowState };

export function rowsOf(list: SimAircraftList, custom: readonly AircraftType[] = []): SimRow[] {
  return list.aircraft.map((a) => {
    const type = a.icao === null ? null : (custom.find((c) => c.icao === a.icao) ?? list.types.find((x) => x.icao === a.icao) ?? null);
    return {
      title: a.title, detail: [a.manufacturer, a.model].filter((s) => s !== '').join(' '), source: a.source, liveries: a.liveries, type, estimated: type?.derived ?? false, manual: a.manual,
      hidden: a.hidden, state: type === null ? 'noType' : a.hidden ? 'hidden' : 'offered',
    };
  });
}

/** The settings tab's filter: every entry, or only those the player still has to give a type. */
export type RowFilter = 'all' | 'noType';
export const filterRows = (rows: readonly SimRow[], filter: RowFilter): SimRow[] => (filter === 'noType' ? rows.filter((r) => r.state === 'noType') : [...rows]);

export type Summary = { total: number; offered: number; hidden: number; noType: number; official: number; community: number };
export const summaryOf = (rows: readonly SimRow[]): Summary => ({
  total: rows.length, noType: rows.filter((r) => r.state === 'noType').length, offered: rows.filter((r) => r.state === 'offered').length, hidden: rows.filter((r) => r.state === 'hidden').length,
  official: rows.filter((r) => r.source === 'official').length, community: rows.filter((r) => r.source === 'community').length,
});
