import { AIRCRAFT_CATEGORIES, aircraftPrice, type AircraftCategory, type AircraftType, type FleetAircraft } from '@opc/shared';

/** The category tabs of the catalogue; every aircraft category belongs to one group, `other` only shows under "all". */
export const GROUPS = ['all', 'piston', 'turboprop', 'jet', 'helicopter'] as const;
export type Group = (typeof GROUPS)[number];

export function groupOf(c: AircraftCategory): Exclude<Group, 'all'> | null {
  if (c.startsWith('piston')) return 'piston';
  if (c.startsWith('turboprop')) return 'turboprop';
  if (c.startsWith('jet') || c === 'spaceplane') return 'jet';
  if (c === 'helicopter') return 'helicopter';
  return null;
}

export const inGroup = (t: Pick<AircraftType, 'category'>, g: Group): boolean => g === 'all' || groupOf(t.category) === g;

/** Next group in the tab row, wrapping around. */
export const stepGroup = (g: Group, dir: 1 | -1): Group => GROUPS[(GROUPS.indexOf(g) + dir + GROUPS.length) % GROUPS.length]!;

/** What buying `type` does to the balance. `coverage` is the share of the price the balance covers (0..1). */
export function quote(type: AircraftType, balance: number): { price: number; balanceAfter: number; missing: number; coverage: number; affordable: boolean } {
  const price = aircraftPrice(type);
  return { price, balanceAfter: balance - price, missing: Math.max(0, price - balance), coverage: price === 0 ? 1 : Math.min(1, Math.max(0, balance / price)), affordable: price <= balance };
}

/** A string that can be sent as an aircraft type designator (the server accepts any 2-4 character code and falls back to category defaults). */
export const isIcaoType = (s: string): boolean => /^[A-Z0-9]{2,4}$/.test(s.trim().toUpperCase());
export const isIcaoAirport = (s: string): boolean => /^[A-Z]{4}$/.test(s.trim().toUpperCase());

export function fleetSummary(fleet: Pick<FleetAircraft, 'busy'>[]): { total: number; available: number } {
  return { total: fleet.length, available: fleet.filter((a) => !a.busy).length };
}

export const CATEGORY_KEYS = AIRCRAFT_CATEGORIES;
