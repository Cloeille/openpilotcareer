// `opc-bridge scan-aircraft` and the once-per-session scan of auto mode: SimConnect's list of titles + the aircraft.cfg files of Community, folded into
// one entry per model (aircraft-cfg.ts) and PUT to the server (docs/sim-aircraft.md).
import { SIM_AIRCRAFT_MAX, type SimAircraftEntry } from '@opc/shared';
import { buildSimAircraft, indexCfgs, type Listing, type ScanResult } from './aircraft-cfg.ts';
import { installedPackagesPath, scanCommunity } from './aircraft-scan.ts';
import type { ServerClient } from './client.ts';

export type Scanned = ScanResult & { cfgs: number; packagesPath: string | null };

/** Reads the install (read-only) and builds the entries. `packagesPath` null: no UserCfg.opt found, so every title counts as official and no cfg is consulted. */
export function scanInstall(listing: Listing[], packagesPath: string | null = installedPackagesPath()): Scanned {
  const cfgs = packagesPath ? scanCommunity(packagesPath) : [];
  return { ...buildSimAircraft(listing, indexCfgs(cfgs), SIM_AIRCRAFT_MAX), cfgs: cfgs.length, packagesPath };
}

export const describe = (s: Scanned): string =>
  `${s.entries.length} aircraft (${s.entries.filter((e) => e.source === 'official').length} official, ${s.entries.filter((e) => e.source === 'community').length} community) from ${s.stats.listed} listed rows, ${s.stats.dropped} dropped as not flyable`
  + (s.packagesPath ? `, ${s.cfgs} aircraft.cfg read in ${s.packagesPath}` : ', UserCfg.opt not found: no cfg read')
  + (s.stats.cut > 0 ? `, ${s.stats.cut} over the ${SIM_AIRCRAFT_MAX} limit left out` : '');

/** Scan and send. The server replaces its list: an empty scan is never sent (it would erase a good list because the simulator was still loading). */
export async function reportAircraft(client: ServerClient, listing: Listing[], log: (line: string) => void): Promise<SimAircraftEntry[]> {
  const scanned = scanInstall(listing);
  log(describe(scanned));
  if (scanned.entries.length === 0) throw new Error('no aircraft found: the list on the server is left as it was');
  const saved = await client.putSimAircraft(scanned.entries);
  log(`server now holds ${saved.count} aircraft for your simulator`);
  return scanned.entries;
}
