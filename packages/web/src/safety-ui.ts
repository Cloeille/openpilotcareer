import type { Incident, SafetyView } from './api-safety.ts';
import { button, icon, panel } from './components.ts';
import { fmt } from './format.ts';
import { t, tp } from './i18n.ts';
import { incidentFacts, type IncidentFacts } from './safety-view.ts';
import { h } from './ui.ts';

/** DOM pieces shared by the SAFETY screens. The logic they show lives in safety-view.ts. */

const NBSP = '\u00a0';

/** Shown when the server has no safety routes yet (404): the screen says so instead of failing. */
export const safetyOff = (): HTMLElement => h('div', { class: 'ln-off sf-off panel' }, h('div', { class: 'panel-body' }, icon('shield-alert', 20), h('h1', { class: 'ln-off-title' }, t('sf.off.title')), h('p', { class: 'muted' }, t('sf.off.body'))));

/** A probability (a fraction) as `1,8 %`. */
export const pct1 = (fraction: number): string => `${fmt().num(fraction * 100, 1)}${NBSP}%`;

/** `4` or `1,7`: how many times the average risk. */
export function factorText(factor: number): string {
  const r = Math.round(factor * 10) / 10;
  return t('sf.risk.factor', { n: fmt().num(r, Number.isInteger(r) ? 0 : 1) });
}

/** A signed whole number with the typographic minus: `+3`, `−6`. */
export const signed = (n: number): string => `${n > 0 ? '+' : ''}${fmt().num(n)}`;

/** What an incident cost and what it led to, on one line: `18 400 € · immobilisé 2 jours · réputation −6`. */
function consequences(f: IncidentFacts): string {
  const fm = fmt();
  return [
    f.cost > 0 ? fm.money(f.cost) : null,
    f.insured === 'all' ? t('sf.inc.insuredAll') : f.insured === 'part' ? t('sf.inc.insuredPart', { amount: fm.money(f.covered) }) : null,
    f.grounded ? t('sf.inc.grounded') : f.downtimeDays !== null ? tp('sf.inc.down', f.downtimeDays) : null,
    f.reputation !== 0 ? t('sf.inc.rep', { n: fm.num(f.reputation) }) : null,
  ].filter((x): x is string => x !== null).join(' · ');
}

/** One incident of the season: date, severity dot and meta, the cause, the consequences. The severity is in words as well as in colour. */
export function incidentRow(i: Incident, registration: string): HTMLElement {
  const fm = fmt();
  const facts = incidentFacts(i);
  const sev = t(`sf.sev.${i.severity}` as const);
  return h('li', { class: 'sf-inc' },
    h('time', { class: 'sf-inc-date', datetime: new Date(i.at).toISOString() }, fm.date(i.at)),
    h('div', { class: 'sf-inc-text' },
      h('div', { class: 'sf-inc-head' }, h('i', { class: `sf-sev ${i.severity}`, 'aria-hidden': 'true' }), h('span', { class: 'sf-inc-title' }, i.title), h('span', { class: `sf-inc-meta ${i.severity}` }, t('sf.inc.meta', { severity: sev, aircraft: registration }))),
      i.detail ? h('p', { class: 'sf-inc-cause' }, i.detail) : null,
      h('p', { class: `sf-inc-cons${i.severity === 'grave' ? ' strong' : ''}` }, consequences(facts))));
}

/** The Compagnie tab's door to Safety (C8). Null while the server has no safety routes or cannot be asked: no dead button. */
export function safetyEntry(view: Pick<SafetyView, 'index'> | null, go: (hash: string) => void): HTMLElement | null {
  if (!view) return null;
  return panel({ title: t('sf.entry.title'), action: t('sf.entry.tag'), id: 'sf-entry' },
    h('p', { class: 'muted' }, t('sf.entry.body', { index: fmt().num(Math.round(view.index)) })),
    h('div', { class: 'row' }, button(t('sf.entry.open'), { variant: 'secondary', icon: 'shield-check', key: 'F', onclick: () => go('#safety') })));
}
