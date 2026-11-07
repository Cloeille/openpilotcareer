import { act } from '../actions.ts';
import { bookCourse, fetchTraining, type CentreView, type CourseView, type PilotRef, type TrainOffer, type TrainPlace, type TrainingView } from '../api-training.ts';
import { button, icon, panel, signLocation, stat, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { meterBar, roleShort, staffOff, viewSwitch } from '../staff-ui.ts';
import { MODES, OWN_WHY, basesOf, canAfford, convertibleAt, defaultPlace, keepOffer, nextMode, offerKey, offersAt, seatFraction, seatTone, stepBase, type TrainMode } from '../training-view.ts';
import { h } from '../ui.ts';

/** The mode, the base filter and the offer in focus survive a redraw (a booking, a language change), not a new visit. */
const memo: { mode: TrainMode; base: string | null; offer: string | null } = { mode: 'trainees', base: null, offer: null };

const off = (): HTMLElement => h('div', { class: 'ln-off st-off panel' }, h('div', { class: 'panel-body' }, icon('users', 20), h('h1', { class: 'ln-off-title' }, t('tr.off.title')), h('p', { class: 'muted' }, t('tr.off.body'))));

/** `#staff/training`: who can be trained on what and at which price, the seats of the centre, its instructors and the captains who could become one. A course is the staff lot's type rating: the centre makes it cheaper and shorter. */
export async function staffTraining(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
  const back = '#staff';
  const hints = [{ key: t('key.esc'), label: t('tr.hint.staff') }, { key: 'T', label: t('tr.hint.mode') }, { key: '← →', label: t('tr.hint.base') }, { key: '↑ ↓', label: t('tr.hint.row') }, { key: t('key.enter'), label: t('tr.hint.plan') }];
  const data = await fetchTraining();
  if (!data) return { title: t('tr.title'), scene: 'login', tab: 'hubs', back, hints: hints.slice(0, 1), view: staffOff() };

  const bases = basesOf(data);
  if (memo.base !== null && !bases.includes(memo.base)) memo.base = null;
  const offers = offersAt(data.offers, memo.base);
  memo.offer = keepOffer(offers, memo.offer);
  const seatsTotal = data.centres.reduce((n, c) => n + c.seats, 0), seatsUsed = data.centres.reduce((n, c) => n + c.used, 0);
  const mainHub = me.hubs[0] ?? null;

  // ------------------------------------------------------------ header
  const header = h('div', { class: 'ln-header' },
    titleBlock(h('span', { class: 'row tight' }, signLocation(memo.base ?? mainHub ?? '—'), h('span', { class: 'dim' }, t('tr.crumb'))), t('tr.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('tr.sub'))),
    viewSwitch('training', go));
  const kpis = h('div', { class: 'ln-kpis st-kpis' },
    stat(t('tr.stat.running'), fm.num(data.running), tp('tr.stat.running.sub', data.running)),
    stat(t('tr.stat.seats'), data.centres.length === 0 ? '—' : `${fm.num(seatsUsed)} / ${fm.num(seatsTotal)}`, t('tr.stat.seats.sub')),
    stat(t('tr.stat.saved'), fm.money(data.savedYear), t('tr.stat.saved.sub')),
    stat(t('tr.stat.cost'), fm.money(data.centres.reduce((n, c) => n + c.monthly, 0)), t('tr.stat.cost.sub')));

  // ------------------------------------------------------------ filters
  const chip = (id: string, label: string, on: boolean, pick: () => void, mono = false): HTMLElement =>
    h('button', { type: 'button', id, class: `st-chip${mono ? ' mono' : ''}`, 'aria-pressed': String(on), onclick: pick }, label);
  const filters = h('div', { class: 'st-filters', role: 'group', 'aria-label': t('tr.hint.mode') },
    h('div', { class: 'st-fgroup', role: 'group', 'aria-label': t('tr.f.view') },
      MODES.map((m) => chip(`tr-mode-${m}`, t(m === 'trainees' ? 'tr.mode.trainees' : 'tr.mode.instructors'), memo.mode === m, () => { memo.mode = m; redraw(); }))),
    bases.length > 1 ? h('div', { class: 'st-fgroup', role: 'group', 'aria-label': t('tr.f.base') }, h('span', { class: 'dim small' }, t('tr.f.base')),
      chip('tr-base-all', t('st.allBases'), memo.base === null, () => { memo.base = null; redraw(); }),
      bases.map((b) => chip(`tr-base-${b}`, b, memo.base === b, () => { memo.base = b; redraw(); }, true))) : null);

  // ------------------------------------------------------------ the centre
  const centreRow = (c: CentreView): HTMLElement => h('li', { class: 'tr-centre' },
    h('div', { class: 'row tight' }, signLocation(c.hub), h('span', { class: 'strong' }, t('tr.centre.name'))),
    h('div', { class: 'tr-seats' }, h('span', { class: 'muted small' }, t('tr.centre.seats', { used: c.used, seats: c.seats })),
      meterBar(seatFraction(c), seatTone(c), t('tr.centre.seats', { used: c.used, seats: c.seats }))),
    h('p', { class: 'dim small' }, `${tp('tr.centre.teachers', c.instructors)} · ${t('tr.centre.cost', { amount: fm.money(c.monthly) })}`),
    c.instructors === 0 ? h('p', { class: 'st-warn small' }, t('tr.centre.noTeacher')) : null);
  const noCentre = h('div', { class: 'col' },
    h('p', { class: 'dim small' }, t('tr.centre.none')),
    mainHub ? button(t('tr.centre.rent', { hub: mainHub }), { variant: 'secondary', icon: 'door-open', onclick: () => go(`#hub/${mainHub}`) }) : null);
  const centres = panel({ title: t('tr.centre.title'), id: 'tr-centres', class: 'ag-side-panel' },
    data.centres.length === 0 ? noCentre : h('ul', { class: 'plain tr-centres' }, data.centres.filter((c) => memo.base === null || c.hub === memo.base).map(centreRow)));

  // ------------------------------------------------------------ pilots to train
  const book = (o: TrainOffer, place: TrainPlace): void => {
    const course = place === 'own' ? o.own : o.outside;
    if (!confirm(t('tr.confirm', { name: o.name, type: o.typeName, days: course.days, cost: fm.money(course.cost), where: t(place === 'own' ? 'tr.place.own' : 'tr.place.outside') }))) return;
    void act(t('tr.booked', { name: o.name, type: o.typeName }), () => bookCourse(o.staffId, o.type, place), async () => { await ctx.refresh(); });
  };
  const cheapest = (o: TrainOffer): string => (o.ownWhy === null ? t('tr.row.own', { cost: fm.money(o.own.cost), days: o.own.days }) : t(OWN_WHY[o.ownWhy]));
  const pick = (o: TrainOffer): void => {
    memo.offer = offerKey(o);
    for (const el of document.querySelectorAll<HTMLElement>('.tr-offer')) el.setAttribute('aria-selected', String(el.dataset.key === memo.offer));
    side.replaceChildren(offerPanel(o));
  };
  const rowOf = (o: TrainOffer): HTMLElement => h('tr', {
    class: 'tr-offer', 'data-row': '', 'data-key': offerKey(o), tabindex: 0, 'aria-selected': String(offerKey(o) === memo.offer),
    'aria-label': t('tr.row.label', { name: o.name, type: o.typeName, outside: fm.money(o.outside.cost), own: o.ownWhy === null ? fm.money(o.own.cost) : t(OWN_WHY[o.ownWhy]) }),
    onfocus: () => pick(o), onclick: () => pick(o),
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); pick(o); side.querySelector<HTMLElement>('[data-primary]')?.focus(); } } },
    h('th', { scope: 'row' }, h('span', { class: 'strong' }, o.name), ' ', h('span', { class: 'dim small mono' }, o.base)),
    h('td', null, o.typeName),
    h('td', { class: 'end' }, t('tr.row.outside', { cost: fm.money(o.outside.cost), days: o.outside.days })),
    h('td', { class: o.ownWhy === null ? 'end' : 'end dim' }, cheapest(o)));
  const offersTable = offers.length === 0
    ? h('p', { class: 'dim st-empty' }, t('tr.offers.empty'))
    : h('div', { class: 'scroll', role: 'region', 'aria-label': t('tr.offers.title'), tabindex: 0 }, h('table', { class: 'data tr-offers' },
      h('caption', { class: 'sr' }, t('tr.offers.title')),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('tr.col.pilot')), h('th', { scope: 'col' }, t('tr.col.type')), h('th', { scope: 'col', class: 'end' }, t('tr.col.outside')), h('th', { scope: 'col', class: 'end' }, t('tr.col.own')))),
      h('tbody', null, offers.map(rowOf))));
  const offersPanel = panel({ title: t('tr.offers.title'), action: t('tr.offers.sub'), id: 'tr-offers', class: 'st-panel' }, offersTable);

  const side = h('div', { class: 'st-side-host' });
  const offerPanel = (o: TrainOffer): HTMLElement => {
    const place = defaultPlace(o);
    const pay = (course: { cost: number }, p: TrainPlace): HTMLElement => button(t(p === 'own' ? 'tr.book.own' : 'tr.book.outside', { cost: fm.money(course.cost) }), {
      variant: p === place ? 'primary' : 'secondary', key: p === place ? t('key.enter') : undefined, icon: p === 'own' ? 'door-open' : 'plane-takeoff',
      disabled: (p === 'own' && o.ownWhy !== null) || !canAfford(course.cost, me.company.balance), onclick: () => book(o, p) });
    const cost = (label: string, c: { cost: number; days: number }, note: string | null): HTMLElement => h('div', { class: 'tr-cost' },
      h('span', { class: 'muted' }, label), h('span', { class: 'tr-cost-value' }, fm.money(c.cost)), h('span', { class: 'dim small' }, tp('tr.days', c.days)), note ? h('span', { class: 'st-warn small' }, note) : null);
    return panel({ title: t('tr.plan.title'), id: 'tr-plan', class: 'ag-side-panel' },
      h('p', { class: 'strong' }, `${o.name} · ${o.typeName}`),
      h('div', { class: 'tr-costs' }, cost(t('tr.place.own'), o.own, o.ownWhy === null ? null : t(OWN_WHY[o.ownWhy])), cost(t('tr.place.outside'), o.outside, null)),
      h('p', { class: 'dim small' }, o.ownWhy === null ? t('tr.plan.saves', { amount: fm.money(o.saved) }) : t('tr.plan.cannot')),
      h('p', { class: 'dim small' }, t('tr.plan.leave')),
      h('div', { class: 'row' }, pay(o.own, 'own'), pay(o.outside, 'outside')),
      !canAfford(Math.min(o.outside.cost, o.ownWhy === null ? o.own.cost : Infinity), me.company.balance) ? h('p', { class: 'st-warn small' }, t('tr.plan.short')) : null);
  };
  const selected = offers.find((o) => offerKey(o) === memo.offer) ?? null;
  side.append(selected ? offerPanel(selected) : panel({ title: t('tr.plan.title'), id: 'tr-plan', class: 'ag-side-panel' }, h('p', { class: 'dim small' }, t('tr.plan.none'))));

  // ------------------------------------------------------------ instructors
  const open = (p: PilotRef): void => go(hashFor('retrain', p.staffId));
  const person = (p: PilotRef, to: string): HTMLElement => h('li', { class: 'tr-person', 'data-row': '', tabindex: 0, 'aria-label': t('tr.person.label', { name: p.name, role: roleShort(p.role) }), onclick: () => go(to),
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); go(to); } } },
    icon('circle-check', 16),
    h('span', { class: 'col tight' }, h('span', { class: 'strong' }, `${p.name} · ${roleShort(p.role)}`),
      h('span', { class: 'dim small' }, `${p.base} · ${p.types.join(', ') || '—'}${p.age !== null ? ` · ${t('tr.person.age', { age: p.age })}` : ''}`)),
    p.retiresAt === null ? null : h('span', { class: p.inWindow ? 'st-warn small' : 'dim small' }, t('tr.person.retires', { date: fm.date(p.retiresAt) })));
  const instructors = data.instructors.filter((p) => memo.base === null || p.base === memo.base);
  const convertible = convertibleAt(data.convertible, memo.base);
  const instructorsPanel = panel({ title: t('tr.ins.title'), action: tp('tr.ins.count', instructors.length), id: 'tr-instructors', class: 'st-panel' },
    instructors.length === 0 ? h('p', { class: 'dim st-empty' }, t('tr.ins.empty')) : h('ul', { class: 'plain tr-people' }, instructors.map((p) => person(p, hashFor('staff', p.staffId)))),
    h('h3', { class: 'ln-sub-title' }, t('tr.cand.title')),
    convertible.length === 0 ? h('p', { class: 'dim small' }, t('tr.cand.empty')) : h('ul', { class: 'plain tr-people' }, convertible.map((p) => person(p, hashFor('retrain', p.staffId)))),
    convertible.length > 0 ? button(t('tr.cand.open', { name: convertible[0]!.name }), { variant: 'secondary', icon: 'users', onclick: () => open(convertible[0]!) }) : null);

  // ------------------------------------------------------------ the course planning
  const courseRow = (c: CourseView): HTMLElement => h('li', { class: `tr-course${c.running ? ' running' : ''}` },
    icon(c.running ? 'clock' : 'circle-check', 16),
    h('span', { class: 'col tight' }, h('span', { class: 'strong' }, `${c.name} · ${c.type}`),
      h('span', { class: 'dim small' }, `${c.base} · ${t(c.place === 'own' ? 'tr.place.own' : 'tr.place.outside')} · ${t(c.running ? 'tr.course.until' : 'tr.course.ended', { date: fm.date(c.endAt) })}`)),
    h('span', { class: 'col tight end' }, h('span', { class: 'strong' }, fm.money(c.cost)), c.saved > 0 ? h('span', { class: 'dim small' }, t('tr.course.saved', { amount: fm.money(c.saved) })) : null));
  const courses = data.courses.filter((c) => memo.base === null || c.base === memo.base);
  const coursesPanel = panel({ title: t('tr.courses.title'), action: tp('tr.courses.count', courses.filter((c) => c.running).length), id: 'tr-courses', class: 'st-panel' },
    courses.length === 0 ? h('p', { class: 'dim st-empty' }, t('tr.courses.empty')) : h('ul', { class: 'plain tr-courses' }, courses.map(courseRow)));

  const main = memo.mode === 'trainees' ? [offersPanel, coursesPanel] : [instructorsPanel, coursesPanel];
  const view = h('div', { class: 'ag-screen' }, h('div', { class: 'ag-main' }, header, kpis, filters, ...main), h('div', { class: 'ag-side' }, centres, memo.mode === 'trainees' ? side : null));
  const step = (dir: 1 | -1): void => { memo.base = stepBase(bases, memo.base, dir); redraw(); };
  return { title: t('tr.title'), scene: 'login', tab: 'hubs', view, back, hints, keys: { t: () => { memo.mode = nextMode(memo.mode); redraw(); }, left: () => step(-1), right: () => step(1) } };
}
