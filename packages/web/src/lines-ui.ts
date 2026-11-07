import type { AircraftType } from '@opc/shared';
import { airportInfo, cityOf } from './airports.ts';
import { typesOf } from './competition-data.ts';
import { icon, switchControl } from './components.ts';
import { locale } from './finance-ui.ts';
import { fmt } from './format.ts';
import { t } from './i18n.ts';
import type { LineVisual, AirportFact } from './lines-view.ts';
import type { Key } from './messages.ts';
import { h } from './ui.ts';

/** DOM pieces shared by the LINES screens. The logic they show lives in lines-view.ts. */

const VISUAL_ICON = { ok: 'circle-check', delayed: 'clock', interrupted: 'circle-x', paused: 'pause' } as const;
const VISUAL_KEY: Record<LineVisual, Key> = { ok: 'ln.state.ok', delayed: 'ln.state.delayed', interrupted: 'ln.state.interrupted', paused: 'ln.state.paused' };

/** Status of a line: icon and label carry it, colour only reinforces. */
export const stateLabel = (v: LineVisual, delayMin = 0): HTMLElement =>
  h('span', { class: `ln-state ${v}` }, icon(VISUAL_ICON[v], 13), t(VISUAL_KEY[v], { n: delayMin }));

/** The line sample beside a row: solid for a line in service, dashed red when it is not. */
export const swatch = (v: LineVisual, selected = false): HTMLElement =>
  h('span', { class: `ln-swatch ${v}${selected ? ' selected' : ''}`, 'aria-hidden': 'true' }, v === 'interrupted' ? [h('i'), h('i'), h('i')] : null);

/** `Nice – Lyon`-style pair label with the ICAO codes between thin dashes, as the mockup writes them. */
export const pairLabel = (a: string, b: string): string => `${a} – ${b}`;

export const airportFacts = async (codes: readonly string[]): Promise<AirportFact[]> => {
  const found = await Promise.all(codes.map(async (icao) => ({ icao, a: await airportInfo(icao) })));
  return found.flatMap(({ icao, a }) => (a ? [{ icao, city: cityOf(a).replace(/\s*\(.*$/, ''), lat: a.lat, lon: a.lon }] : []));
};

export async function typeNames(icaos: readonly string[]): Promise<(icao: string) => string> {
  const types: Map<string, AircraftType> = await typesOf([...new Set(icaos)]);
  return (icao) => types.get(icao)?.name ?? icao;
}

const dayFormat = (o: Intl.DateTimeFormatOptions) => (ms: number): string => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...o }).format(ms);
/** `ven. 6 novembre` */
const dayLabel = (ms: number): string => dayFormat({ weekday: 'short', day: 'numeric', month: 'long' })(ms);
/** `lun. 2` for the week strip. */
export const dayShort = (iso: string): string => dayFormat({ weekday: 'short', day: 'numeric' })(Date.parse(`${iso}T12:00:00Z`));
/** `sam. 7 nov.` */
export const dayMedium = (ms: number): string => dayFormat({ weekday: 'short', day: 'numeric', month: 'short' })(ms);
/** `jeu. 5 novembre 14:00Z` */
export const dayTime = (ms: number): string => `${dayLabel(ms)} ${fmt().zulu(ms)}`;

/** The header block of the network and operations screens: the 24/7 switch and the simulated clock. */
export function clockGroup(enabled: boolean, onToggle: (on: boolean) => void): { root: HTMLElement; set: (now: number, enabled: boolean) => void } {
  const label = h('span', { id: 'ln-auto-label', class: 'ln-auto-label' }, t('ln.auto'));
  const toggle = switchControl({ checked: enabled, labelledBy: 'ln-auto-label', onchange: onToggle, id: 'ln-auto' });
  const caption = h('span', { class: 'ln-clock-label' });
  const time = h('span', { class: 'ln-clock-time', 'aria-live': 'off' });
  const root = h('div', { class: 'ln-clock-group' },
    h('div', { class: 'ln-auto' }, toggle, label), h('span', { class: 'ln-divider', 'aria-hidden': 'true' }),
    h('div', { class: 'ln-clock' }, caption, time));
  const set = (now: number, on: boolean): void => {
    caption.textContent = t('ln.clock', { day: dayLabel(now) });
    time.textContent = fmt().zulu(now);
    toggle.setAttribute('aria-checked', String(on));
  };
  return { root, set };
}

/** Shown when the server has no lines routes yet (404): the screen says so instead of failing. */
export const featureOff = (messageKey: Key): HTMLElement => h('div', { class: 'ln-off panel' }, h('div', { class: 'panel-body' }, icon('plane', 20), h('h1', { class: 'ln-off-title' }, t(messageKey)), h('p', { class: 'muted' }, t('ln.off.body'))));

/** `replaceChildren` that skips the `null`s a conditional child leaves behind (`h()` does that for its own children). */
export const fill = (el: Element, ...kids: (Node | string | null | false | undefined)[]): void => el.replaceChildren(...kids.filter((k): k is Node | string => k !== null && k !== false && k !== undefined));
