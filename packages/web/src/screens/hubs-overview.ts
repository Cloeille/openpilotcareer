import { HUB_PRICE, type FacilityView, type HubOverview, type HubsOverview } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { airportField } from '../airport-field.ts';
import { fetchHubsOverview } from '../api-facilities.ts';
import { fetchWarehouse } from '../api-parts.ts';
import { fetchSafety } from '../api-safety.ts';
import { fetchStaff } from '../api-staff.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { button, icon, panel, signDirection, signLocation, stat, titleBlock } from '../components.ts';
import { facilitiesOff, holdingText, planFocus } from '../facilities-ui.ts';
import { contractsOf, HOLDING_TONE, holdingOf, KIND_ICON, shown, stepOf, teamRows } from '../facilities-view.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { safetyEntry } from '../safety-ui.ts';
import { warehouseEntry } from '../parts-ui.ts';
import { famLabel, staffEntry } from '../staff-ui.ts';
import { h } from '../ui.ts';

/** The base on the big card. Kept across redraws (a language change, an action), not across visits to another tab: it resets to the main hub when the hub list changes. */
let chosen: string | null = null;

/** `#hubs` (the Compagnie tab): every base with its facilities, team and aircraft, and the way to open another one. A server without facilities says so and keeps the way to open a hub and the doors. */
export async function hubsOverview(ctx: Ctx): Promise<Screen> {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const data = await fetchHubsOverview();
  const [people, safety, parts] = await Promise.all([fetchStaff().catch(() => null), fetchSafety().catch(() => null), me.hubs[0] ? fetchWarehouse(me.hubs[0]).catch(() => null) : null]);
  const infos = new Map(await Promise.all(me.hubs.map(async (icao) => [icao, await airportInfo(icao)] as const)));
  // The doors to the other Company screens (C8): a card, its key, where it leads, its hint. A door whose server feature is off has no card and no key.
  const doors = [
    { card: staffEntry(people, go), key: 's', hash: '#staff', hint: t('st.hint.openStaff') },
    { card: safetyEntry(safety, go), key: 'f', hash: '#safety', hint: t('sf.hint.open') },
    { card: warehouseEntry(me.hubs[0] ?? '', parts, go), key: 'w', hash: `#warehouse/${me.hubs[0]}`, hint: t('pt.hint.open') },
  ].filter((d): d is typeof d & { card: HTMLElement } => d.card !== null);
  const doorKeys: Record<string, () => void> = Object.fromEntries(doors.map((d) => [d.key, () => go(d.hash)]));
  const doorHints = doors.map((d) => ({ key: d.key.toUpperCase(), label: d.hint }));
  const entries = doors.length > 0 ? h('div', { class: 'fc-entries' }, doors.map((d) => d.card)) : null;

  /** The way to open another hub: folded to its heading (the screen is full), unfolded by the heading or by the suggestion's button. */
  const openForm = (): HTMLDetailsElement => {
    const canAfford = me.company.balance >= HUB_PRICE;
    const field = airportField(t('hub.code'));
    const submit = button(t('fleet.buyHub'), { variant: 'secondary', type: 'submit', disabled: !canAfford });
    return h('details', { class: 'panel fc-open' },
      h('summary', { class: 'panel-head' }, h('h2', null, t('hub.open')), h('span', { class: 'panel-action' }, t('hub.openSub', { price: fm.money(HUB_PRICE) }))),
      h('form', { class: 'panel-body', onsubmit: (e: Event) => {
        e.preventDefault();
        const icao = field.input.value.trim().toUpperCase();
        void act(t('hub.opened', { icao }), () => api('/me/hubs', { method: 'POST', body: { icao } }), ctx.refresh);
      } }, field.root, h('p', { class: 'dim small' }, t('hub.after', { balance: fm.money(me.company.balance - HUB_PRICE) })), h('div', { class: 'row' }, submit)));
  };

  if (!data) {
    return {
      title: t('hub.title'), scene: 'hubs', tab: 'hubs', view: h('div', { class: 'fc-off-screen' }, h('div', { class: 'col', style: 'flex:1' }, facilitiesOff(), openForm()), entries), back: '#dashboard',
      hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, ...doorHints], keys: doorKeys,
    };
  }

  // ------------------------------------------------------------ the overview
  const hubs = data.hubs;
  if (chosen === null || !hubs.some((x) => x.icao === chosen)) chosen = hubs[0]?.icao ?? null;
  const main = hubs.find((x) => x.icao === chosen) ?? null;
  const totalOf = (x: HubOverview): number => x.monthlyCost;
  const all = data.monthlyCost;
  const choose = (icao: string): void => { chosen = icao; window.dispatchEvent(new Event('opc:redraw')); };
  const openPlan = (icao: string, slot: string | null = null): void => { planFocus.slot = slot; go(`#hub/${icao}`); };

  const sub = [tp('fc.ov.bases', data.company.hubs), tp('fc.ov.aircraft', data.company.aircraft), tp('fc.ov.people', data.company.employees)].join(' · ');
  const header = h('div', { class: 'fc-head' },
    titleBlock(`${data.company.name} · ${sub}`, t('fc.ov.title')),
    stat(t('fc.ov.cost'), t('fc.ov.perMonth', { amount: fm.money(all) }), hubs.length > 1 ? h('span', { class: 'dim' }, hubs.map((x) => `${x.icao} ${fm.money(totalOf(x))}`).join(' · ')) : null));

  const aircraftNote = (a: HubOverview['aircraft'][number], hub: string): string => {
    if (a.status === 'maintenance') return a.maintenanceUntil ? t('fc.ac.maintenanceUntil', { date: fm.date(a.maintenanceUntil) }) : t('fc.ac.maintenance');
    if (a.status === 'flying') return t('fc.ac.flying');
    return a.location === hub ? t('fc.ac.available') : t('fc.ac.availableAt', { icao: a.location });
  };
  const aircraftRow = (a: HubOverview['aircraft'][number], hub: string): HTMLElement => h('li', { class: 'fc-ac' },
    h('span', { class: 'mono strong' }, a.reg), h('span', { class: 'fc-ac-type dim small' }, a.typeName),
    h('span', { class: `fc-ac-status ${a.status}` }, aircraftNote(a, hub)));

  const facilityRow = (hub: HubOverview, f: FacilityView): HTMLElement => {
    const hold = holdingOf(f);
    const detail = [t('fc.hub.detail', { area: fm.num(f.areaM2), level: f.level }), f.works ? t('fc.hub.works', { date: fm.date(f.works.until) }) : null, f.understaffed ? t('fc.hub.understaffed') : null].filter(Boolean).join(' · ');
    const cost = f.monthly > 0 ? fm.money(f.monthly) : hold === 'available' && f.rent > 0 ? t('fc.hub.from', { amount: fm.money(f.rent) }) : '—';
    return h('li', { class: `fc-fac ${HOLDING_TONE[hold]}`, 'data-row': '', tabindex: 0, 'aria-label': `${f.name}, ${holdingText(f)}, ${cost}`, onclick: () => openPlan(hub.icao, f.slot) },
      icon(KIND_ICON[f.kind], 16),
      h('span', { class: 'col tight fc-fac-name' }, h('span', { class: 'fc-fac-title' }, f.name), h('span', { class: 'dim small' }, detail)),
      h('span', { class: 'fc-fac-status' }, hold === 'ai' && f.ownerName ? f.ownerName : holdingText(f)),
      h('span', { class: 'fc-fac-cost' }, cost));
  };
  const parkingRow = (hub: HubOverview): HTMLElement | null => {
    const p = hub.parking;
    if (p.spots === 0) return null;
    return h('li', { class: 'fc-fac mine', 'data-row': '', tabindex: 0, 'aria-label': t('fc.hub.parking'), onclick: () => openPlan(hub.icao) },
      icon('square-parking', 16),
      h('span', { class: 'col tight fc-fac-name' }, h('span', { class: 'fc-fac-title' }, t('fc.hub.parking')), h('span', { class: 'dim small' }, t('fc.hub.parkingDetail', { n: p.spots }))),
      h('span', { class: 'fc-fac-status' }, t('fc.hub.parkingUsed', { used: p.used, spots: p.spots })),
      h('span', { class: 'fc-fac-cost' }, fm.money(p.monthly)));
  };

  const bigCard = (hub: HubOverview): HTMLElement => {
    const info = infos.get(hub.icao);
    const { rows, more } = shown(hub.facilities);
    const parking = parkingRow(hub);
    const renewals = hub.renewals[0];
    const costHere = totalOf(hub);
    return h('section', { class: 'panel fc-hub', 'aria-label': `${hub.icao} ${hub.name}` }, h('div', { class: 'fc-hub-body' },
      h('div', { class: 'fc-hub-head' },
        h('div', { class: 'col tight' }, h('div', { class: 'row' }, signLocation(hub.icao), h('span', { class: 'muted' }, t(hub.role === 'main' ? 'fc.hub.main' : 'fc.hub.secondary'))), h('h2', { class: 'fc-hub-name' }, hub.name || info?.name || hub.icao)),
        button(t('fc.hub.plan'), { variant: 'primary', key: t('key.enter'), onclick: () => openPlan(hub.icao) })),
      h('div', { class: 'fc-hub-cols' },
        h('div', { class: 'fc-col-main' },
          h('div', { class: 'fc-sec' }, h('h3', null, t('fc.hub.facilities')), h('span', { class: 'muted' }, t('fc.ov.perMonth', { amount: fm.money(costHere) }))),
          rows.length === 0 && !parking ? h('p', { class: 'dim', style: 'padding:12px 0' }, t('fc.hub.none')) : h('ul', { class: 'plain fc-facs' }, rows.map((f) => facilityRow(hub, f)), parking),
          more.length > 0 ? h('p', { class: 'dim small fc-also' }, t('fc.hub.also', { names: more.map((f) => f.name).join(', ') })) : null),
        h('div', { class: 'fc-col-side' },
          h('div', { class: 'col' },
            h('div', { class: 'fc-sec' }, h('h3', null, t('fc.hub.team')), h('span', { class: 'muted' }, tp('fc.hub.people', hub.team.total))),
            h('ul', { class: 'plain col tight' }, teamRows(hub.team.byFamily).map((r) => h('li', { class: 'line' }, h('span', { class: 'line-label' }, famLabel(r.family)), h('span', { class: 'line-value strong' }, String(r.n)))))),
          h('div', { class: 'col tight' },
            h('div', { class: 'fc-sec' }, h('h3', null, t('fc.hub.fleet')), h('span', { class: 'muted' }, String(hub.aircraft.length))),
            hub.aircraft.length === 0 ? h('p', { class: 'dim small' }, t('fc.hub.noFleet')) : h('ul', { class: 'plain col tight' }, hub.aircraft.map((a) => aircraftRow(a, hub.icao)))))),
      h('div', { class: 'fc-hub-foot' },
        h('span', { class: 'row tight muted' }, renewals ? [icon('calendar-clock', 16), t('fc.hub.renew', { text: renewals.name, date: fm.date(renewals.before) })] : null),
        people ? button(t('fc.hub.team.link'), { variant: 'ghost', onclick: () => go('#staff') }) : null)));
  };

  const smallCard = (hub: HubOverview): HTMLElement => {
    const info = infos.get(hub.icao);
    const mine = hub.facilities.filter((f) => f.owner === 'player');
    const fact = (label: string, value: string): HTMLElement => h('div', { class: 'line' }, h('span', { class: 'line-label' }, label), h('span', { class: 'line-value strong' }, value));
    return h('section', { class: 'panel fc-base', 'aria-label': `${hub.icao} ${hub.name}` }, h('div', { class: 'fc-base-body' },
      h('div', { class: 'col tight' }, h('div', { class: 'row' }, signLocation(hub.icao), h('span', { class: 'muted' }, t(hub.role === 'main' ? 'fc.hub.main' : 'fc.hub.secondary'))), h('h2', { class: 'fc-base-name' }, hub.name || info?.name || hub.icao)),
      h('div', { class: 'col tight fc-facts' },
        fact(t('fc.f.facilities'), mine.length === 0 ? t('fc.f.noContract') : tp('fc.f.count', mine.length)),
        fact(t('fc.f.contracts'), t(({ none: 'fc.f.noContract', leased: 'fc.f.allLeased', owned: 'fc.f.allOwned', mixed: 'fc.f.mixed' } as const)[contractsOf(hub.facilities)])),
        fact(t('fc.f.cost'), fm.money(totalOf(hub))),
        fact(t('fc.f.team'), tp('fc.hub.people', hub.team.total))),
      hub.aircraft.length > 0 ? h('ul', { class: 'plain col tight fc-base-fleet' }, hub.aircraft.map((a) => aircraftRow(a, hub.icao))) : null,
      h('div', { class: 'row' }, button(t('fc.hub.plan'), { variant: 'ghost', onclick: () => openPlan(hub.icao) }))));
  };

  const suggestion = (s: NonNullable<HubsOverview['suggestion']>): HTMLElement => {
    const title = h('h3', null, t('fc.sug.title', { city: s.icao }));
    void airportInfo(s.icao).then((a) => { if (a) title.textContent = t('fc.sug.title', { city: cityOf(a).replace(/\s*\(.*$/, '') }); });
    return h('section', { class: 'fc-sug', 'aria-label': t('fc.sug.fromLabel') },
      h('div', { class: 'row' }, signDirection(s.icao), title),
      h('p', { class: 'muted' }, t('fc.sug.text', { n: s.flightsPerWeek })),
      h('div', { class: 'fc-sug-foot' }, h('span', { class: 'muted' }, t('fc.sug.from', { amount: fm.money(s.fromMonthly) })), button(t('fc.sug.open'), { variant: 'ghost', onclick: () => { const d = document.querySelector<HTMLDetailsElement>('.fc-open'); if (d) d.open = true; d?.querySelector('input')?.focus(); } })));
  };

  const side = h('div', { class: 'fc-side' },
    h('div', { class: 'fc-side-list' }, hubs.filter((x) => x.icao !== main?.icao).map(smallCard), data.suggestion ? suggestion(data.suggestion) : null, openForm()),
    entries);

  const view = h('div', { class: 'fc-ov' }, header, h('div', { class: 'fc-hubs' }, main ? bigCard(main) : null, side));
  const step = (dir: 1 | -1) => (): void => { const next = stepOf(hubs.map((x) => x.icao), chosen, dir); if (next && next !== chosen) choose(next); };
  return {
    title: t('hub.title'), scene: 'hubs', tab: 'hubs', view, back: '#dashboard',
    hints: [{ key: t('key.esc'), label: t('hint.dashboard') }, ...(hubs.length > 1 ? [{ key: '← →', label: t('fc.hint.base') }] : []), { key: t('key.enter'), label: t('fc.hint.plan') }, ...doorHints],
    keys: { left: step(-1), right: step(1), ...doorKeys },
  };
}
