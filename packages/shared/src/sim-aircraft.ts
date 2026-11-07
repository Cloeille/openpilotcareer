// Lot SIM-AIRCRAFT: the aircraft a player's simulator really has installed, as scanned by the bridge (docs/sim-aircraft.md).
// The list only decides what the buy and lease screens offer. It is client input and never prices anything:
// money always comes from the server catalogue (aircraftPrice of the catalogue type, or the category fallback for an unknown designator).
// Runtime-imports nothing from ./index.ts (index re-exports this file): type imports only, so there is no module cycle.
import { z } from 'zod';
import type { AircraftType } from './index.ts';

/** Bound of one scan. Chloé's MSFS 2024 holds ~3 700 aircraft.cfg in Community alone, almost all liveries and AI traffic: one entry per model stays far below this. */
export const SIM_AIRCRAFT_MAX = 2000;
export const SIM_AIRCRAFT_SOURCES = ['official', 'community'] as const;
export type SimAircraftSource = (typeof SIM_AIRCRAFT_SOURCES)[number];

const title = z.string().trim().min(1).max(200);

/** One aircraft model of the simulator (its liveries are folded into `liveries`). `title` is a real SimObject title: it is the identity of the entry. */
export const simAircraftEntrySchema = z.object({
  title,
  /** ICAO type designator from aircraft.cfg, or null when the bridge could not tell: the server then tries to match the title against its catalogue. */
  icao: z.string().regex(/^[A-Z0-9]{2,4}$/, 'ICAO type designator: 2-4 chars A-Z/0-9').nullable(),
  manufacturer: z.string().trim().max(80),
  model: z.string().trim().max(80),
  source: z.enum(SIM_AIRCRAFT_SOURCES),
  liveries: z.int().min(0).max(100_000),
});
export type SimAircraftEntry = z.infer<typeof simAircraftEntrySchema>;

/** PUT /api/v1/me/sim-aircraft (API key): replaces the whole list. */
export const simAircraftPutSchema = z.object({
  aircraft: z.array(simAircraftEntrySchema).max(SIM_AIRCRAFT_MAX)
    .refine((a) => new Set(a.map((x) => x.title)).size === a.length, { message: 'titles must be unique' }),
});

/** PATCH /api/v1/me/sim-aircraft (session): hide an aircraft from the buy and lease screens, or show it again. */
export const simAircraftHideSchema = z.object({ title, hidden: z.boolean() });

/** What a PUT answers. */
export type SimAircraftSaved = { count: number; scannedAt: number };

/** `icao` is the resolved designator: the one the bridge read, else the catalogue type whose name the title contains, else null (cannot be bought). */
export type SimAircraftView = Omit<SimAircraftEntry, 'icao'> & { icao: string | null; hidden: boolean };

/** GET /api/v1/me/sim-aircraft. `types` holds the catalogue type of each distinct resolved `icao` (derived: true when the catalogue only has a category estimate). */
export type SimAircraftList = { scannedAt: number | null; aircraft: SimAircraftView[]; types: AircraftType[] };
