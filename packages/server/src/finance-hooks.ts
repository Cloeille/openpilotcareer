// Seams between lot FINANCE and lot START. Lot START replaces the bodies of these three functions (the signatures stay).
import type { Db } from './db.ts';

/** Whether wear and failures apply to this company (realism toggle `wearAndFailures`). Until lot START merges: always. */
export function wearEnabled(_db: Db, _companyId: number): boolean {
  return true;
}

/** Called at the end of each monthly billing run: lot START clears a negative balance once per season (toggle `bankruptcyBailout`). */
export function applyBailout(_db: Db, _companyId: number, _at: number): void {
  // no-op until lot START merges
}

/** The company's start mode (lot START column `companies.start_mode`). Until lot START merges: unknown. */
export function startModeOf(_db: Db, _companyId: number): 'airliner' | 'hardcore' | null {
  return null;
}
