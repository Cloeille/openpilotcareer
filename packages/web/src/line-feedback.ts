import type { AircraftLine } from '@opc/shared';
import { makeFormat } from './format.ts';
import { getLang, translate, type Lang } from './i18n.ts';

/** What the fleet screen says about an aircraft that flies a line: where it is now (in the air, or standing at an airport with its next departure) and what its last leg earned. Times are the real ones (the scheduled time plus the delay). */
export type AircraftLive = {
  state: { kind: 'flying'; from: string; to: string; arrAt: number } | { kind: 'ground'; at: string; next: { flightNo: string; depAt: number } | null };
  last: { flightNo: string; net: number } | null;
};

const late = (l: { delayMin: number }): number => l.delayMin * 60_000;

/** The live state of an aircraft, null for one that flies no line (its server row is missing). */
export function aircraftLive(a: AircraftLine | undefined): AircraftLive | null {
  if (!a) return null;
  const { flying, next, last } = a;
  return {
    state: flying
      ? { kind: 'flying', from: flying.origin, to: flying.dest, arrAt: flying.arr + late(flying) }
      : { kind: 'ground', at: a.location, next: next ? { flightNo: next.flightNo, depAt: next.dep + late(next) } : null },
    last: last ? { flightNo: last.flightNo, net: last.net } : null,
  };
}

/** `14:20Z` for an instant of today, `5 nov. · 14:20Z` for another day. */
export const whenLabel = (ms: number, now: number, lang: Lang = getLang()): string => {
  const f = makeFormat(lang);
  return Math.floor(ms / 86_400_000) === Math.floor(now / 86_400_000) ? f.zulu(ms) : f.dateTime(ms);
};

/** `at 14:20Z` for an instant of today, `on 5 Nov at 14:20Z` for another day. */
const atLabel = (ms: number, now: number, lang: Lang): string => {
  const f = makeFormat(lang);
  return Math.floor(ms / 86_400_000) === Math.floor(now / 86_400_000) ? translate(lang, 'ln.live.at', { time: f.zulu(ms) }) : translate(lang, 'ln.live.onDay', { date: f.date(ms), time: f.zulu(ms) });
};

/** `In flight RJTT → RJFF, arrives at 01:22Z` or `On the ground at RJTT · next departure AMY 1101 at 00:00Z`. */
export function liveState(l: AircraftLive, now: number, lang: Lang = getLang()): string {
  const s = l.state;
  if (s.kind === 'flying') return translate(lang, 'ln.live.flying', { from: s.from, to: s.to, when: atLabel(s.arrAt, now, lang) });
  return s.next ? translate(lang, 'ln.live.ground', { at: s.at, flight: s.next.flightNo, when: atLabel(s.next.depAt, now, lang) }) : translate(lang, 'ln.live.groundNone', { at: s.at });
}

/** `Last flight AMY 1102 +19 210 €`, null before the aircraft landed its first leg. */
export const liveLast = (l: AircraftLive, lang: Lang = getLang()): string | null =>
  l.last ? translate(lang, 'ln.live.last', { flight: l.last.flightNo, net: makeFormat(lang).signedMoney(l.last.net) }) : null;
