import { cannotFly, type Job } from '@opc/shared';
import { button, icon, signDirection, signLocation } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { UNVERIFIED_PAY_PCT } from '../onboarding-model.ts';
import { acceptJob, completeOnboarding, firstJob } from '../api-onboarding.ts';
import type { FirstJob, Me } from '../onboarding-types.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { guarded, hintsOf, obError, titleArea, type StepResult, type Wizard } from '../onboarding-shell.ts';
import { notify, h } from '../ui.ts';
import type { Key } from '../messages.ts';

const NBSP = '\u00a0';

function aircraftLine(me: Me): string {
  const a = me.fleet[0];
  if (!a) return '–';
  const name = a.type.name.replace(/^Airbus |^Boeing |^Embraer |^Cessna /, '');
  const key: Key = a.ownership ? `ob.s6.own.${a.ownership}` : 'ob.s6.own.plain';
  return t(key, { type: name });
}

export async function step6(w: Wizard): Promise<StepResult> {
  const fm = fmt();
  const me = await w.loadMe(true);
  const company = me.company;
  const hubCode = me.hubs[0] ?? w.form.hub ?? '';
  const hub = await airportInfo(hubCode);
  const aircraft = me.fleet[0] ?? null;
  const error = h('p', { class: 'ob-error', role: 'alert' });

  // The reservation: asked for once the company has an aircraft; a failure just means there is no first job to offer.
  let fj: FirstJob | null = null;
  if (aircraft) { try { fj = await firstJob(company.id); } catch { fj = null; } }
  const job: Job | null = fj?.job ?? null;
  const flier = job ? me.fleet.find((a) => !a.busy && a.location === job.origin && !cannotFly(a.type, job)) ?? null : null;
  const [origin, dest] = job ? await Promise.all([airportInfo(job.origin), airportInfo(job.destination)]) : [null, null];

  const cityName = hub ? cityOf(hub) : hubCode;
  const typeName = aircraft ? aircraft.type.name.replace(/^Airbus |^Boeing |^Embraer /, '') : '';
  const sub = !aircraft ? '' : job ? t('ob.s6.sub', { type: typeName, city: cityName }) : t('ob.s6.subNoJob', { type: typeName, city: cityName });

  const done = async (dest: string, accept: boolean): Promise<void> => {
    await completeOnboarding();
    if (accept && job && flier) {
      try { await acceptJob(job.id, flier.id); notify(t('ob.s6.accepted')); } catch (e) { notify(obError(e), 'error'); dest = '#jobs'; }
    } else notify(t('ob.s6.welcome'));
    await w.finish(dest);
  };

  // ---- first job card
  // Same formula as the server's settle(): unverified flights pay 60 %, then the realism pay modifier applies.
  const gain = job ? Math.round(job.payout * (w.bridge === 'skipped' ? UNVERIFIED_PAY_PCT / 100 : 1) * (1 + (company.realism?.payModifierPct ?? 0) / 100)) : 0;
  const acceptBtn = button(t('ob.s6.accept'), { variant: 'primary', key: t('key.enter'), disabled: !job || !flier, onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, () => done('#dashboard', true)) });
  const jobsBtn = button(t('ob.s6.allJobs'), { variant: 'secondary', icon: 'clipboard-list', onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, () => done('#jobs', false)) });
  const finishBtn = button(t('ob.s6.finish'), { variant: 'primary', key: t('key.enter'), onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, () => done('#dashboard', false)) });

  const jobCard = job
    ? h('section', { class: 'ob-job', 'aria-labelledby': 'ob-job-title' },
      h('div', { class: 'ob-job-head' }, h('span', null, t('ob.s6.job')), h('span', null, t('ob.s6.reserved', { time: fm.elapsed(Math.max(0, fj!.reservedUntil - Date.now())) }))),
      h('div', { class: 'ob-job-title' },
        h('b', { id: 'ob-job-title' }, `${origin ? cityOf(origin) : job.origin} → ${dest ? dest.name : job.destination}`),
        h('span', null, `${job.kind === 'pax' ? t('ob.s6.pax', { n: job.pax }) : t('ob.s6.cargo', { kg: fm.kg(job.payloadKg) })} · ${aircraft?.type.icao ?? ''}${aircraft && 'registration' in aircraft && aircraft.registration ? ` ${aircraft.registration}` : ''}`)),
      h('div', { class: 'row' }, signLocation(job.origin), h('span', { class: 'track', 'aria-hidden': 'true' }), signDirection(job.destination)),
      h('div', { class: 'ob-job-facts' },
        h('div', null, h('span', { class: 'l' }, t('ob.s6.distance')), h('span', { class: 'v' }, fm.nm(Math.round(job.distanceNm)))),
        h('div', null, h('span', { class: 'l' }, t('ob.s6.reservedUntil')), h('span', { class: 'v' }, fm.zulu(fj!.reservedUntil))),
        h('div', null, h('span', { class: 'l' }, t('ob.s6.gain')), h('span', { class: 'v' }, `≈${NBSP}${fm.money(gain)}`))),
      h('div', { class: 'ob-what' }, h('h3', null, t('ob.s6.happens')),
        h('ol', null,
          h('li', null, h('i', null, '1'), t('ob.s6.step1')),
          h('li', null, h('i', null, '2'), t('ob.s6.step2', { type: typeName, icao: job.origin })),
          h('li', null, h('i', null, '3'), w.bridge === 'skipped' ? t('ob.s6.step3Manual', { pct: UNVERIFIED_PAY_PCT }) : t('ob.s6.step3')))),
      flier ? null : h('p', { class: 'ob-error' }, t('ob.s6.noAircraft')),
      h('div', { class: 'ob-job-actions' }, acceptBtn, jobsBtn))
    : h('section', { class: 'ob-job', 'aria-labelledby': 'ob-job-title' },
      h('div', { class: 'ob-job-head' }, h('span', null, t('ob.s6.job'))),
      h('div', { class: 'ob-job-title' }, h('b', { id: 'ob-job-title' }, aircraft ? t('ob.s6.noJobTitle') : t('ob.err.no_aircraft'))),
      h('p', { class: 'ob-job-wait' }, aircraft ? t('ob.s6.noJob') : t('ob.err.no_aircraft')),
      h('div', { class: 'ob-job-actions' }, aircraft ? finishBtn : button(t('ob.hint.prevStep'), { variant: 'primary', onclick: () => w.go(3) }), aircraft ? jobsBtn : null));

  // ---- company summary
  const realismName = company.realism ? t(`ob.s4.${company.realism.preset}`) : '–';
  const bridgeRow = w.bridge === 'connected' ? [t('ob.s6.bridgeOk'), 'ok'] : w.bridge === 'skipped' ? [t('ob.s6.bridgeSkipped'), 'warn'] : [t('ob.s6.bridgeUnknown'), ''];
  const row = (label: string, value: string, cls = ''): HTMLElement => h('div', { class: 'ob-summary-row' }, h('small', null, label), h('b', { class: cls }, value));
  const mode = w.startMode();
  const summary = h('section', { class: 'ob-summary', 'aria-labelledby': 'ob-summary-title' },
    h('div', { class: 'ob-summary-head' }, h('h2', { id: 'ob-summary-title' }, t('ob.s6.company')), button(t('ob.s6.edit'), { variant: 'ghost', onclick: () => w.go(4) })),
    row(t('ob.s6.rStart'), t(mode === 'airliner' ? 'ob.s6.startAirliner' : 'ob.s6.startHardcore')),
    row(t('ob.s6.rCompany'), company.code ? `${company.name} · ${company.code}` : company.name),
    row(t('ob.s6.rHub'), hub ? `${hubCode} · ${hub.name}` : hubCode),
    row(t('ob.s6.rAircraft'), aircraftLine(me)),
    row(t('ob.s6.rRealism'), realismName),
    row(t('ob.s6.rBridge'), bridgeRow[0]!, bridgeRow[1]),
    row(t('ob.s6.rBalance'), fm.money(company.balance)));

  const view = h('div', { class: 'ob-page' },
    titleArea(t('ob.s6.over'), t('ob.s6.title', { company: company.name }), sub || undefined),
    h('div', { class: 'ob-go' }, jobCard, summary),
    h('div', { class: 'ob-foot' }, h('div', { class: 'ob-foot-left' }, error)));
  void icon;
  return {
    scene: 'job', view, back: () => w.prev(),
    keys: { j: () => void guarded(jobsBtn, error, () => done('#jobs', false)) },
    hints: hintsOf([t('key.esc'), t('ob.hint.prevStep')], [t('key.enter'), job ? t('ob.hint.acceptJob') : t('ob.hint.done')], ['J', t('ob.hint.allJobs')]),
  };
}
