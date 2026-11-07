import type { GroupAircraft, GroupCompany, GroupView } from '@opc/shared';
import { icon, panel } from './components.ts';
import { doorCard } from './facilities-ui.ts';
import { fmt } from './format.ts';
import { CESSION_KEY } from './group-view.ts';
import { t, tp } from './i18n.ts';
import { h } from './ui.ts';

/** Shown when the server has no group routes (404): the screen says so instead of failing. */
export const groupOff = (): HTMLElement => h('div', { class: 'ln-off panel' }, h('div', { class: 'panel-body' }, icon('building-2', 20), h('h1', { class: 'ln-off-title' }, t('gr.off.title')), h('p', { class: 'muted' }, t('gr.off.body'))));

/** The door from the Compagnie tab to the group (`G`): how many subsidiaries, the cash of the group, and the way in. Null when the server has no group routes. */
export function groupEntry(group: GroupView | null, go: (hash: string) => void): HTMLElement | null {
  if (!group) return null;
  const subs = group.companies.length - 1;
  return doorCard({
    id: 'gr-entry', title: t('gr.entry.title'), tag: tp('gr.entry.count', subs),
    body: subs === 0 ? t('gr.entry.none') : t('gr.entry.body', { balance: fmt().money(group.total.balance) }), open: t('gr.entry.open'), icon: 'building-2', key: 'G', onopen: () => go('#group'),
  });
}

/** A company of the group as a short line: its name, its code, its base. */
export const companyTag = (c: Pick<GroupCompany, 'name' | 'code' | 'hub'>): string => [c.name, c.code, c.hub].filter((x) => x !== null).join(' · ');

/** The empty-state panel of a screen that needs a subsidiary. */
export const needSubsidiary = (): HTMLElement => panel({ title: t('gr.empty.title'), id: 'gr-empty' }, h('p', { class: 'dim' }, t('gr.empty.body')));

/** The aircraft of a company as tickable rows: one that cannot be ceded now is disabled and says why. `onToggle` redraws. */
export function aircraftPicker(label: string, fleet: readonly GroupAircraft[], picked: readonly number[], onToggle: (id: number) => void): HTMLElement {
  const fm = fmt();
  return h('div', { class: 'gp-aclist', role: 'group', 'aria-label': label }, fleet.map((a) => {
    const on = picked.includes(a.id);
    return h('button', {
      type: 'button', class: `gp-ac${on ? ' on' : ''}`, role: 'checkbox', 'aria-checked': String(on), disabled: a.cession !== null, 'data-row': '',
      'aria-label': `${a.registration} ${a.icao}${a.cession ? `, ${t(CESSION_KEY[a.cession])}` : ''}`, onclick: () => onToggle(a.id),
    }, icon(on ? 'circle-check' : 'circle-dashed', 16), h('span', { class: 'mono strong' }, a.registration), h('span', { class: 'dim small' }, `${a.icao} · ${a.location}`),
    h('span', { class: 'dim small gp-ac-note' }, a.cession ? t(CESSION_KEY[a.cession]) : t('gr.new.cede', { value: fm.money(a.value) })));
  }));
}
