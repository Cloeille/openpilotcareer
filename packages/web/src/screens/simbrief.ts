import type { Job } from '@opc/shared';
import { api } from '../api.ts';
import { act } from '../actions.ts';
import { airportInfo, cityOf } from '../airports.ts';
import { button, inputField, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { loadLabel } from '../job-view.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

export function simbrief(ctx: Ctx): Screen {
  const { go } = ctx;
  const fm = fmt();
  const { root: field, control: username } = inputField({ label: t('sb.username'), icon: 'user' }, { type: 'text', name: 'simbrief', autocomplete: 'off', maxlength: 64, required: true, spellcheck: 'false' });
  const result = h('div', { class: 'col', 'aria-live': 'polite' }, h('p', { class: 'dim' }, t('sb.empty')), h('p', { class: 'dim small' }, t('sb.note2')));
  const fetchBtn = button(t('sb.fetch'), { variant: 'primary', type: 'submit', key: t('key.enter') });

  async function run(): Promise<void> {
    fetchBtn.disabled = true;
    let job: Job | null = null;
    const ok = await act(t('sb.imported'), async () => { job = await api<Job>('/jobs/import-simbrief', { method: 'POST', body: { simbriefUsername: username.value.trim() } }); }, ctx.refresh);
    fetchBtn.disabled = false;
    if (!ok || !job) return;
    const j: Job = job;
    const [from, to] = await Promise.all([airportInfo(j.origin), airportInfo(j.destination)]);
    result.replaceChildren(...[
      h('div', { class: 'col tight' }, h('span', { class: 'mono strong big-code' }, `${j.origin} → ${j.destination}`),
        h('span', { class: 'muted' }, `${from ? cityOf(from) : j.origin} → ${to ? cityOf(to) : j.destination} · ${fm.nm(j.distanceNm)}`)),
      j.route ? h('span', { class: 'mono small route-text dim' }, j.route) : null,
      h('div', { class: 'facts-grid' },
        h('div', { class: 'fact big' }, h('span', { class: 'fact-label' }, t('job.load')), h('span', { class: 'fact-value' }, loadLabel(j))),
        j.plannedFuelKg !== undefined ? h('div', { class: 'fact big' }, h('span', { class: 'fact-label' }, t('job.fuel')), h('span', { class: 'fact-value' }, fm.kg(j.plannedFuelKg))) : null,
        j.requiredAircraft ? h('div', { class: 'fact big' }, h('span', { class: 'fact-label' }, t('job.aircraft')), h('span', { class: 'fact-value' }, j.requiredAircraft)) : null,
        h('div', { class: 'fact big' }, h('span', { class: 'fact-label' }, t('job.pay')), h('span', { class: 'fact-value' }, fm.money(j.payout)))),
      h('div', { class: 'row' }, button(t('sb.open'), { variant: 'primary', onclick: () => go(hashFor('job', j.id)) })),
      h('p', { class: 'dim small' }, t('sb.note')),
    ].filter((n): n is HTMLElement => n !== null));
  }

  const form = h('form', { class: 'col tight', onsubmit: (e: Event) => { e.preventDefault(); void run(); } }, h('div', { class: 'user-row' }, field, fetchBtn), h('small', { class: 'dim' }, t('sb.usernameHint')));
  const view = h('div', { class: 'briefing-column' },
    h('div', { class: 'col' }, titleBlock(t('sb.status'), t('sb.title')), h('p', { class: 'muted intro' }, t('sb.intro'))),
    form,
    panel({ title: t('sb.preview'), action: t('sb.previewSub') }, result));
  return {
    title: t('sb.title'), scene: 'jobs', tab: 'jobs', view, back: '#jobs',
    hints: [{ key: t('key.esc'), label: t('hint.backJobs') }, { key: t('key.enter'), label: t('hint.fetchPlan') }],
  };
}
