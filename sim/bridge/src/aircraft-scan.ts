// Reads the aircraft.cfg files the simulator's add-on folders hold, so that SimConnect's list of titles can be told apart (docs/sim-aircraft.md).
// The official aircraft of MSFS 2024 are .fsarchive files that no program may read: only Community and Community2024 are walked. Read-only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeModular, readAircraftCfg, type AircraftCfg } from './aircraft-cfg.ts';

/** InstalledPackagesPath of %APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt (the 2020 folder is tried second). Null when MSFS has no UserCfg.opt here. */
export function installedPackagesPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const appData = env.APPDATA;
  if (!appData) return null;
  for (const dir of ['Microsoft Flight Simulator 2024', 'Microsoft Flight Simulator']) {
    const file = join(appData, dir, 'UserCfg.opt');
    if (!existsSync(file)) continue;
    const m = /^\s*InstalledPackagesPath\s+"([^"]+)"/m.exec(readFileSync(file, 'utf8'));
    if (m) return m[1]!;
  }
  return null;
}

const dirs = (p: string): string[] => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
const read = (p: string, folder: string): AircraftCfg | null => { try { return readAircraftCfg(readFileSync(p, 'utf8'), folder); } catch { return null; } };

/** Every aircraft the Community folders define: SimObjects/Airplanes and SimObjects/Rotorcraft only (AirplaneParts, GroundVehicles, Misc, Boats and Landmarks are not aircraft). */
export function scanCommunity(packagesPath: string): AircraftCfg[] {
  const out: AircraftCfg[] = [];
  for (const root of ['Community', 'Community2024']) {
    for (const pkg of dirs(join(packagesPath, root))) {
      for (const kind of ['Airplanes', 'Rotorcraft']) {
        const base = join(packagesPath, root, pkg, 'SimObjects', kind);
        for (const folder of dirs(base)) {
          const dir = join(base, folder);
          const legacy = read(join(dir, 'aircraft.cfg'), folder);
          if (legacy) { out.push(legacy); continue; }
          const common = read(join(dir, 'common', 'config', 'aircraft.cfg'), folder);
          const presets = dirs(join(dir, 'presets')).flatMap((vendor) => dirs(join(dir, 'presets', vendor)).map((p) => read(join(dir, 'presets', vendor, p, 'config', 'aircraft.cfg'), p)));
          if (common || presets.some((p) => p)) out.push(mergeModular(folder, common, presets.filter((p): p is AircraftCfg => p !== null)));
        }
      }
    }
  }
  return out;
}
