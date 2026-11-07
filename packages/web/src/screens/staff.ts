import { fetchStaff, type FamilyRow, type StaffOverview, type Blocker } from '../api-staff.ts';
import { button, icon, panel, signLocation, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { availabilitySegments, blockerFamily, blockerOf, defaultExpanded, defaultRow, presetFor, rowBadge, toggleAll, visibleRows, type RowBadge, type VisibleRow } from '../staff-view.ts';
import { famLabel, famSub, hireFilter, staffOff, toneIcon, viewSwitch } from '../staff-ui.ts';
import { h } from '../ui.ts';

/** The families the player has opened and the base filter survive a redraw (a poll or a language change), not a new visit. */
let opened: Set<string> | null = null;
let base: string | null = null;
let focused: string | null = null;

const BADGE_TEXT = (b: RowBadge): string => {
  switch (b.kind) {
    case 'blocks': return tp('st.b.blocks', b.flights);
    case 'none': return t('st.b.none');
    case 'note': return b.note;
    case 'missing': return tp('st.b.missing', b.n);
    case 'complete': return t('st.b.complete');
  }
};

const rowLabel = (r: FamilyRow): string => (r.type ? r.label : famLabel(r.family));

/** `#staff`: headcount against the timetable, family by family, with what blocks flights beside it. */
export async function staff(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const back = '#hubs';
  const data = await fetchStaff(base ?? undefined);
  if (!data) return { title: t('st.ov.title'), scene: 'dashboard', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('st.hint.company') }], view: staffOff() };

  const expanded = (opened ??= defaultExpanded(data.families, data.blockers));
  const rows = (): VisibleRow[] => visibleRows(data.families, expanded);
  if (focused === null || !rows().some((r) => r.key === focused)) focused = defaultRow(rows(), data.blockers);
  const toggle = (key: string): void => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); redraw(); };

  // ------------------------------------------------------------ header
  const bases = me.hubs;
  const header = h('div', { class: 'ln-header' },
    titleBlock(h('span', { class: 'row tight' }, bases.map(signLocation), h('span', null, t('st.ov.company', { company: me.company.name }))), t('st.ov.title'),
      h('p', { class: 'muted', style: 'font-size:14px' }, tp('st.ov.sub', data.people, { positions: fm.num(data.positions), payroll: fm.money(data.payroll) }))),
    viewSwitch('staff', go));

  // ------------------------------------------------------------ the table
  const bar = (r: FamilyRow): HTMLElement => {
    const segs = availabilitySegments(r.availability);
    const blocked = r.type !== undefined && blockerOf(data.blockers, r) !== null;
    return h('span', { class: 'st-bar', role: 'img', 'aria-label': availabilityText(r) },
      segs.map((s) => h('i', { class: `st-seg ${s.kind === 'vacant' && blocked ? 'blocks' : s.kind}`, style: `flex:${s.count} 0 0` })));
  };
  const availabilityText = (r: FamilyRow): string => {
    const a = r.availability;
    return [a.onDuty && t('st.avail.duty', { n: a.onDuty }), a.free && t('st.avail.free', { n: a.free }), a.resting && t('st.avail.rest', { n: a.resting }), a.leave && t('st.avail.leave', { n: a.leave }), a.training && t('st.avail.training', { n: a.training }), a.vacant && t('st.avail.vacant', { n: a.vacant })].filter(Boolean).join(' · ');
  };
  const line = (v: VisibleRow): HTMLElement => {
    const r = v.row;
    const b = rowBadge(r, data.blockers);
    const name = rowLabel(r);
    const child = v.depth === 1;
    const on = (): void => { focused = v.key; panelHost.replaceChildren(...side(v)); markFocused(); };
    const el = h('div', { class: `st-row${child ? ' child' : ''}${v.expanded ? ' open' : ''}${b.tone === 'bad' && child ? ' bad' : ''}`, 'data-row': '', 'data-key': v.key, role: 'row', tabindex: 0, 'aria-selected': String(focused === v.key),
      'aria-expanded': v.expandable ? String(v.expanded) : null, 'aria-label': `${name}, ${r.headcount} / ${r.need}, ${BADGE_TEXT(b)}`,
      onfocus: on, onclick: () => { on(); if (v.expandable) toggle(v.key); },
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && v.expandable) { e.preventDefault(); toggle(v.key); } } },
      h('span', { class: 'st-fam' }, v.expandable ? icon(v.expanded ? 'chevron-down' : 'chevron-right', 16) : (child ? null : h('span', { class: 'st-chev-gap' })),
        h('span', { class: 'col tight' }, h('span', { class: child ? 'st-name child' : 'st-name' }, name), child ? null : h('span', { class: 'dim small' }, famSub(r.family)))),
      h('span', { class: 'st-count' }, h('span', { class: child ? 'st-have child' : 'st-have' }, fm.num(r.headcount)), h('span', { class: 'dim' }, `/ ${fm.num(r.need)}`)),
      h('span', { class: 'st-avail' }, bar(r), child ? null : h('span', { class: 'dim small' }, availabilityText(r))),
      h('span', { class: `st-pay${child ? ' muted' : ''}` }, fm.money(r.salaries)),
      h('span', { class: `st-state ${b.tone}` }, toneIcon(b.tone), h('span', null, BADGE_TEXT(b))));
    return el;
  };
  const markFocused = (): void => { for (const el of document.querySelectorAll<HTMLElement>('.st-row')) el.setAttribute('aria-selected', String(el.dataset.key === focused)); };
  const allOpen = data.families.filter((f) => f.children?.length).every((f) => expanded.has(f.family));
  const expandAll = h('button', { type: 'button', class: 'link-btn st-expand-all', onclick: () => { opened = toggleAll(data.families, expanded); redraw(); } }, allOpen ? t('st.ov.collapseAll') : t('st.ov.expandAll'));
  const head = h('div', { class: 'st-head', 'aria-hidden': 'true' }, [t('st.col.family'), t('st.col.count'), t('st.col.avail'), t('st.col.pay'), ''].map((c, i) => h('span', { class: i === 1 || i === 3 ? 'end' : '' }, c)));
  // No family at all: nobody is employed and no timetable needs anyone. Headers over a blank panel say nothing, so the panel says so and offers the way out.
  const empty = data.families.length === 0;
  const emptyState = h('div', { class: 'st-empty-state' }, icon('users', 20),
    h('h3', { class: 'st-empty-title' }, base ? t('st.ov.emptyBaseTitle', { base }) : t('st.ov.emptyTitle')),
    h('p', { class: 'muted' }, base ? t('st.ov.emptyBase') : t('st.ov.empty')),
    button(t('st.side.recruit'), { variant: 'primary', icon: 'users', key: 'R', onclick: () => goHire(null) }));
  const table = panel({ title: t('st.ov.panel'), action: data.families.some((f) => f.children?.length) ? expandAll : null, id: 'st-table', class: 'st-panel' },
    ...(empty ? [emptyState] : [head, h('div', { class: 'st-rows', role: 'table', 'aria-label': t('st.ov.panel') }, rows().map(line))]));

  // ------------------------------------------------------------ legend and base filter
  const legendItems: [string, Key][] = [['duty', 'st.leg.duty'], ['rest', 'st.leg.rest'], ['leave', 'st.leg.leave'], ['training', 'st.leg.training'], ['vacant', 'st.leg.vacant'], ['blocks', 'st.leg.blocks']];
  const legend = h('div', { class: 'st-legend' }, legendItems.map(([k, key]) => h('span', { class: 'ln-legend-item' }, h('i', { class: `st-seg ${k} sw`, 'aria-hidden': 'true' }), t(key))));
  const baseChip = (value: string | null, label: string): HTMLElement =>
    h('button', { type: 'button', class: 'seg st-chip', 'aria-pressed': String(base === value), onclick: () => { base = value; opened = null; focused = null; redraw(); } }, label);
  const filter = h('div', { class: 'segments st-chips', role: 'group', 'aria-label': t('st.bases') }, baseChip(null, t('st.allBases')), bases.map((b) => baseChip(b, b)));
  const foot = h('div', { class: 'st-foot' }, legend, filter);

  // ------------------------------------------------------------ the side panel follows the focused row
  const panelHost = h('div', { class: 'st-side-host' });
  const goHire = (v: VisibleRow | null): void => {
    const blocker = v ? blockerOf(data.blockers, v.row) : (data.blockers[0] ?? null);
    const preset = presetFor(v?.row ?? null, blocker);
    Object.assign(hireFilter, { family: preset.family, qual: preset.qual, base });
    go('#staff/hire');
  };
  const side = (v: VisibleRow | null): Node[] => sidePanel(data, v, goHire, go);
  const current = rows().find((r) => r.key === focused) ?? null;
  panelHost.append(...side(current));

  const view = h('div', { class: 'st-screen' }, h('div', { class: 'st-main' }, header, table, foot), panelHost);

  const recruit = (): void => goHire(rows().find((r) => r.key === focused) ?? null);
  return {
    title: t('st.ov.title'), scene: 'dashboard', tab: 'hubs', view, back, wide: false,
    hints: [{ key: t('key.esc'), label: t('st.hint.company') }, { key: '↑ ↓', label: t('st.hint.family') }, { key: t('key.enter'), label: t('st.hint.expand') }, { key: 'R', label: t('st.hint.recruit') }],
    keys: { r: recruit },
  };
}

function sidePanel(data: StaffOverview, v: VisibleRow | null, goHire: (v: VisibleRow | null) => void, go: (hash: string) => void): Node[] {
  const fm = fmt();
  const blocker: Blocker | null = v ? blockerOf(data.blockers, v.row) : (data.blockers[0] ?? null);
  const row = v?.row ?? null;
  const members = row?.members ?? [];
  const watch = data.watch;
  const recruitLabel = row?.type ? t('st.side.recruitType', { type: row.label }) : row ? t('st.side.recruitFamily', { family: famLabel(row.family) }) : t('st.side.recruit');

  const heading = blocker
    ? [h('span', { class: 'st-eyebrow bad' }, icon('ban', 14), t('st.side.blocks')), h('h2', { class: 'st-side-title' }, blocker.kind === 'no_crew' ? t('st.side.noCrew', { what: row?.type ? row.label : famLabel(blockerFamily(blocker)) }) : t('st.side.dutyLimit', { what: row?.type ? row.label : famLabel(blockerFamily(blocker)) })), h('p', { class: 'muted' }, t(blocker.kind === 'no_crew' ? 'st.side.noCrewBody' : 'st.side.dutyBody', { type: row?.type ? row.label : blocker.type, n: blocker.flights })),
      h('dl', { class: 'st-facts' }, h('dt', null, t('st.side.cancelled')), h('dd', null, tp('st.side.flights', blocker.flights)))]
    : row
      ? [h('span', { class: 'st-eyebrow' }, icon('users', 14), t('st.side.row')), h('h2', { class: 'st-side-title' }, rowLabel(row)),
        h('dl', { class: 'st-facts' }, h('dt', null, t('st.col.count')), h('dd', null, `${fm.num(row.headcount)} / ${fm.num(row.need)}`), h('dt', null, t('st.col.pay')), h('dd', null, fm.money(row.salaries)))]
      : [h('h2', { class: 'st-side-title' }, t('st.ov.title'))];

  const watchBlock = h('section', { class: 'st-watch', 'aria-labelledby': 'st-watch-title' }, h('h3', { class: 'ln-sub-title', id: 'st-watch-title' }, t('st.side.watch')),
    watch.length === 0 ? h('p', { class: 'dim small' }, t('st.side.noWatch'))
      : h('ul', { class: 'plain' }, watch.map((w) => h('li', { class: 'st-watch-item' }, icon('triangle-alert', 14), h('div', { class: 'col tight' }, h('span', null, w.name), h('span', { class: 'dim small' }, w.detail),
        w.staffId ? h('button', { type: 'button', class: 'link-btn', onclick: () => go(hashFor('staff', w.staffId)) }, t('st.side.sheet', { name: w.name })) : null)))));

  const people = members.length > 0 ? h('section', { 'aria-labelledby': 'st-members' }, h('h3', { class: 'ln-sub-title', id: 'st-members' }, t('st.side.members', { type: row?.label ?? '' })),
    h('ul', { class: 'plain st-members' }, members.map((m) => h('li', null, h('button', { type: 'button', class: 'link-btn', onclick: () => go(hashFor('staff', m.id)) }, `${m.name} · ${t(`st.role.${m.role}` as Key)}`))))) : null;

  return [panel({ title: t('st.side.title'), headless: true, id: 'st-side', class: 'st-side' },
    ...heading, people, watchBlock,
    h('div', { class: 'st-actions' }, button(recruitLabel, { variant: 'primary', key: 'R', onclick: () => goHire(v) }),
      row?.type ? button(t('st.side.train', { type: row.label }), { variant: 'ghost', onclick: () => { Object.assign(hireFilter, presetFor(row, blocker), { base: null }); go('#staff/hire'); } }) : null))];
}
