import type { MealQuality } from './api-service.ts';
import { button, icon, panel } from './components.ts';
import { fmt } from './format.ts';
import { t } from './i18n.ts';
import type { Key } from './messages.ts';
import { h } from './ui.ts';

/** DOM pieces shared by the SERVICE screens. The logic they show lives in service-view.ts and kitchen-view.ts. */

const NBSP = '\u00a0';

/** Shown when the server has no service routes yet (404): the screen says so instead of failing. */
export const serviceOff = (): HTMLElement => h('div', { class: 'ln-off sv-off panel' }, h('div', { class: 'panel-body' }, icon('building-2', 20), h('h1', { class: 'ln-off-title' }, t('sv.off.title')), h('p', { class: 'muted' }, t('sv.off.body'))));
export const kitchenOff = (): HTMLElement => h('div', { class: 'ln-off sv-off panel' }, h('div', { class: 'panel-body' }, icon('chef-hat', 20), h('h1', { class: 'ln-off-title' }, t('kt.off.title')), h('p', { class: 'muted' }, t('kt.off.body'))));

/** True while the kitchen on show was opened from the Service screen (which clears it each time it draws): Esc then goes back there. B.10 sends the kitchen's Esc to the hub plan, but no building of the plan leads to a kitchen yet, so the Service screen is its door. */
export const kitchenTrail = { fromService: false };

export const qualityName = (q: MealQuality): string => t(`sv.q.${q}` as Key);

/** Euros with cents, for a price per meal: `6,40 €`. */
export const money2 = (n: number): string => `${fmt().num(n, 2)}${NBSP}\u20ac`;

/** A signed number with the typographic minus: `+0,5`, `−0,3`. */
export const signed = (n: number, digits = 0): string => `${n > 0 ? '+' : ''}${fmt().num(n, digits)}`;

/** A satisfaction on the 0..5 scale: `4,2 / 5`. */
export const outOf5 = (n: number): string => t('sv.stat.of5', { n: fmt().num(n, 1) });

/** `14 € le repas`: a meal level's price, as the Service screen writes it. */
export const priceLine = (price: number): string => t('sv.meals.perMeal', { price: money2(price) });

/** The Compagnie tab's door to the on-board service (C8). Null while the server has no service routes or cannot be asked: no dead button. */
export function serviceEntry(view: { satisfaction: number } | null, go: (hash: string) => void): HTMLElement | null {
  if (!view) return null;
  return panel({ title: t('sv.entry.title'), action: t('sv.entry.tag'), id: 'sv-entry' },
    h('p', { class: 'muted' }, t('sv.entry.body', { sat: fmt().num(view.satisfaction, 1) })),
    h('div', { class: 'row' }, button(t('sv.entry.open'), { variant: 'secondary', icon: 'chef-hat', key: 'B', onclick: () => go('#service') })));
}

