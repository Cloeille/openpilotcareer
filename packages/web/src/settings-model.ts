/** Pure logic of the Settings screens: API-key usage wording, quota, byte sizes, dates, the per-server "last export" memory. No DOM, no network. */
import type { Lang } from './i18n.ts';

/** The server refuses an 11th key (409 limit_reached); the mockup counts "N sur 10". */
export const MAX_API_KEYS = 10;
/** A key whose last use is this recent counts as "in use right now" (the bridge reports every few seconds). */
export const LIVE_WINDOW_MS = 5 * 60_000;
/** After this many days without use a key is called idle, and the idle time is shown in months. */
export const IDLE_AFTER_DAYS = 60;
const DAY_MS = 86_400_000;
const NBSP = '\u00a0';

export type KeyUsage =
  | { kind: 'never' }
  | { kind: 'live' }
  | { kind: 'on'; at: number }
  | { kind: 'idle'; months: number };

/** How to describe the last use of an API key: never, right now, on a date, or idle for N months. */
export function keyUsage(lastUsedAt: number | null, now: number): KeyUsage {
  if (lastUsedAt === null) return { kind: 'never' };
  const age = now - lastUsedAt;
  if (age <= LIVE_WINDOW_MS) return { kind: 'live' };
  const days = Math.floor(age / DAY_MS);
  if (days >= IDLE_AFTER_DAYS) return { kind: 'idle', months: Math.floor(days / 30) };
  return { kind: 'on', at: lastUsedAt };
}

/** Keys the account may still create. */
export const keysLeft = (count: number): number => Math.max(0, MAX_API_KEYS - count);

/** A key created in the last minute is "Créée à l'instant". */
export const isJustCreated = (createdAt: number, now: number): boolean => now - createdAt < 60_000;

const LOCALE: Record<Lang, string> = { en: 'en-GB', fr: 'fr-FR' };
/** `21/10/2026`, in UTC like every date of the app. */
export const numericDate = (ms: number, lang: Lang): string =>
  new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms);

/** File size the way the mockup writes it: `86 Ko`, `4,2 Mo` (French), `86 kB`, `4.2 MB` (English). Decimal units. */
export function formatBytes(bytes: number, lang: Lang): string {
  const units = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go'] : ['B', 'kB', 'MB', 'GB'];
  let value = Math.max(0, bytes);
  let i = 0;
  while (value >= 1000 && i < units.length - 1) { value /= 1000; i += 1; }
  const digits = i === 0 || value >= 100 ? 0 : 1;
  const text = value.toLocaleString(LOCALE[lang], { maximumFractionDigits: digits, minimumFractionDigits: digits === 1 && value % 1 === 0 ? 0 : digits });
  return `${text}${NBSP}${units[i]}`;
}

/** A list of names in the player's language: `A, B et C` / `A, B and C`. */
export const listOf = (names: string[], lang: Lang): string => new Intl.ListFormat(LOCALE[lang], { style: 'long', type: 'conjunction' }).format(names);

/** Every item of a paged list (newest first, ids descending), up to `maxPages` pages; `capped` says there may be more. `fetchPage(before)` returns one page. */
export async function pageAll<T extends { id: number }>(fetchPage: (before: number | undefined) => Promise<T[]>, pageSize: number, maxPages: number): Promise<{ items: T[]; capped: boolean }> {
  const items: T[] = [];
  let before: number | undefined;
  for (let i = 0; i < maxPages; i++) {
    const batch = await fetchPage(before);
    items.push(...batch);
    if (batch.length < pageSize) return { items, capped: false };
    before = batch[batch.length - 1]!.id;
  }
  return { items, capped: true };
}

/** How many items a list holds and when its first and last fell, whatever the order. `capped` says the count stopped at a page limit. */
export type Span = { count: number; from: number; to: number; capped: boolean };
export function spanOf(times: number[], capped: boolean, count = times.length): Span | null {
  if (times.length === 0) return null;
  return { count, from: Math.min(...times), to: Math.max(...times), capped };
}

/** The server names its downloads `opc-export.json-2026-11-06`, which no program opens: put the extension last (`opc-export-2026-11-06.json`). Any other name is kept; no header at all gives a plain name. */
export function exportFileName(header: string | null, format: ExportFormat): string {
  const name = /filename="([^"]+)"/.exec(header ?? '')?.[1];
  if (!name) return `opc-${format}`;
  const m = /^opc-(export|flights|transactions)\.(json|csv)-(\d{4}-\d{2}-\d{2})$/.exec(name);
  return m ? `opc-${m[1]}-${m[3]}.${m[2]}` : name;
}

// ------------------------------------------------------------------ last export, remembered per server in this browser

export const EXPORT_FORMATS = ['json', 'flights.csv', 'transactions.csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
/** When the player last exported from this browser, and how large each file was. */
export type LastExport = { at: number; bytes: Partial<Record<ExportFormat, number>> };

const STORE_KEY = 'opc.lastExport';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function readAll(storage: Store): Record<string, LastExport> {
  try {
    const v = JSON.parse(storage.getItem(STORE_KEY) ?? 'null') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, LastExport> = {};
    for (const [server, entry] of Object.entries(v)) {
      const e = entry as { at?: unknown; bytes?: unknown } | null;
      if (!e || typeof e.at !== 'number' || !Number.isFinite(e.at) || !e.bytes || typeof e.bytes !== 'object') continue;
      const bytes: LastExport['bytes'] = {};
      for (const f of EXPORT_FORMATS) {
        const n = (e.bytes as Record<string, unknown>)[f];
        if (typeof n === 'number' && Number.isFinite(n) && n >= 0) bytes[f] = n;
      }
      out[server] = { at: e.at, bytes };
    }
    return out;
  } catch { return {}; }
}

export const readLastExport = (storage: Store, server: string): LastExport | null => readAll(storage)[server] ?? null;

/** Remember an export: the new file's size replaces the old one; sizes of the other formats are kept. */
export function recordExport(storage: Store, server: string, format: ExportFormat, bytes: number, at: number): void {
  const all = readAll(storage);
  const prev = all[server];
  all[server] = { at, bytes: { ...(prev?.bytes ?? {}), [format]: bytes } };
  try { storage.setItem(STORE_KEY, JSON.stringify(all)); } catch { /* storage full or private mode: the memory is a courtesy */ }
}
