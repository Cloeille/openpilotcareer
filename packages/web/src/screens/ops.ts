import { act } from '../actions.ts';
import { fetchOps, setNetworkEnabled, type OpsView, type OpsRow } from '../api-lines.ts';
import { button, icon, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import { clockGroup, featureOff } from '../lines-ui.ts';
import { causeKey, clockNow, filterOps, firstAlert, inService, nextFilter, NETWORK_TAB, opsBadge, phaseOf, progressPct, OPS_FILTERS, type OpsBadge, type OpsFilter } from '../lines-view.ts';
import { pollWhileShown } from '../live-poll.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

const POLL_OPS_MS = 5000;
let filter: OpsFilter = 'all';
let selected: number | null = null;

const BADGE_ICON = { ontime: 'circle-check', delayed: 'clock', cancelled: 'circle-x', mine: 'user' } as const;
const badge = (b: OpsBadge, delayMin: number): HTMLElement => h('span', { class: `ln-badge ${b}` }, icon(BADGE_ICON[b], 12), t(`ln.ops.b.${b}` as Key, { n: delayMin }));

/** The cause of a row in plain words: the translated cause for a cancellation, the server's note otherwise. */
const noteOf = (r: OpsRow): string | null => {
  const key = causeKey(r.cancelCause);
  if (r.status === 'cancelled' && key) return r.note ?? t(`ln.cause.${key}` as Key);
  return r.note;
};

/** `#ops`: every flight of the day on one board: in the air, next departures with aircraft and crew, and why a flight does not go. */
export async function ops(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const data = await fetchOps();
  if (!data) return { title: t('ln.ops.title'), scene: 'history', tab: NETWORK_TAB, back: '#network', hints: [{ key: t('key.esc'), label: t('ln.hint.network') }], view: featureOff('ln.off.title') };
  const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

  let current: OpsView = data;
  let at = Date.now();
  const clock = clockGroup(data.enabled, (on) => void act(t(on ? 'ln.auto.on' : 'ln.auto.off'), () => setNetworkEnabled(on), async () => redraw()));
  const paintClock = (): void => clock.set(clockNow(current.now, at, Date.now()), current.enabled);

  const { running, total } = inService(me.fleet);
  const header = h('div', { class: 'ln-header' },
    titleBlock(h('span', { class: 'row tight' }, h('span', { class: `dot${data.enabled ? '' : ' idle'}` }), data.enabled ? t('ln.net.status', { running, total }) : t('ln.net.statusOff')), t('ln.ops.title')), clock.root);

  const counts = h('p', { class: 'dim small', 'aria-live': 'polite' });
  const body = h('div', { class: 'ln-ops-body' });
  const filterBar = h('div', { class: 'segments ln-filters', role: 'group', 'aria-label': t('ln.ops.filters') });

  const rowEl = (r: OpsRow, kind: 'flying' | 'upcoming'): HTMLElement => {
    const b = opsBadge(r);
    const note = noteOf(r);
    const id = `ln-ops-${r.id}`;
    const pct = progressPct(r, clockNow(current.now, at, Date.now()));
    const progress = h('span', { class: 'ln-prog' }, h('span', { class: 'ln-prog-track', style: `--p:${pct}%` }, h('i', { class: r.own ? 'mine' : '' })), h('span', { class: 'dim small' }, r.own && r.note ? r.note : t(`ln.ops.phase.${phaseOf(pct / 100)}` as Key)));
    return h('tr', { id, class: `ln-ops-row${r.status === 'cancelled' ? ' cancelled' : ''}${selected === r.id ? ' picked' : ''}`, 'data-row': '', tabindex: 0, 'aria-label': `${r.flightNo} ${r.origin} → ${r.dest}`,
      onfocus: () => { selected = r.id; }, onclick: () => { selected = r.id; if (r.lineId) go(hashFor('line', r.lineId)); }, onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && r.lineId) { e.preventDefault(); go(hashFor('line', r.lineId)); } } },
    h('th', { scope: 'row', class: 'mono' }, fm.zulu(r.dep + r.delayMin * 60_000)),
    h('td', null, r.flightNo), h('td', { class: 'mono' }, `${r.origin} → ${r.dest}`),
    h('td', null, h('span', { class: 'mono' }, r.reg), ' ', h('span', { class: 'dim' }, r.typeName)),
    h('td', null, kind === 'flying' ? progress : h('span', { class: note ? 'muted' : 'dim' }, note ?? r.crew ?? '–')),
    h('td', { class: 'end' }, badge(b, r.delayMin)));
  };
  const section = (title: string, third: string, rows: OpsRow[], kind: 'flying' | 'upcoming', empty: string): HTMLElement =>
    h('section', { class: 'ln-ops-section', 'aria-label': title },
      rows.length === 0 ? h('div', null, h('h3', { class: 'ln-sub-title' }, title), h('p', { class: 'dim small ln-ops-empty' }, empty))
        : h('table', { class: 'data ln-ops-table' }, h('caption', { class: 'sr' }, title),
          h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'ln-ops-title' }, title), [t('ln.ops.col.flight'), t('ln.ops.col.route'), t('ln.ops.col.aircraft'), third].map((c) => h('th', { scope: 'col' }, c)), h('th', { scope: 'col' }, h('span', { class: 'sr' }, t('ln.ops.col.status'))))),
          h('tbody', null, rows.map((r) => rowEl(r, kind)))));

  const paint = (): void => {
    const flying = filterOps(current.flying, filter), upcoming = filterOps(current.upcoming, filter);
    const c = current.counts;
    counts.textContent = t('ln.ops.counts', { flying: c.flying, upcoming: c.upcoming, delayed: c.delayed, cancelled: c.cancelled });
    filterBar.replaceChildren(...OPS_FILTERS.map((f) => h('button', { type: 'button', class: 'seg', 'aria-pressed': String(f === filter), onclick: () => { filter = f; paint(); } }, t(`ln.ops.f.${f}` as Key))));
    body.replaceChildren(
      section(t('ln.ops.flying'), t('ln.ops.col.progress'), flying, 'flying', t('ln.ops.noFlying')),
      section(t('ln.ops.upcoming'), t('ln.ops.col.crew'), upcoming, 'upcoming', current.upcoming.length === 0 ? t('ln.ops.noUpcoming') : t('ln.ops.noMatch')));
    paintClock();
  };
  paint();

  const alert = firstAlert(current.upcoming);
  const treat = (): void => { const a = firstAlert(current.upcoming); if (a?.lineId) go(hashFor('line', a.lineId)); };
  const view = h('div', { class: 'ln-ops' }, header,
    panel({ title: t('ln.ops.board'), action: filterBar, id: 'ln-ops-board', class: 'ln-ops-panel' },
      alert ? h('div', { class: 'ln-alert', role: 'status' }, icon('triangle-alert', 16), h('span', null, t('ln.ops.alert', { no: alert.flightNo })), button(t('ln.ops.treat'), { variant: 'secondary', key: t('key.enter'), onclick: treat })) : null,
      counts, body));

  pollWhileShown('ln-clock', view, async () => paintClock(), 1000);
  pollWhileShown('ln-ops', view, async () => {
    const fresh = await fetchOps();
    if (!fresh) return;
    const sig = (o: OpsView): string => [...o.flying, ...o.upcoming].map((r) => `${r.id}${r.status}${r.delayMin}${r.note ?? ''}`).join();
    const changed = sig(fresh) !== sig(current);
    current = fresh; at = Date.now();
    if (changed) paint(); else paintClock();
  }, POLL_OPS_MS);

  return {
    title: t('ln.ops.title'), scene: 'history', tab: NETWORK_TAB, view, back: '#network', wide: false,
    hints: [{ key: t('key.esc'), label: t('ln.hint.network') }, { key: 'T', label: t('ln.hint.filters') }, { key: t('key.enter'), label: t('hint.select') }],
    keys: { t: () => { filter = nextFilter(filter); redraw(); } },
  };
}
