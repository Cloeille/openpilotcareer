import { en, fr, type Key } from './messages.ts';

export const LANGS = ['en', 'fr'] as const;
export type Lang = (typeof LANGS)[number];
const dicts: Record<Lang, Partial<Record<Key, string>>> = { en, fr };
const STORE_KEY = 'opc.lang';

/** The stored choice wins; otherwise the first browser language we speak; otherwise English. */
export function pickLang(stored: string | null, preferred: readonly string[]): Lang {
  if (stored === 'en' || stored === 'fr') return stored;
  for (const p of preferred) {
    const base = p.toLowerCase().split('-')[0];
    if (base === 'en' || base === 'fr') return base;
  }
  return 'en';
}

/** French elision before the months that start with a vowel: "saison de octobre" -> "saison d’octobre". Only month names, so no other text is touched. */
export const elide = (text: string): string => text.replace(/\b([Dd])e (?=(?:avril|août|octobre)\b)/g, '$1’');

/** Look a key up in `lang`, falling back to English, then to the key itself; `{name}` placeholders are filled from `vars`. */
export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const text = dicts[lang][key] ?? en[key] ?? key;
  const filled = vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
  return lang === 'fr' ? elide(filled) : filled;
}

/** Plural form chosen with Intl.PluralRules: looks up `${base}.${category}`, then `${base}.other`. `{n}` is filled in. */
export function translatePlural(lang: Lang, base: string, n: number, vars?: Record<string, string | number>): string {
  const category = new Intl.PluralRules(lang).select(n);
  const dict = { ...en, ...dicts[lang] } as Record<string, string>;
  const key = (`${base}.${category}` in dict ? `${base}.${category}` : `${base}.other`) as Key;
  return translate(lang, key, { n, ...vars });
}

let current: Lang | null = null;
function initialLang(): Lang {
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORE_KEY); } catch { /* storage unavailable */ }
  const lang = pickLang(stored, typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}

export const getLang = (): Lang => (current ??= initialLang());
export function setLang(lang: Lang): void {
  if (lang === getLang()) return;
  current = lang;
  try { localStorage.setItem(STORE_KEY, lang); } catch { /* private mode: the choice lasts for this page only */ }
  document.documentElement.lang = lang;
  window.dispatchEvent(new Event('opc:lang'));
}

export const t = (key: Key, vars?: Record<string, string | number>): string => translate(getLang(), key, vars);
export const tp = (base: string, n: number, vars?: Record<string, string | number>): string => translatePlural(getLang(), base, n, vars);
