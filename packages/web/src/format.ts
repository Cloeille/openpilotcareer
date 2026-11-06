import { getLang, type Lang } from './i18n.ts';

const NBSP = '\u00a0';
const LOCALE: Record<Lang, string> = { en: 'en-GB', fr: 'fr-FR' };

/** Number, money, time and unit formats of the mockup (`1 284 560 €`, `18:42Z`, `1 070 kg`, `412 kt`), per language. Group separators are no-break spaces so a figure never wraps. */
export function makeFormat(lang: Lang) {
  const locale = LOCALE[lang];
  const nbsp = (s: string): string => s.replace(/[\u202f\u00a0]/g, NBSP);
  const eur = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const zulu = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const num = (n: number, digits = 0): string => nbsp(n.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
  return {
    num,
    money: (n: number): string => nbsp(eur.format(n)),
    /** Millions with two decimals above 1 M (`8,42 M€`), the full amount below. */
    moneyShort: (n: number): string => (Math.abs(n) >= 1_000_000 ? `${num(n / 1_000_000, 2)}${NBSP}M€` : nbsp(eur.format(n))),
    /** Ordinal: `7e` / `7th`, `1er` / `1st`. */
    ordinal: (n: number): string => {
      if (lang === 'fr') return n === 1 ? '1er' : `${n}e`;
      const r = new Intl.PluralRules('en', { type: 'ordinal' }).select(n);
      return `${n}${r === 'one' ? 'st' : r === 'two' ? 'nd' : r === 'few' ? 'rd' : 'th'}`;
    },
    /** Signed amount for deltas and flight results: `+12 480 €`. */
    signedMoney: (n: number): string => `${n > 0 ? '+' : ''}${nbsp(eur.format(n))}`,
    /** `18:42Z`: UTC clock time. */
    zulu: (ms: number): string => `${zulu.format(ms)}Z`,
    date: (ms: number): string => day.format(ms),
    dateTime: (ms: number): string => `${day.format(ms)} · ${zulu.format(ms)}Z`,
    nm: (n: number): string => `${num(n)}${NBSP}NM`,
    kg: (n: number): string => `${num(n)}${NBSP}kg`,
    kt: (n: number): string => `${num(n)}${NBSP}kt`,
    /** Fraction 0..1 as `72 %`. */
    percent: (fraction: number): string => `${num(Math.round(fraction * 100))}${NBSP}%`,
    /** `{ month: 'novembre', daysLeft: 25 }`: the monthly (UTC) season that `now` falls in. */
    season: (now: number): { month: string; daysLeft: number } => {
      const d = new Date(now);
      const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      return { month: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long' }).format(now), daysLeft: Math.floor((end - now) / 86_400_000) };
    },
    /** Elapsed time, coarse: `12 s`, `3 min`, `2 h`. */
    elapsed: (ms: number): string => {
      const s = Math.max(0, Math.round(ms / 1000));
      return s < 60 ? `${s}${NBSP}s` : s < 3600 ? `${Math.floor(s / 60)}${NBSP}min` : `${Math.floor(s / 3600)}${NBSP}h`;
    },
    /** Whole calendar days (UTC) between `ms` and `now` in words: `hier`, `3 days ago`. */
    ago: (ms: number, now: number): string => {
      const days = Math.floor(now / 86_400_000) - Math.floor(ms / 86_400_000);
      return days < 0 ? '' : rel.format(-days, 'day');
    },
    /** Flight duration from hours: `1 h 30`. */
    duration: (hours: number): string => {
      const total = Math.round(hours * 60);
      return `${Math.floor(total / 60)}${NBSP}h ${String(total % 60).padStart(2, '0')}`;
    },
  };
}

const cache = new Map<Lang, ReturnType<typeof makeFormat>>();
/** Formatters for the current UI language. */
export function fmt(): ReturnType<typeof makeFormat> {
  const lang = getLang();
  let f = cache.get(lang);
  if (!f) cache.set(lang, (f = makeFormat(lang)));
  return f;
}
