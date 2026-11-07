import { button, icon, panel } from './components.ts';
import { fmt } from './format.ts';
import { t, tp } from './i18n.ts';
import type { StaffFamily, StaffOverview, StaffRole } from './api-staff.ts';
import type { Key } from './messages.ts';
import { nextArrival, type Tone } from './staff-view.ts';
import { h } from './ui.ts';

/** DOM pieces shared by the STAFF screens. The logic they show lives in staff-view.ts. */

export const famLabel = (f: StaffFamily): string => t(`st.fam.${f}` as Key);
export const famSub = (f: StaffFamily): string => t(`st.fam.sub.${f}` as Key);
export const famShort = (f: StaffFamily): string => t(`st.fam.short.${f}` as Key);
export const roleShort = (role: StaffRole): string => t(`st.role.${role}` as Key);
export const roleFull = (role: StaffRole): string => t(`st.role.${role}Full` as Key);

/** Shown when the server has no staff routes yet (404): the screen says so instead of failing. */
export const staffOff = (): HTMLElement => h('div', { class: 'ln-off st-off panel' }, h('div', { class: 'panel-body' }, icon('users', 20), h('h1', { class: 'ln-off-title' }, t('st.off.title')), h('p', { class: 'muted' }, t('st.off.body'))));

/** The Effectifs / Recrutement switch at the top right of the staffing screens. */
export function viewSwitch(current: 'staff' | 'hire', go: (hash: string) => void): HTMLElement {
  const opt = (id: 'staff' | 'hire', hash: string): HTMLElement =>
    h('button', { type: 'button', class: 'view-opt', 'aria-pressed': String(id === current), onclick: () => go(hash) }, t(`st.view.${id}` as Key), id === 'hire' ? h('kbd', { class: 'keycap' }, 'R') : null);
  return h('div', { class: 'view-switcher', role: 'group', 'aria-label': t('st.views') }, opt('staff', '#staff'), opt('hire', '#staff/hire'));
}

/** A thin bar showing how full a limit is: the fill is the fraction, the tone is carried by the label beside it as well. */
export const meterBar = (fraction: number, tone: Tone, label: string): HTMLElement =>
  h('div', { class: `st-meter ${tone}`, role: 'img', 'aria-label': label }, h('span', { style: `width:${Math.round(fraction * 100)}%` }));

export const toneIcon = (tone: Tone): SVGSVGElement => icon(tone === 'ok' ? 'circle-check' : tone === 'warn' ? 'triangle-alert' : 'ban', 14);

/** `Lun. 2 novembre`-style long day for a `YYYY-MM-DD`. */
export const longDay = (iso: string, locale: string): string => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(Date.parse(`${iso}T12:00:00Z`));
export const shortDate = (iso: string, locale: string): string => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(Date.parse(`${iso}T12:00:00Z`));

/** ` · 18 hires in notice, arriving from 14 Nov`: what the head count leaves out. Empty when nobody is in notice. */
export function arrivalNote(o: Pick<StaffOverview, 'pending' | 'families'>): string {
  const first = nextArrival(o.families);
  return first === null ? '' : ` · ${tp('st.ov.arriving', o.pending, { date: fmt().date(first) })}`;
}

/** The Compagnie tab's door to Staff (C8). Null while the server has no staff routes or cannot be asked: no dead button. */
export function staffEntry(overview: StaffOverview | null, go: (hash: string) => void): HTMLElement | null {
  if (!overview) return null;
  const fm = fmt();
  return panel({ title: t('st.entry.title'), action: t('st.crumb'), id: 'st-entry' },
    h('p', { class: 'muted' }, t('st.ov.sub.other', { n: fm.num(overview.people), positions: fm.num(overview.positions), payroll: fm.money(overview.payroll) }), arrivalNote(overview)),
    h('div', { class: 'row' }, button(t('st.entry.open'), { variant: 'secondary', icon: 'users', key: 'S', onclick: () => go('#staff') })));
}

/** What the recruitment screen is filtered on. The overview presets it (its `R` key and buttons) and the screen keeps it while the player moves around. */
export const hireFilter: { family: StaffFamily; base: string | null; qual: string | null } = { family: 'pilot', base: null, qual: null };
