import { dataTable, panel, signLocation, titleBlock } from '../components.ts';
import { cityName, loadProfile, loadSeason, typesOf } from '../competition-data.ts';
import { aiRivals } from '../competition.ts';
import { aiCanTake } from '../board.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { kindOf } from '../standings.ts';
import { h, notify } from '../ui.ts';

/** Public sheet of one company: who it is, its hubs and fleet, the seasons on record and the open jobs it could take. */
export async function companySheet(ctx: Ctx): Promise<Screen> {
  const { snap, arg, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const back = '#leaderboard';
  const id = arg ? Number(arg) : NaN;
  const profile = Number.isInteger(id) ? await loadProfile(id) : null;
  if (!profile) return { title: t('sheet.notFound'), scene: 'ai', tab: 'leaderboard', back, hints: [{ key: t('key.esc'), label: t('sheet.back') }], view: h('p', { class: 'error-text', role: 'alert' }, t('sheet.notFound')) };

  const data = await loadSeason();
  const row = data.standings.find((r) => r.companyId === profile.id);
  const peers = data.standings.filter((r) => r.companyId !== me.company.id).map((r) => r.companyId);
  const kind = kindOf({ companyId: profile.id, isAI: profile.isAI }, me.company.id, profile);
  const style = profile.personality?.style;
  const typeMap = await typesOf([...new Set([...profile.fleet.map((f) => f.icao), ...(profile.personality?.preferred ?? [])])]);
  const owned = new Map(profile.fleet.map((f) => [f.icao, f.count]));
  const { types: rivalTypes } = await aiRivals();
  const cities = await Promise.all(profile.hubs.map((h2) => cityName(h2)));

  const reachable = profile.isAI ? snap.board.jobs.filter((j) => aiCanTake(profile, rivalTypes, j)) : [];

  const step = (d: 1 | -1): void => { const i = peers.indexOf(profile.id); if (peers.length > 0) go(hashFor('company-sheet', peers[(i + d + peers.length) % peers.length]!)); };
  const fig = (label: string, value: string): HTMLElement => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value));

  const identity = h('div', { class: 'col' },
    titleBlock(t('sheet.status', { kind: profile.isAI ? t('sheet.kindAI') : t(`lb.kind.${kind ?? 'pilot'}` as Key), rank: row ? fm.ordinal(row.rank) : '–' }), profile.name),
    style ? h('div', { class: 'row tight' }, h('span', { class: 'strong' }, t(`sheet.style.${style}` as Key)), h('span', { class: 'muted' }, t('sheet.mainHub', { hub: profile.hubs[0] ?? '–' }))) : null,
    h('p', { class: 'muted doctrine' }, style ? t(`sheet.doctrine.${style}` as Key) : t('sheet.human')));

  const network = panel({ title: t('sheet.hubs'), headless: true },
    h('div', { class: 'network' },
      h('div', { class: 'col' }, h('span', { class: 'fact-label' }, t('sheet.hubs')), profile.hubs.map((hub, i) => h('div', { class: 'row tight' }, signLocation(hub), h('span', null, cities[i] ?? hub)))),
      h('div', { class: 'col' }, h('span', { class: 'fact-label' }, t('sheet.preferred')),
        (profile.personality?.preferred ?? profile.fleet.map((f) => f.icao)).map((icao) => {
          const n = owned.get(icao);
          return h('div', { class: 'row between type-row' }, h('span', null, typeMap.get(icao)?.name ?? icao), n ? h('span', { class: 'dim small' }, t('sheet.fleetCount', { n })) : null);
        }))));

  const history = profile.seasons.length === 0 ? h('p', { class: 'dim' }, t('sheet.noSeasons'))
    : dataTable(t('sheet.seasons'), [{ label: t('sheet.col.season') }, { label: t('sheet.col.worth'), align: 'end' }, { label: t('sheet.col.flights'), align: 'end' }, { label: t('sheet.col.reputation'), align: 'end' }],
      profile.seasons.map((s) => ({ cells: [fm.seasonMonth(s.season), fm.moneyShort(s.netWorth), fm.num(s.flights), fm.num(s.reputation, 1)] })));

  const jobsPanel = profile.isAI ? panel({ title: t('sheet.contested'), action: tp('sheet.contestedCount', reachable.length) },
    reachable.length === 0 ? h('p', { class: 'dim' }, t('sheet.contestedNone'))
      : h('ul', { class: 'plain contested-list' }, reachable.slice(0, 4).map((j) => h('li', null, h('a', { href: hashFor('job', j.id), class: 'row between' }, h('span', { class: 'mono strong' }, `${j.origin} → ${j.destination}`), h('span', { class: 'dim small' }, fm.money(j.payout))))),
        reachable.length > 4 ? h('li', { class: 'dim small' }, t('sheet.contestedMore', { n: reachable.length - 4 })) : null)) : null;

  const view = h('div', { class: 'sheet-layout' },
    h('div', { class: 'sheet-profile' }, identity, network, h('p', { class: 'dim small note' }, t('sheet.gap'))),
    h('div', { class: 'sheet-side' },
      panel({ title: t('sheet.figures'), action: row ? fm.ordinal(row.rank) : undefined },
        h('div', { class: 'facts-grid' }, fig(t('lb.col.worth'), fm.moneyShort(profile.netWorth)), fig(t('sheet.career.balance'), fm.moneyShort(profile.balance)),
          fig(t('sheet.career.hours'), fm.hours(profile.hours)), fig(t('sheet.career.flights'), fm.num(profile.flights)),
          fig(t('sheet.career.revenue'), fm.moneyShort(profile.revenue)), fig(t('lb.col.reputation'), fm.num(profile.reputation, 1)))),
      jobsPanel,
      panel({ title: t('sheet.seasons'), action: t('sheet.seasonsSub') }, history)));
  return {
    title: profile.name, scene: 'ai', tab: 'leaderboard', view, back,
    hints: [{ key: t('key.esc'), label: t('hint.leaderboard') }, { key: '← →', label: t('hint.companies') }, ...(reachable.length > 0 ? [{ key: 'J', label: t('hint.rivalJobs') }] : []), ...(profile.isAI ? [{ key: 'A', label: t('hint.rivalAlert') }] : [])],
    keys: { left: () => step(-1), right: () => step(1), ...(profile.isAI ? { a: () => notify(t('sheet.noAlert')) } : {}), ...(reachable.length > 0 ? { j: () => go(hashFor('job', reachable[0]!.id)) } : {}) },
  };
}
