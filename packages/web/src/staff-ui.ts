import { icon } from './components.ts';
import { doorCard } from './facilities-ui.ts';
import { fmt } from './format.ts';
import { t, tp } from './i18n.ts';
import type { StaffFamily, StaffOverview, StaffRole } from './api-staff.ts';
import { nextArrival, type Tone } from './staff-view.ts';
import { h } from './ui.ts';

/** DOM pieces shared by the STAFF screens. The logic they show lives in staff-view.ts. */

export const famLabel = (f: StaffFamily): string => t(`st.fam.${f}`);
export const famSub = (f: StaffFamily): string => t(`st.fam.sub.${f}`);
export const famShort = (f: StaffFamily): string => t(`st.fam.short.${f}`);
/** The template literal is checked against `Key` for every member of the union: a StaffRole without a short and a Full message does not typecheck. */
export const roleShort = (role: StaffRole): string => t(`st.role.${role}`);
export const roleFull = (role: StaffRole): string => t(`st.role.${role}Full`);

/** Shown when the server has no staff routes yet (404): the screen says so instead of failing. */
export const staffOff = (): HTMLElement => h('div', { class: 'ln-off st-off panel' }, h('div', { class: 'panel-body' }, icon('users', 20), h('h1', { class: 'ln-off-title' }, t('st.off.title')), h('p', { class: 'muted' }, t('st.off.body'))));

/** The Effectifs / Recrutement / Cabinet switch at the top right of the staffing screens. */
export function viewSwitch(current: 'staff' | 'hire' | 'agency' | 'training', go: (hash: string) => void): HTMLElement {
  const opt = (id: 'staff' | 'hire' | 'agency' | 'training', hash: string): HTMLElement =>
    h('button', { type: 'button', class: 'view-opt', 'aria-pressed': String(id === current), onclick: () => go(hash) }, t(`st.view.${id}`), id === 'hire' ? h('kbd', { class: 'keycap' }, 'R') : null);
  return h('div', { class: 'view-switcher', role: 'group', 'aria-label': t('st.views') }, opt('staff', '#staff'), opt('hire', '#staff/hire'), opt('agency', '#staff/agency'), opt('training', '#staff/training'));
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
  return doorCard({ id: 'st-entry', title: t('st.entry.title'), tag: t('st.crumb'), body: t('st.ov.sub.other', { n: fm.num(overview.people), positions: fm.num(overview.positions), payroll: fm.money(overview.payroll) }) + arrivalNote(overview), open: t('st.entry.open'), icon: 'users', key: 'S', onopen: () => go('#staff') });
}

/** What the recruitment screen is filtered on. The overview presets it (its `R` key and buttons) and the screen keeps it while the player moves around. */
export const hireFilter: { family: StaffFamily; base: string | null; qual: string | null } = { family: 'pilot', base: null, qual: null };
