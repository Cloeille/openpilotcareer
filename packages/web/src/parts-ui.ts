import { button, icon, panel } from './components.ts';
import { locale } from './finance-ui.ts';
import { fmt } from './format.ts';
import { t } from './i18n.ts';
import type { WarehouseView } from './api-parts.ts';
import { h } from './ui.ts';

/** DOM pieces shared by the PARTS screens. The logic they show lives in parts-view.ts. */

/** Shown when the server has no parts routes yet (404): the screen says so instead of failing. */
export const partsOff = (): HTMLElement =>
  h('div', { class: 'ln-off pt-off panel' }, h('div', { class: 'panel-body' }, icon('wrench', 20), h('h1', { class: 'ln-off-title' }, t('pt.off.title')), h('p', { class: 'muted' }, t('pt.off.body'))));

const dayFormat = (): Intl.DateTimeFormat => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
/** `mer. 4` */
export const dayOf = (ms: number): string => dayFormat().format(ms);
/** `mer. 4 à 00:40Z` */
export const whenOf = (ms: number): string => t('pt.at', { day: dayOf(ms), time: fmt().zulu(ms) });

/** The Compagnie tab's door to the warehouse (C8). Null while the server has no parts routes or the player has no aircraft to keep parts for: no dead button. */
export function warehouseEntry(hub: string, view: Pick<WarehouseView, 'capital' | 'expectedGroundDays' | 'covered' | 'policies'> | null, go: (hash: string) => void): HTMLElement | null {
  if (!view || view.policies.length === 0) return null;
  const fm = fmt();
  return panel({ title: t('pt.entry.title'), action: hub, id: 'pt-entry' },
    h('p', { class: 'muted' }, t('pt.entry.body', { capital: fm.money(view.capital), hub, days: fm.num(Math.round(view.expectedGroundDays)), covered: view.covered.count, of: view.covered.of })),
    h('div', { class: 'row' }, button(t('pt.entry.open'), { variant: 'secondary', icon: 'wrench', key: 'W', onclick: () => go(`#warehouse/${hub}`) })));
}

/** `382,5 k€`, `65 k€`, `0 €`: the compact money of the policy rows. */
export function kEuro(n: number): string {
  const fm = fmt();
  return Math.abs(n) < 1_000 ? fm.money(n) : `${fm.num(n / 1_000, Number.isInteger(n / 1_000) ? 0 : 1)}\u00a0k€`;
}
