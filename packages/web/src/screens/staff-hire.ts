import { START_NOW_FEE, STAFF_FAMILIES } from '@opc/shared';
import { act } from '../actions.ts';
import { fetchCandidates, fetchStaff, hireCandidate, type Candidate, type CandidatesView, type StaffFamily } from '../api-staff.ts';
import { button, icon, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { famLabel, hireFilter, meterBar, pilotTypes, roleFull, roleShort, shortDate, staffOff, viewSwitch } from '../staff-ui.ts';
import { keepSelection, moraleLevel, reliabilityTone, startsAt, unblocks } from '../staff-view.ts';
import { h } from '../ui.ts';

/** Every family the market lists: the server's own list, so a family added there is hireable here (the kitchen's cooks were missing from a hand-kept copy). */
const FAMILIES: readonly StaffFamily[] = STAFF_FAMILIES;
let selected: string | null = null;

/** `#staff/hire`: the job market, filtered, with the offer for the candidate in focus. */
export async function staffHire(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const back = '#staff';
  const hints = [{ key: t('key.esc'), label: t('st.hint.staff') }, { key: 'T', label: t('st.hint.filters') }, { key: '↑ ↓', label: t('st.hint.candidate') }, { key: t('key.enter'), label: t('st.hint.hire') }];
  const [overview, list] = await Promise.all([fetchStaff().catch(() => null), fetchCandidates({ family: hireFilter.family, ...(hireFilter.base ? { base: hireFilter.base } : {}), ...(hireFilter.qual && hireFilter.family === 'pilot' ? { qual: hireFilter.qual } : {}) })]);
  if (!list) return { title: t('st.hire.title'), scene: 'login', tab: 'hubs', back, hints: hints.slice(0, 1), view: staffOff() };
  const types = pilotTypes(overview);
  const blockers = overview?.blockers ?? [];
  selected = keepSelection(list.candidates, selected);

  // ------------------------------------------------------------ header and filters
  const header = h('div', { class: 'ln-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), t('st.hire.market', { n: fm.num(list.market) })), t('st.hire.title'), h('p', { class: 'muted', style: 'font-size:14px' }, tp('st.hire.sub', list.candidates.length))),
    viewSwitch('hire', go));
  const chip = (group: string, value: string, label: string, on: boolean, pick: () => void): HTMLElement =>
    h('button', { type: 'button', id: `st-f-${group}-${value || 'all'}`, class: `st-chip${group === 'base' ? ' mono' : ''}`, 'aria-pressed': String(on), onclick: pick }, label);
  const filters = h('div', { class: 'st-filters', role: 'group', 'aria-label': t('st.hint.filters') },
    h('div', { class: 'st-fgroup', role: 'group', 'aria-label': t('st.f.post') }, h('span', { class: 'dim small' }, t('st.f.post')),
      FAMILIES.map((f) => chip('family', f, famLabel(f), hireFilter.family === f, () => { Object.assign(hireFilter, { family: f, qual: null }); selected = null; redraw(); }))),
    h('div', { class: 'st-fgroup', role: 'group', 'aria-label': t('st.f.base') }, h('span', { class: 'dim small' }, t('st.f.base')),
      chip('base', '', t('st.allBases'), hireFilter.base === null, () => { hireFilter.base = null; selected = null; redraw(); }),
      me.hubs.map((b) => chip('base', b, b, hireFilter.base === b, () => { hireFilter.base = b; selected = null; redraw(); }))),
    hireFilter.family === 'pilot' && types.length > 0 ? h('div', { class: 'st-fgroup', role: 'group', 'aria-label': t('st.f.qual') }, h('span', { class: 'dim small' }, t('st.f.qual')),
      chip('qual', '', t('st.f.anyQual'), hireFilter.qual === null, () => { hireFilter.qual = null; selected = null; redraw(); }),
      types.map((x) => chip('qual', x.type, x.label, hireFilter.qual === x.type, () => { hireFilter.qual = x.type; selected = null; redraw(); }))) : null);

  // ------------------------------------------------------------ candidates
  const expOf = (c: Candidate): string => (c.family === 'pilot' ? `${fm.num(c.experience)} h` : tp('st.hire.years', c.experience));
  const sidePanel = h('div', { class: 'st-side-host' });
  const pick = (c: Candidate): void => {
    selected = c.id;
    for (const el of document.querySelectorAll<HTMLElement>('.st-cand')) el.setAttribute('aria-selected', String(el.dataset.id === c.id));
    sidePanel.replaceChildren(offer(c));
  };
  const rowOf = (c: Candidate): HTMLElement =>
    h('tr', { class: 'st-cand', 'data-row': '', 'data-id': c.id, tabindex: 0, 'aria-selected': String(c.id === selected), 'aria-label': t('st.hire.row', { name: c.name, role: roleShort(c.role), pay: fm.money(c.askingSalary) }),
      onfocus: () => pick(c), onclick: () => pick(c), // Enter moves to the hire button: signing costs a month of salary, so it takes a second press (as taking a rotation does on the line screen).
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); pick(c); sidePanel.querySelector<HTMLElement>('[data-primary]')?.focus(); } } },
    h('th', { scope: 'row' }, h('span', { class: 'col tight' }, h('span', { class: 'st-name' }, c.name), h('span', { class: 'dim small' }, c.family === 'pilot' ? t('st.hire.fromMarket') : famLabel(c.family)))),
    h('td', { class: 'mono' }, c.family === 'pilot' ? `${roleShort(c.role)}${c.qual ? ` ${c.qual}` : ''}` : roleShort(c.role)),
    h('td', { class: 'mono' }, expOf(c)), h('td', { class: 'mono' }, c.base),
    h('td', null, h('span', { class: 'st-rel' }, meterBar(c.reliability / 100, reliabilityTone(c.reliability), `${c.reliability} %`), h('span', { class: reliabilityTone(c.reliability) === 'warn' ? 'st-warn' : '' }, fm.percent(c.reliability / 100)))),
    h('td', null, t(`st.level.${moraleLevel(c.morale)}`)),
    h('td', { class: 'end' }, h('span', { class: 'strong' }, fm.money(c.askingSalary)), ' ', h('span', { class: 'dim small' }, t('st.perMonth'))));
  const cols = [t('st.hire.col.who'), t('st.hire.col.role'), t('st.hire.col.exp'), t('st.hire.col.base'), t('st.hire.col.rel'), t('st.hire.col.morale'), t('st.hire.col.pay')];
  const table = list.candidates.length === 0 ? h('p', { class: 'dim st-empty' }, t('st.hire.empty'))
    : h('div', { class: 'scroll', role: 'region', 'aria-label': t('st.hire.panel'), tabindex: -1 }, h('table', { class: 'data st-table' }, h('caption', { class: 'sr' }, t('st.hire.panel')),
      h('thead', null, h('tr', null, cols.map((c, i) => h('th', { scope: 'col', class: i === 6 ? 'end' : '' }, c)))), h('tbody', null, list.candidates.map(rowOf))));
  const suggestion = list.suggestion ? h('div', { class: 'st-suggest' }, icon('users', 16), h('span', null, list.suggestion.label)) : null;
  const main = panel({ title: t('st.hire.panel'), action: t('st.hire.count', { n: list.candidates.length }), id: 'st-cands', class: 'st-panel' }, table, suggestion);

  // ------------------------------------------------------------ the offer
  async function hire(c: Candidate, startNow = false): Promise<void> {
    const done = startNow ? t('st.hiredNow', { name: c.name }) : t('st.hired', { name: c.name, date: fm.date(startsAt(Date.now(), c)) });
    const ok = await act(done, () => hireCandidate(c.id, startNow), ctx.refresh);
    if (ok) { selected = null; redraw(); }
  }
  const offer = (c: Candidate): HTMLElement => {
    const freed = unblocks(blockers, c);
    const fact = (label: string, value: string): HTMLElement => h('div', { class: 'ln-fact' }, h('span', { class: 'muted' }, label), h('span', { class: 'ln-fact-value' }, value));
    return panel({ title: c.name, headless: true, id: 'st-offer', class: 'st-side' },
      freed > 0 ? h('span', { class: 'st-eyebrow ok' }, icon('circle-check', 14), tp('st.hire.unblocks', freed)) : h('span', { class: 'st-eyebrow' }, icon('users', 14), t('st.hire.offer')),
      h('div', { class: 'col tight' }, h('h2', { class: 'st-side-title' }, c.name), h('p', { class: 'muted' }, `${roleFull(c.role)}${c.qual ? ` · ${c.qual}` : ''}`)),
      h('div', { class: 'col tight st-facts-list' },
        fact(t('st.d.exp'), c.family === 'pilot' ? `${fm.num(c.experience)} h` : tp('st.hire.years', c.experience)),
        fact(t('st.d.avail'), t('st.d.availVal', { date: fm.date(startsAt(Date.now(), c)), n: c.noticeDays })),
        fact(t('st.d.relMorale'), `${fm.percent(c.reliability / 100)} · ${t(`st.level.${moraleLevel(c.morale)}`).toLowerCase()}`),
        fact(t('st.d.base'), c.base),
        fact(t('st.d.premium'), fm.money(c.premium))),
      h('div', { class: 'st-price' }, h('span', { class: 'strong' }, t('st.d.hireSub', { name: c.name, date: fm.date(startsAt(Date.now(), c)) })), h('span', { class: 'strong' }, t('st.d.hirePay', { amount: fm.money(c.askingSalary) }))),
      h('p', { class: 'dim small' }, t('st.d.after', { amount: fm.money(me.company.balance - c.premium) })),
      h('p', { class: 'dim small' }, t('st.d.afterNow', { amount: fm.money(me.company.balance - c.premium - START_NOW_FEE) })),
      h('div', { class: 'st-actions' }, button(t('st.d.hireBtn', { name: c.name }), { variant: 'primary', key: t('key.enter'), disabled: me.company.balance < c.premium, onclick: () => void hire(c) }),
        button(t('st.d.hireNowBtn', { amount: fm.money(START_NOW_FEE) }), { variant: 'secondary', disabled: me.company.balance < c.premium + START_NOW_FEE, onclick: () => void hire(c, true) })));
  };
  const current = list.candidates.find((c) => c.id === selected) ?? null;
  sidePanel.append(current ? offer(current) : panel({ title: t('st.hire.title'), headless: true, id: 'st-offer', class: 'st-side' }, h('p', { class: 'dim' }, t('st.hire.pick'))));

  const view = h('div', { class: 'st-screen' }, h('div', { class: 'st-main' }, header, filters, main), sidePanel);
  return {
    title: t('st.hire.title'), scene: 'login', tab: 'hubs', view, back, hints,
    keys: { t: () => document.querySelector<HTMLElement>('.st-chip[aria-pressed="true"]')?.focus() },
  };
}

export type { CandidatesView };
