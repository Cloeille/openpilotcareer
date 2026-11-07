import { MANUAL_PAY_FACTOR, blockHours, type Job } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { airportInfo, cityOf, fillCity } from '../airports.ts';
import { ferryPreview } from '../api-ferry.ts';
import { jobsAtIdleAirports, candidates, flyable, lookupJob, noAircraftReason } from '../board.ts';
import { badge, button, dataTable, icon, panel, signDirection, signLocation, titleBlock } from '../components.ts';
import { contestedIds, rivalsFor } from '../competition.ts';
import { distanceLookup, ferryOffer, reasonLine } from '../ferry-ui.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

const fact = (label: string, value: string, sub?: string | null): HTMLElement =>
  h('div', { class: 'fact big' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value), sub ? h('span', { class: 'fact-sub' }, sub) : null);

const kindName = (j: Job): string => t(`job.kind.${j.kind}`);

export async function jobDetail(ctx: Ctx): Promise<Screen> {
  const { snap, go, arg } = ctx;
  const { me, board } = snap;
  const found = arg ? lookupJob(board, arg) : null;
  const back = '#jobs';
  if (!found) return { title: t('job.notFound'), scene: 'job', tab: 'jobs', back, hints: [{ key: t('key.esc'), label: t('hint.backJobs') }], view: h('div', { class: 'jobs-view' }, h('p', { class: 'error-text', role: 'alert' }, t('job.notFound'))) };
  const { job, open } = found;
  const fm = fmt();
  if (!open) return takenView(ctx, job);

  const options = candidates(me, job);
  const aircraftSelect = h('select', { id: 'job-aircraft', name: 'aircraft', 'aria-label': t('job.aircraftPicker'), disabled: options.length === 0 },
    options.map((a) => h('option', { value: a.id }, `${a.icao} #${a.id}`)));
  const chosen = (): number => Number((aircraftSelect as HTMLSelectElement).value);
  const type = options[0]?.type;
  const accept = (): void => {
    if (options.length === 0) return;
    void act(t('jobs.accepted', { route: `${job.origin} → ${job.destination}` }), () => api(`/jobs/${job.id}/accept`, { method: 'POST', body: { aircraftId: chosen() } }), ctx.refresh).then((ok) => { if (ok) go('#dashboard'); });
  };

  const [contested, rivals, dist] = await Promise.all([contestedIds([job]), rivalsFor(job), options.length === 0 ? distanceLookup([job.origin, ...me.fleet.map((a) => a.location)]) : undefined]);
  const reason = options.length === 0 ? noAircraftReason(me, job, dist) : null;
  const quote = reason?.kind === 'elsewhere' ? await ferryPreview(reason.aircraft.id, job.origin).catch(() => null) : null;
  const offer = reason?.kind === 'elsewhere' && quote ? ferryOffer(reason.aircraft, job.origin, quote, ctx.refresh) : null;
  const isContested = contested.has(job.id);
  const [orig, dest] = await Promise.all([airportInfo(job.origin), airportInfo(job.destination)]);
  const hours = type ? blockHours(type, job.distanceNm) : null;

  const noteHost = h('span', { class: 'dim' });
  if (isContested && rivals.length > 0) noteHost.textContent = tp('job.contestedNote', rivals.length, { names: rivals.slice(0, 3).join(', '), origin: job.origin });
  const why = reason ? reasonLine(reason, job.origin) : '';

  const view = h('div', { class: 'briefing-column' },
    h('div', { class: 'col' },
      titleBlock(t('job.detail.status', { kind: kindName(job), id: job.id }), `${orig ? cityOf(orig) : job.origin} → ${dest ? cityOf(dest) : job.destination}`),
      h('p', { class: 'route-line-text' }, hours === null ? t('job.route', { from: job.origin, to: job.destination, dist: fm.nm(job.distanceNm) }) : t('job.routeTime', { from: job.origin, to: job.destination, dist: fm.nm(job.distanceNm), time: fm.duration(hours) })),
      h('div', { class: 'row' }, signLocation(job.origin), icon('arrow-right', 16), signDirection(job.destination),
        isContested ? badge('contested', t('job.contested')) : null, job.source === 'simbrief' ? badge('info', t('jobs.imported'), 'file-down') : null),
      noteHost),
    panel({ title: t('job.briefing') },
      h('div', { class: 'facts-grid' },
        fact(t('job.load'), loadLabel(job), t('job.loadSub', { kg: fm.kg(job.payloadKg) })),
        fact(t('job.pay'), fm.money(job.payout), t('job.paySub', { pct: fm.percent(MANUAL_PAY_FACTOR) })),
        fact(t('job.aircraft'), options.length > 0 ? `${options[0]!.icao}` : (job.requiredAircraft ?? '–'), options.length > 0 ? t('job.aircraftReady', { aircraft: options[0]!.icao, id: options[0]!.id, where: job.origin }) : why),
        job.plannedFuelKg !== undefined ? fact(t('job.fuel'), fm.kg(job.plannedFuelKg), t('job.fuelSub')) : fact(t('job.distance'), fm.nm(job.distanceNm))),
      job.route ? h('div', { class: 'col tight' }, h('span', { class: 'fact-label' }, t('job.route.label')), h('span', { class: 'mono small route-text' }, job.route)) : null,
      h('div', { class: 'accept-block' },
        h('div', { class: 'row' },
          options.length > 1 ? h('label', { class: 'sr', for: 'job-aircraft' }, t('job.aircraftPicker')) : null,
          options.length > 1 ? h('div', { class: 'input-field inline' }, aircraftSelect) : null,
          button(t('job.acceptLock'), { variant: 'primary', key: options.length > 0 ? t('key.enter') : undefined, disabled: options.length === 0, onclick: accept })),
        offer,
        h('p', { class: 'dim small' }, job.source === 'simbrief' ? t('job.private') : t('job.lockNote')))));
  return {
    title: `${job.origin} → ${job.destination}`, scene: 'job', tab: 'jobs', view, back,
    hints: [{ key: t('key.esc'), label: t('hint.backJobs') }, ...(options.length > 0 ? [{ key: t('key.enter'), label: t('hint.select') }] : []), ...(offer ? [{ key: 'F', label: t('hint.ferry') }] : [])],
    ...(offer ? { keys: { f: () => offer.querySelector('button')?.click() } } : {}),
  };
}

/** The job left the board while the player was reading: say so, and offer similar jobs from the same airport. */
async function takenView(ctx: Ctx, job: Job): Promise<Screen> {
  const { snap, go } = ctx;
  const fm = fmt();
  const aircraft = snap.me.fleet.find((a) => !a.busy && a.location === job.origin);
  const similar = jobsAtIdleAirports(snap.me, snap.board).filter((j) => j.origin === job.origin && j.id !== job.id && j.kind === job.kind && flyable(snap.me, j))
    .sort((a, b) => Math.abs(a.payloadKg - job.payloadKg) - Math.abs(b.payloadKg - job.payloadKg)).slice(0, 3);
  const contested = await contestedIds(similar);
  const rows = similar.map((j) => {
    const city = h('span', { class: 'dim small' }, j.destination);
    fillCity(city, j.destination);
    return {
      label: `${j.origin} → ${j.destination}`,
      onOpen: () => go(hashFor('job', j.id)),
      cells: [h('div', { class: 'col tight' }, h('div', { class: 'row tight' }, h('span', { class: 'mono strong' }, `${j.origin} → ${j.destination}`), contested.has(j.id) ? badge('contested', t('job.contested')) : null),
        h('span', { class: 'dim small' }, city, ` · ${fm.nm(j.distanceNm)} · ${loadLabel(j)}`)), h('span', { class: 'strong' }, fm.money(j.payout))],
    };
  });
  const view = h('div', { class: 'briefing-column' },
    h('div', { class: 'col' },
      titleBlock(t('job.taken.status', { kind: kindName(job), id: job.id }), `${job.origin} → ${job.destination}`),
      h('p', { class: 'route-line-text' }, t('job.route', { from: job.origin, to: job.destination, dist: fm.nm(job.distanceNm) }), ` · ${loadLabel(job)} · ${fm.money(job.payout)}`)),
    h('div', { class: 'taken-notice' }, h('p', { class: 'taken-lead' }, t('job.taken.lead')), h('p', { class: 'muted' }, t('job.taken.explain'))),
    similar.length > 0 ? panel({ title: t('job.similar'), action: aircraft ? t('job.similarSub', { origin: job.origin, aircraft: aircraft.icao }) : job.origin },
      dataTable(t('job.similar'), [{ label: t('jobs.col.route') }, { label: t('job.pay'), align: 'end' }], rows), h('p', { class: 'dim small' }, t('job.similarNote'))) : null,
    h('div', { class: 'row' }, button(t('job.backToBoard'), { variant: 'secondary', icon: 'arrow-left', onclick: () => go('#jobs') }),
      h('span', { class: 'dim small' }, t('job.boardCount', { n: snap.board.jobs.filter((j) => j.origin === job.origin).length, origin: job.origin }))));
  return {
    title: t('job.taken.lead'), scene: 'job', tab: 'jobs', view, back: '#jobs',
    hints: [{ key: t('key.esc'), label: t('hint.backJobs') }, ...(similar.length > 0 ? [{ key: '↑ ↓', label: t('hint.browse') }, { key: t('key.enter'), label: t('hint.select') }] : [])],
  };
}
