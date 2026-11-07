import { capacityKg } from '@opc/shared';
import { h } from '../ui.ts';
import { svg } from '../svg.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { deriveCabin, doorCount, layoutCabin, occupiedSeats, type Rect } from '../cabin.ts';
import { fuelVm, loadVm, type Body, type LiveCtx, type LiveFacts } from '../live-view.ts';

const PLAN_W = 1536;
const PLAN_H = 330;
const SEAT_TAKEN = '#8E9196';

const equipment = (value: string, label: string, sub: string): HTMLElement =>
  h('div', { class: 'equip' }, h('div', { class: 'equip-head' }, h('span', { class: 'equip-value' }, value), h('span', { class: 'equip-label' }, label)), h('span', { class: 'equip-sub' }, sub));
const mass = (label: string, value: HTMLElement | string, sub?: HTMLElement | string): HTMLElement =>
  h('div', { class: 'mass' }, h('span', { class: 'live-fact-label' }, label), h('span', { class: 'live-fact-value' }, value), sub ? h('span', { class: 'mass-sub' }, sub) : null);
const rectPath = (r: Rect): string => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`;

/** Cabine & charge: a cabin plan derived from the type's seats (so "estimated"), the real load of the job, and the live fuel. */
export function cabinBody(c: LiveCtx): Body {
  const cfg = deriveCabin(c.type);
  const job = c.flight.job;
  const freight = job.kind === 'cargo';
  const taken = occupiedSeats(cfg.seats, freight ? 0 : Math.min(job.pax, cfg.seats), c.flight.id);
  const lay = layoutCabin(cfg, taken, freight, PLAN_W, PLAN_H);
  const fm = fmt();

  const hull = svg('path', { d: lay.hull, fill: '#0F1114E6', stroke: 'var(--border-strong)', 'stroke-width': 1.5 });
  const doors = svg('path', { d: lay.doors.map((d) => `${rectPath({ x: d.x, y: d.top - 1.5, w: d.w, h: 3 })}${rectPath({ x: d.x, y: d.bottom - 1.5, w: d.w, h: 3 })}`).join(''), fill: 'var(--text-secondary)' });
  const seatsTaken = svg('path', { d: lay.seats.filter((s) => s.taken).map(rectPath).join(''), fill: SEAT_TAKEN });
  const seatsFree = svg('path', { d: lay.seats.filter((s) => !s.taken).map(rectPath).join(''), fill: 'none', stroke: '#FFFFFF4D', 'stroke-width': 1.2 });
  const services = lay.services.map((s) => svg('g', {},
    svg('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 3, fill: '#FFFFFF08', stroke: 'var(--border-strong)' }),
    svg('text', { x: s.x + s.w / 2, y: s.y + s.h / 2 + 3.5, 'text-anchor': 'middle', fill: 'var(--text-secondary)', 'font-size': 10, 'font-weight': 500 }, s.kind === 'lav' ? 'WC' : 'G')));
  const hold = lay.hold ? svg('g', {},
    svg('rect', { x: lay.hold.x, y: lay.hold.y, width: lay.hold.w, height: lay.hold.h, rx: 3, fill: 'none', stroke: 'var(--border-strong)' }),
    svg('text', { x: lay.hold.x + lay.hold.w / 2, y: lay.hold.y + lay.hold.h / 2 - 2, 'text-anchor': 'middle', fill: 'var(--text-tertiary)', 'font-size': 11 }, t('live.cabin.hold')),
    svg('text', { x: lay.hold.x + lay.hold.w / 2, y: lay.hold.y + lay.hold.h / 2 + 14, 'text-anchor': 'middle', fill: 'var(--text-primary)', 'font-size': 13, 'font-weight': 500 }, fm.kg(job.payloadKg))) : null;
  const plan = svg('svg', { viewBox: `0 0 ${PLAN_W} ${PLAN_H}`, width: PLAN_W, height: PLAN_H, role: 'img', 'aria-label': t('live.cabin.class', { n: cfg.seats }) },
    hull, doors, seatsTaken, seatsFree, ...services, hold,
    svg('path', { d: lay.pilots.map(rectPath).join(''), fill: 'var(--text-primary)' }),
    svg('path', { d: lay.crew.map(rectPath).join(''), fill: 'var(--info)' }));

  const legend = (swatch: HTMLElement, label: string): HTMLElement => h('span', { class: 'legend-item' }, swatch, label);
  const sw = (style: string): HTMLElement => h('span', { class: 'swatch', style, 'aria-hidden': 'true' });
  const legendRow = h('div', { class: 'cabin-legend' },
    legend(sw(`background:${SEAT_TAKEN}`), t('live.cabin.legend.taken')), legend(sw('border:1.2px solid #FFFFFF4D'), t('live.cabin.legend.free')),
    lay.crew.length > 0 ? legend(sw('background:var(--info)'), t('live.cabin.legend.crew')) : null,
    lay.pilots.length > 0 ? legend(sw('background:var(--text-primary)'), t('live.cabin.legend.pilots')) : null,
    lay.services.length > 0 ? legend(sw('border:1.5px solid var(--border-strong)'), t('live.cabin.legend.service')) : null);

  const est = t('live.cabin.estimated');
  const nTaken = lay.seats.filter((s) => s.taken).length;
  const equip = h('div', { class: 'cabin-equipment' },
    equipment(String(cfg.lavs), t('live.cabin.lav'), est), equipment(String(cfg.galleys), t('live.cabin.galley'), est),
    equipment(fm.num(cfg.seats), t('live.cabin.seats'), freight ? est : `${tp('live.cabin.taken', nTaken)} · ${est}`),
    equipment(String(doorCount(cfg)), t('live.cabin.doors'), est));

  const cap = capacityKg(c.type);
  const carried = h('span', { class: 'live-fact-value' });
  const fuelV = h('span', { class: 'live-fact-value' });
  const fuelSub = h('span', { class: 'mass-sub' });
  const carriedSub = t('live.mass.carriedSub');
  const update = (f: LiveFacts): void => {
    const load = loadVm(job, cap, f.fuelKg);
    carried.textContent = load.carriedKg === null ? '–' : fm.kg(load.carriedKg);
    fuelV.textContent = f.fuelKg === null ? '–' : fm.kg(f.fuelKg);
    const arrival = f.fuelKg === null ? null : fuelVm(c.type, f.fuelKg, f.gsKts, f.remainingNm).arrivalKg;
    fuelSub.textContent = arrival === null ? '' : t('live.mass.fuelSub', { kg: fm.kg(arrival) });
  };

  const strip = h('div', { class: 'weight-balance' },
    mass(t('live.mass.payload'), fm.kg(job.payloadKg), t('live.mass.max', { kg: fm.kg(cap) })),
    mass(t('live.mass.carried'), carried, carriedSub),
    h('div', { class: 'mass' }, h('span', { class: 'live-fact-label' }, t('live.mass.fuel')), fuelV, fuelSub),
    h('div', { class: 'cg' },
      h('div', { class: 'cg-head' }, h('span', { class: 'live-fact-label' }, t('live.mass.cg')), h('span', { class: 'cg-value' }, t('live.mass.cgNone'))),
      h('span', { class: 'mass-sub' }, t('live.mass.cgSub'))));
  update({ settled: false, sample: null, receivedAt: null, lost: false, silentMs: null, phase: 'unknown', altitude: null, gsKts: null, fuelKg: null, remainingNm: null, etaAt: null, checks: [], engines: [] });

  const el = h('div', { class: 'cabin-stage' }, h('div', { class: 'cabin-plan' }, plan, legendRow, h('p', { class: 'dim small cabin-note' }, t('live.cabin.note'))), equip, strip);
  return { el, update };
}
