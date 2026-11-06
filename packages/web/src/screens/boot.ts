import { icon, keycap } from '../components.ts';
import { PRODUCT_NAME } from '../brand.ts';
import { brandBlock } from '../components.ts';
import { t, tp } from '../i18n.ts';
import { bareView, stage } from '../shell.ts';
import type { BootStep } from '../snapshot.ts';
import type { Snapshot } from '../snapshot.ts';
import { session, GLOBAL_URL } from '../api.ts';
import { h } from '../ui.ts';

type StepState = 'done' | 'active' | 'waiting';
const STEP_ICON = { done: 'circle-check', active: 'loader-circle', waiting: 'circle-dashed' } as const;

const TIPS = ['boot.tip1', 'boot.tip2', 'boot.tip3'] as const;

/** The session-loading screen: one row per thing being fetched, each with what it found. */
export function bootView(snap: Partial<Snapshot>, done: ReadonlySet<BootStep>): HTMLElement {
  const username = snap.me?.username ?? null;
  const server = session.server === GLOBAL_URL ? t('hud.globalServer') : new URL(session.server).host;
  const steps: { label: string; detail: string; state: StepState }[] = [
    { label: t('boot.auth'), detail: username ? t('boot.authDetail', { name: username }) : t('boot.waiting'), state: username ? 'done' : 'active' },
    { label: t('boot.profile'), detail: snap.me ? `${snap.me.username} · ${snap.me.company.name}` : t('boot.waiting'), state: done.has('profile') ? 'done' : 'active' },
    { label: t('boot.jobs'), detail: snap.board ? tp('boot.jobsDetail', snap.board.jobs.length) : t('boot.waiting'), state: done.has('jobs') ? 'done' : done.has('profile') ? 'active' : 'waiting' },
    { label: t('boot.fleet'), detail: snap.me ? tp('boot.fleetDetail', snap.me.fleet.length) : t('boot.waiting'), state: done.has('jobs') ? 'done' : 'waiting' },
  ];
  let tip = 0;
  const tipText = h('p', { class: 'tip-text' }, t(TIPS[0]));
  const next = (): void => { tip = (tip + 1) % TIPS.length; tipText.textContent = t(TIPS[tip]!); };
  const view = bareView([
    brandBlock(PRODUCT_NAME, h('span', { class: 'tagline' }, t('brand.tagline'))),
    h('div', { class: 'boot-column' },
      h('div', { class: 'title-block' }, h('div', { class: 'status-line' }, t('boot.step2', { server })), h('h1', { class: 'title' }, t('boot.title'))),
      h('ol', { class: 'steps', 'aria-live': 'polite' }, steps.map((s) =>
        h('li', { class: `step ${s.state}` }, icon(STEP_ICON[s.state], 20), h('div', { class: 'step-text' }, h('span', { class: 'step-label' }, s.label), h('span', { class: 'step-detail' }, s.detail)))))),
    h('div', { class: 'boot-footer' },
      h('div', { class: 'tip' }, h('div', { class: 'tip-label' }, icon('lightbulb', 14), t('boot.tip')), tipText),
      h('div', { class: 'hints' }, h('span', { class: 'hint' }, keycap(t('key.tab')), t('boot.nextTip'))))], 'login');
  view.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); next(); } });
  view.tabIndex = 0;
  return view;
}

export const bootStage = (view: HTMLElement): HTMLElement => stage('dashboard', view);
