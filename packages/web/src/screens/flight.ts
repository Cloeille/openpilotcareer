import { MANUAL_PAY_FACTOR, type Flight } from '@opc/shared';
import { airportInfo } from '../airports.ts';
import { saveBlob } from '../api.ts';
import { button, icon, line, panel } from '../components.ts';
import { loadFlight, loadFlights } from '../flights-data.ts';
import { flightBadge, interruptionLabel } from '../flight-view.ts';
import { fmt } from '../format.ts';
import { flightNeighbours, statement, statementCsv } from '../history.ts';
import { hashFor } from '../keys.ts';
import { t } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h, notify } from '../ui.ts';

let tab: 'report' | 'gain' = 'report';

const verdictIcon = { verified: 'shield-check', unverified: 'circle-dashed', rejected: 'shield-x', cancelled: 'circle-x', active: 'route' } as const;

export async function flightDetail(ctx: Ctx): Promise<Screen> {
  const { arg, go } = ctx;
  const back = '#history';
  const id = arg ? Number(arg) : NaN;
  const recent = Number.isInteger(id) ? await loadFlights() : [];
  const f = recent.find((x) => x.id === id) ?? (Number.isInteger(id) ? await loadFlight(id) : null);
  if (!f) return { title: t('fl.notFound'), scene: 'flight', tab: 'history', back, hints: [{ key: t('key.esc'), label: t('fl.back') }], view: h('p', { class: 'error-text', role: 'alert' }, t('fl.notFound')) };
  const fm = fmt();
  const at = f.completedAt ?? f.acceptedAt;
  const [from, to] = await Promise.all([airportInfo(f.job.origin), airportInfo(f.job.destination)]);
  const names = `${from ? from.name : f.job.origin} → ${to ? to.name : f.job.destination}`;
  const setTab = (v: typeof tab): void => { tab = v; window.dispatchEvent(new Event('opc:redraw')); };
  const switcher = h('div', { class: 'view-switcher', role: 'group', 'aria-label': t('hist.views') },
    (['report', 'gain'] as const).map((v) => h('button', { type: 'button', class: 'view-opt', 'aria-pressed': String(tab === v), onclick: () => setTab(v) }, t(`fl.view.${v}`), v === 'gain' ? h('kbd', { class: 'keycap' }, 'G') : null)));
  const header = h('div', { class: 'flight-header' },
    h('div', { class: 'title-block' },
      h('div', { class: 'status-line' }, tab === 'gain' ? t('fl.overlineGain', { id: f.job.id }) : t('fl.overline', { date: fm.date(at) })),
      h('div', { class: 'row' }, h('h1', { class: 'title' }, `${f.job.origin} → ${f.job.destination}`), flightBadge(f)),
      h('p', { class: 'route-line-text' }, `${names} · ${t('fl.subline', { from: f.job.origin, to: f.job.destination, aircraft: f.aircraftIcao, id: f.aircraftId })}`)),
    switcher);

  const exportStatement = (): void => { saveBlob(new Blob([statementCsv(f)], { type: 'text/csv' }), `opc-flight-${f.id}-statement.csv`); notify(t('fl.exported')); };
  const body = tab === 'gain' ? gainBody(f, exportStatement) : reportBody(f);
  const view = h('div', { class: 'flight-view' }, header, body);
  const { older, newer } = flightNeighbours(recent, f.id);
  const step = (to: Flight | null): (() => void) | null => (to ? () => go(hashFor('flight', to.id)) : null);
  const stepOlder = step(older), stepNewer = step(newer);
  return {
    title: `${f.job.origin} → ${f.job.destination}`, scene: 'flight', tab: 'history', view, back,
    hints: [
      { key: t('key.esc'), label: t('fl.back') },
      { key: 'G', label: tab === 'gain' ? t('hint.telemetry') : t('hint.gain') },
      ...(tab === 'report' ? [{ key: 'R', label: t('hint.replayTouchdown') }] : []),
      ...(tab === 'report' && f.status === 'rejected' ? [{ key: 'T', label: t('hint.seeProof') }] : []),
      ...(stepOlder ? [{ key: 'Z', label: t('hint.olderFlight') }] : []),
      ...(stepNewer ? [{ key: 'C', label: t('hint.newerFlight') }] : []),
      ...(tab === 'gain' ? [{ key: 'X', label: t('hint.exportStatement') }] : []),
    ],
    keys: {
      g: () => setTab(tab === 'gain' ? 'report' : 'gain'),
      ...(tab === 'report' ? { r: () => notify(t('fl.noTouchdown')) } : {}),
      ...(tab === 'report' && f.status === 'rejected' ? { t: () => notify(t('fl.noProof')) } : {}),
      ...(stepOlder ? { z: stepOlder } : {}), ...(stepNewer ? { c: stepNewer } : {}), ...(tab === 'gain' ? { x: exportStatement } : {}),
    },
  };
}

function reportBody(f: Flight): HTMLElement {
  const fm = fmt();
  const s = statement(f);
  const verdictTitle = t(`fl.verdict.${f.status}`);
  const sub = f.status === 'unverified' ? t('fl.verdict.unverifiedSub', { pct: fm.percent(MANUAL_PAY_FACTOR) }) : f.status === 'rejected' ? (f.rejectReason ?? '') : t(`fl.verdict.${f.status}Sub`);
  const cons = f.status === 'rejected' ? h('div', { class: 'consequences' },
    h('div', { class: 'cons' }, h('span', { class: 'fact-label' }, t('fl.cons.gain')), h('span', { class: 'strong' }, t('fl.cons.gainV', { zero: fm.money(0), payout: fm.money(f.job.payout) }))),
    h('div', { class: 'cons' }, h('span', { class: 'fact-label' }, t('fl.cons.season')), h('span', { class: 'strong' }, t('fl.cons.seasonV'))),
    h('div', { class: 'cons' }, h('span', { class: 'fact-label' }, t('fl.cons.rep')), h('span', { class: 'strong' }, s.reputation === null ? '–' : fm.num(s.reputation, 1)))) : null;
  return h('div', { class: 'flight-middle' },
    h('section', { class: `panel verdict ${f.status}`, 'aria-label': verdictTitle },
      h('div', { class: 'verdict-head' }, h('span', { class: `verdict-icon ${f.status}` }, icon(verdictIcon[f.status], 22)),
        h('div', { class: 'col tight' }, h('h2', { class: 'verdict-title' }, verdictTitle), f.status === 'rejected' ? h('span', { class: 'dim small' }, t('fl.verdict.rejectedRule')) : null)),
      sub ? h('p', { class: f.status === 'rejected' ? 'reason' : 'muted' }, sub) : null,
      cons),
    panel({ title: t('fl.recorded') },
      line(t('fl.accepted'), fm.dateTime(f.acceptedAt)),
      f.completedAt !== null ? line(t('fl.closed'), fm.dateTime(f.completedAt)) : null,
      f.completedAt !== null ? line(t('fl.elapsed'), fm.duration((f.completedAt - f.acceptedAt) / 3_600_000)) : null,
      line(t('fl.load'), loadLabel(f.job)),
      line(t('fl.distance'), fm.nm(f.job.distanceNm)),
      line(t('fl.aircraft'), `${f.aircraftIcao} #${f.aircraftId}`),
      f.interruptions ? line(t('fl.interruptions'), interruptionLabel(f.interruptions)) : null,
      line(t('fl.payout'), fm.money(f.job.payout)),
      f.status === 'verified' || f.status === 'unverified' ? line(t('fl.net'), h('span', { class: 'strong' }, fm.signedMoney(f.net))) : null,
      f.job.route ? h('div', { class: 'col tight' }, h('span', { class: 'fact-label' }, t('fl.route.label')), h('span', { class: 'mono small route-text' }, f.job.route)) : null,
      h('p', { class: 'dim small' }, t('fl.gap'))));
}

function gainBody(f: Flight, onExport: () => void): HTMLElement {
  const fm = fmt();
  const s = statement(f);
  const paid = f.status === 'verified' || f.status === 'unverified';
  const row = (name: string, basis: string, amount: string, cls = ''): HTMLElement => h('div', { class: `stmt-line ${cls}`.trim() }, h('span', { class: 'stmt-name' }, name), h('span', { class: 'stmt-basis' }, basis), h('span', { class: 'stmt-amount' }, amount));
  const coef = f.status === 'verified' ? t('fl.gain.coefVerified') : f.status === 'unverified' ? t('fl.gain.coefManual', { pct: fm.percent(s.factor) }) : t('fl.gain.coefNone');
  return h('div', { class: 'flight-middle' }, panel({ title: t('fl.gain.title'), action: paid && f.completedAt !== null ? t('fl.gain.credited', { when: fm.dateTime(f.completedAt) }) : t('fl.gain.notPaid'), class: 'statement' },
    h('div', { class: 'stmt-section' }, h('span', null, t('fl.gain.revenue')), h('span', { class: 'strong' }, fm.signedMoney(s.revenue))),
    row(t('fl.gain.jobPay'), t('fl.gain.jobPayBasis', { load: loadLabel(f.job), dist: fm.nm(f.job.distanceNm) }), fm.money(s.payout)),
    row(t('fl.gain.coef'), coef, `×${fm.num(s.factor, 2)}`),
    h('div', { class: 'stmt-section' }, h('span', null, t('fl.gain.charges')), h('span', { class: 'strong' }, fm.signedMoney(-s.charges))),
    row(t('fl.gain.fuel'), f.aircraftIcao, fm.signedMoney(-s.fuel)),
    row(t('fl.gain.landing'), f.job.destination, fm.signedMoney(-s.landing)),
    row(t('fl.gain.maintenance'), f.aircraftIcao, fm.signedMoney(-s.maintenance)),
    h('div', { class: 'stmt-net' }, h('span', null, t('fl.gain.net')), h('span', { class: 'big-money' }, fm.signedMoney(s.net))),
    h('div', { class: 'row' }, button(t('fl.export'), { variant: 'secondary', icon: 'download', key: 'X', onclick: onExport }))));
}
