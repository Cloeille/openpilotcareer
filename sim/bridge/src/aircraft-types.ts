// Catalogue lookup for the bridge: the same data/aircraft-types.json the server uses, so a type's performance agrees on both sides.
// The JSON is imported, not read from disk, so the single-file Windows build carries it inside the exe (like airports.json).
import { resolveCatalogEntry, type AircraftType, type CatalogEntry } from '@opc/shared';
import typesFile from '../../../data/aircraft-types.json' with { type: 'json' };

const types = new Map((typesFile as CatalogEntry[]).map((e) => [e.icao, resolveCatalogEntry(e)] as const));

/** Cruise speed of a catalogue type; null for a designator the catalogue does not list. */
export const cruiseKtsOf = (icao: string | null | undefined): number | null => (icao ? (types.get(icao.toUpperCase()) as AircraftType | undefined)?.cruiseKts ?? null : null);
