import { distanceNm, type FerryPreview, type Me } from '@opc/shared';
import { act } from './actions.ts';
import { airportInfo } from './airports.ts';
import { bookFerry, ferryPreview } from './api-ferry.ts';
import { planeLabel, type Distance, type NoAircraftReason, type Plane } from './board.ts';
import { button, line } from './components.ts';
import { errorText } from './error-text.ts';
import { fmt } from './format.ts';
import { airportField } from './airport-field.ts';
import { codeLabel, t } from './i18n.ts';
import type { Key } from './messages.ts';
import { h } from './ui.ts';

/** A synchronous distance between airports once their coordinates are loaded; null for an airport the server does not know. */
export async function distanceLookup(codes: Iterable<string>): Promise<Distance> {
  const known = new Map((await Promise.all([...new Set(codes)].map(async (c) => [c, await airportInfo(c)] as const))).flatMap(([c, a]) => (a ? [[c, a] as const] : [])));
  return (from, to) => {
    const a = known.get(from), b = known.get(to);
    return a && b ? Math.round(distanceNm(a.lat, a.lon, b.lat, b.lon)) : null;
  };
}

const WHY: Record<NoAircraftReason['kind'], Key> = {
  none: 'ferry.why.none', type: 'ferry.why.type', seats: 'ferry.why.seats', cargo: 'ferry.why.cargo', range: 'ferry.why.range',
  elsewhere: 'ferry.why.elsewhere', far: 'ferry.why.far', arriving: 'ferry.why.arriving', busy: 'ferry.why.busy',
};

/** The sentence that replaces a bare "no eligible aircraft". `origin` is where the job starts. */
export function reasonLine(r: NoAircraftReason, origin: string): string {
  const fm = fmt();
  switch (r.kind) {
    case 'none': case 'busy': return t(WHY[r.kind], { where: origin });
    case 'type': return t(WHY.type, { icao: r.icao });
    case 'seats': return t(WHY.seats, { plane: planeLabel(r.aircraft), have: r.have, need: r.need });
    case 'cargo': return t(WHY.cargo, { plane: planeLabel(r.aircraft), have: fm.kg(r.have), need: fm.kg(r.need) });
    case 'range': return t(WHY.range, { plane: planeLabel(r.aircraft), have: fm.nm(r.have), need: fm.nm(r.need) });
    case 'elsewhere': return t(WHY.elsewhere, { plane: planeLabel(r.aircraft), at: r.aircraft.location, to: origin });
    case 'far': return t(WHY.far, { plane: planeLabel(r.aircraft), at: r.aircraft.location, to: origin, dist: fm.nm(r.distanceNm), range: fm.nm(r.aircraft.type.rangeNm) });
    case 'arriving': return t(WHY.arriving, { plane: planeLabel(r.aircraft), to: origin, time: fm.zulu(r.at) });
  }
}

/** The label of the one-click ferry button: where, what it costs, how long. */
export const ferryLabel = (to: string, p: Pick<FerryPreview, 'cost' | 'hours'>): string => t('ferry.button', { to, cost: fmt().money(p.cost), time: fmt().duration(p.hours) });

/** The server's quote of the ferry flight, as lines, then Confirm / Cancel. Booking refreshes the shell. `onCancel` puts back what was there before. */
export function confirmFerry(host: HTMLElement, a: Plane, to: string, refresh: () => Promise<void>, onCancel: () => void): void {
  const fm = fmt();
  const titleId = `ferry-${a.id}-title`;
  const cancel = button(t('fin.cancel'), { variant: 'secondary', onclick: onCancel });
  const show = (...body: (HTMLElement | null)[]): void => host.replaceChildren(h('div', { class: 'ferry-confirm', role: 'group', 'aria-labelledby': titleId },
    h('h3', { id: titleId, class: 'ferry-title' }, t('ferry.confirm.title', { plane: planeLabel(a), from: a.location, to })), ...body));
  show(h('p', { class: 'dim small', role: 'status' }, t('common.loading')), h('div', { class: 'row' }, cancel));
  void ferryPreview(a.id, to).then((p) => {
    const go = button(t('ferry.confirm.go'), { variant: 'primary', disabled: !p.ok, onclick: () => void act(t('ferry.done', { plane: planeLabel(a), to }), () => bookFerry(a.id, to), refresh) });
    show(
      h('div', { class: 'col tight' }, line(t('ferry.dist'), fm.nm(p.distanceNm)), line(t('ferry.time'), fm.duration(p.hours)),
        line(t('ferry.cost'), h('span', { class: 'strong' }, fm.money(p.cost))), line(t('ferry.arrival'), fm.zulu(p.arrivesAt))),
      p.ok ? null : h('p', { class: 'error-text', role: 'alert' }, codeLabel(p.reason ?? '', 'err')),
      h('div', { class: 'row' }, cancel, go));
    (p.ok ? go : cancel).focus();
  }, (e: unknown) => show(h('p', { class: 'error-text', role: 'alert' }, errorText(e)), h('div', { class: 'row' }, cancel)));
}

/** On the job screen: the ferry button priced by the server's quote; it opens the confirm in place (which quotes again, so the price confirmed is the price booked). */
export function ferryOffer(a: Plane, to: string, p: FerryPreview, refresh: () => Promise<void>): HTMLElement {
  const host = h('div', { class: 'ferry-offer' });
  const open = button(ferryLabel(to, p), { variant: 'primary', icon: 'route', disabled: !p.ok, onclick: () => confirmFerry(host, a, to, refresh, () => { host.replaceChildren(open); open.focus(); }) });
  host.append(open);
  if (!p.ok) host.append(h('p', { class: 'error-text small', role: 'alert' }, codeLabel(p.reason ?? '', 'err')));
  return host;
}

/** In #fleet: pick where to send an idle aircraft (your hubs first, then any ICAO code), see the quote, confirm. */
export function ferryPanel(a: Plane, me: Me, refresh: () => Promise<void>, onClose: () => void): HTMLElement {
  const host = h('div', { class: 'ferry-confirm-host' });
  const choose = (to: string): void => confirmFerry(host, a, to, refresh, () => host.replaceChildren());
  const hubs = me.hubs.filter((c) => c !== a.location);
  const field = airportField(t('ferry.other'), { name: 'ferry-to', id: `ferry-to-${a.id}` });
  const form = h('form', { class: 'row wrap ferry-form', onsubmit: (e: Event) => { e.preventDefault(); if (field.valid()) choose(field.input.value.trim().toUpperCase()); } },
    field.root, button(t('ferry.preview'), { type: 'submit', variant: 'secondary' }));
  const title = h('h3', { class: 'ferry-title' }, t('ferry.pick', { plane: planeLabel(a) }));
  const root = h('div', { class: 'ferry-panel col', role: 'group', 'aria-label': t('ferry.pick', { plane: planeLabel(a) }) },
    title,
    hubs.length > 0 ? h('div', { class: 'row wrap', role: 'group', 'aria-label': t('ferry.hubs') }, hubs.map((c) => button(c, { variant: 'secondary', label: t('ferry.toHub', { to: c }), onclick: () => choose(c) }))) : null,
    form, host, button(t('fin.cancel'), { variant: 'ghost', onclick: onClose }));
  return root;
}
