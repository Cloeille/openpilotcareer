import type { FacilityKind, Owner, StaffNeed } from './api-facilities.ts';
import { icon } from './components.ts';
import { t, tp } from './i18n.ts';
import { HOLDING_KEY, holdingOf, KIND_KEY, type Holding } from './facilities-view.ts';
import type { FacilityRow } from './api-facilities.ts';
import { h } from './ui.ts';

/** DOM pieces shared by the FACILITIES screens. The logic they show lives in facilities-view.ts. */

/** Shown when the server has no facilities routes yet (404): the screen says so instead of failing. */
export const facilitiesOff = (): HTMLElement =>
  h('div', { class: 'ln-off fc-off panel' }, h('div', { class: 'panel-body' }, icon('building-2', 20), h('h1', { class: 'ln-off-title' }, t('fc.off.title')), h('p', { class: 'muted' }, t('fc.off.body'))));

export const kindLabel = (k: FacilityKind): string => t(KIND_KEY[k]);
export const holdingText = (f: Pick<FacilityRow, 'owner' | 'hold' | 'kind' | 'monthly'>): string => t(HOLDING_KEY[holdingOf(f)]);

/** `10 techniciens · 1 chef`. */
export const staffText = (staff: readonly StaffNeed[]): string => staff.map((s) => `${s.need} ${tp(`fc.r.${s.role}`, s.need)}`).join(' · ');

/** A small colour sample of an owner, the same colours as the plan. The word next to it carries the meaning. */
export const ownerSwatch = (owner: Owner): HTMLElement => h('span', { class: `fc-swatch ${owner}`, 'aria-hidden': 'true' });

/** The sentence under the status colour of a building, from its holding. */
export function statusText(holding: Holding, ownerName?: string): string {
  switch (holding) {
    case 'available': return t('fc.sel.available');
    case 'leased': return t('fc.sel.leased');
    case 'owned': return t('fc.sel.owned');
    case 'ai': return ownerName ? t('fc.sel.ai', { name: ownerName }) : t('fc.sel.aiAnon');
    case 'fee': return t('fc.sel.fee');
    case 'airport': return t('fc.sel.airport');
  }
}

/** The owner a holding is drawn as. */
export const ownerOfHolding = (holding: Holding): Owner => (holding === 'leased' || holding === 'owned' ? 'player' : holding === 'available' ? 'available' : holding === 'ai' ? 'ai' : 'airport');

/** The building the plan opens on when the player came from a row of the overview. Read once by the plan. */
export const planFocus: { slot: string | null } = { slot: null };
