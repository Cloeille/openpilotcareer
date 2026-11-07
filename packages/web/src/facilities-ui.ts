import type { FacilityKind, FacilityOwner, FacilityView } from '@opc/shared';
import { icon } from './components.ts';
import { t } from './i18n.ts';
import { HOLDING_KEY, holdingOf, type Holding } from './facilities-view.ts';
import { h } from './ui.ts';

/** DOM pieces shared by the FACILITIES screens. The logic they show lives in facilities-view.ts. */

/** Shown when the server has no facilities routes yet (404): the screen says so instead of failing. */
export const facilitiesOff = (): HTMLElement =>
  h('div', { class: 'ln-off fc-off panel' }, h('div', { class: 'panel-body' }, icon('building-2', 20), h('h1', { class: 'ln-off-title' }, t('fc.off.title')), h('p', { class: 'muted' }, t('fc.off.body'))));

export const kindLabel = (k: FacilityKind | 'all' | 'parking'): string => t(`fc.kind.${k}`);
export const holdingText = (f: Pick<FacilityView, 'owner' | 'contract'>): string => t(HOLDING_KEY[holdingOf(f)]);

/** A small colour sample of an owner, the same colours as the plan. The word next to it carries the meaning. */
export const ownerSwatch = (owner: FacilityOwner): HTMLElement => h('span', { class: `fc-swatch ${owner}`, 'aria-hidden': 'true' });

/** The sentence under the status colour of a building, from its holding. */
export function statusText(holding: Holding, ownerName?: string | null): string {
  switch (holding) {
    case 'available': return t('fc.sel.available');
    case 'leased': return t('fc.sel.leased');
    case 'owned': return t('fc.sel.owned');
    case 'ai': return ownerName ? t('fc.sel.ai', { name: ownerName }) : t('fc.sel.aiAnon');
    case 'airport': return t('fc.sel.airport');
  }
}

/** The building the plan opens on when the player came from a row of the overview. Read once by the plan. */
export const planFocus: { slot: string | null } = { slot: null };
