// Per-company realism settings, read from the companies table. Low-level on purpose (database + shared only), so game.ts can
// use it while settling a flight without an import cycle. High-level operations live in start.ts.
import { NEUTRAL_REALISM, REALISM_TOGGLES, realismView, type Realism, type RealismPresetId, type RealismSetting, type RealismToggles } from '@opc/shared';
import { get, run, type Db } from './db.ts';

/** Stored JSON -> setting. Missing or malformed data is neutral (no modifier, nothing extra on): a company that predates realism, an AI company. */
export function parseRealism(raw: string | null): RealismSetting {
  if (!raw) return NEUTRAL_REALISM;
  try {
    const v = JSON.parse(raw) as { preset?: unknown; toggles?: Record<string, unknown> };
    const preset = (['relaxed', 'balanced', 'hardcore', 'custom'] as const).includes(v.preset as RealismPresetId) ? (v.preset as RealismPresetId) : 'custom';
    const toggles = Object.fromEntries(REALISM_TOGGLES.map((t) => [t, v.toggles?.[t] === true])) as RealismToggles;
    return { preset, toggles };
  } catch {
    return NEUTRAL_REALISM;
  }
}

export const realismSettingOf = (db: Db, companyId: number): RealismSetting =>
  parseRealism(get<{ realism: string | null }>(db, 'SELECT realism FROM companies WHERE id = ?', companyId)?.realism ?? null);

export const realismOf = (db: Db, companyId: number): Realism => realismView(realismSettingOf(db, companyId));

export const saveRealism = (db: Db, companyId: number, s: RealismSetting): void => {
  run(db, 'UPDATE companies SET realism = ? WHERE id = ?', JSON.stringify(s), companyId);
};

/** Do aircraft of this company wear out? (The `wearAndFailures` toggle. Off for companies that never chose realism.) */
export const wearEnabled = (db: Db, companyId: number): boolean => realismSettingOf(db, companyId).toggles.wearAndFailures;

/** Telemetry flags the company's realism tolerates: with `pauseTolerance` the bridge's `long_pause` does not fail verification. */
export const toleratedFlags = (db: Db, companyId: number): string[] => (realismSettingOf(db, companyId).toggles.pauseTolerance ? ['long_pause'] : []);
