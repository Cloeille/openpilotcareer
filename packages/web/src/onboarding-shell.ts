import { PRODUCT_NAME } from './brand.ts';
import { brandBlock, icon, keycap } from './components.ts';
import { ApiError } from './errors.ts';
import { errorText } from './error-text.ts';
import { fmt } from './format.ts';
import { GLOBAL_URL, session } from './api.ts';
import { t, tp } from './i18n.ts';
import { messageFor, type Key } from './messages.ts';
import type { BridgeStatus, Me, Onboarding, OnboardingStep, StartMode } from './onboarding-types.ts';
import type { Draft, Form } from './onboarding-model.ts';
import type { Hint } from './screen.ts';
import type { SceneId } from './scenes.ts';
import { h } from './ui.ts';

type Child = Node | string | number | null | false | undefined | Child[];

/** Everything a step needs from the wizard. State lives here for the whole run; a step reads and writes it, then calls go()/next(). */
export type Wizard = {
  ob: Onboarding;
  form: Form;
  bridge: Draft['bridge'];
  additional: boolean;
  /** "Custom setup" was chosen on step 1: step 4 opens on the individual settings. */
  wantsCustom: boolean;
  /** The bridge key created on step 5; the secret exists only here, in memory, and only until the step is left. */
  key: { id: number; label: string; secret: string | null } | null;
  me: Me | null;
  loadMe: (fresh?: boolean) => Promise<Me>;
  go: (step: OnboardingStep) => void;
  next: () => void;
  prev: () => void;
  /** Persist step + draft (PUT /onboarding); errors are swallowed, a failed save must not block the player. */
  save: () => Promise<void>;
  /** Report what the local bridge answered, for the status in the bottom bar. */
  bridgeSeen: (probe: BridgeStatus | null) => void;
  finish: (dest: string) => Promise<void>;
  startMode: () => StartMode;
};

export type StepResult = {
  scene: SceneId;
  view: HTMLElement;
  hints: Hint[];
  /** Esc: defaults to the previous step. */
  back?: () => void;
  keys?: Record<string, () => void>;
  cleanup?: () => void;
};

export const tk = (key: string): string => t(key as Key);
const NBSP = '\u00a0';

/** Server code -> ob.err.<code> when this lot has a text for it, else the app's own error text. */
export function obError(e: unknown): string {
  if (e instanceof ApiError) {
    const own = messageFor(`ob.err.${e.code}`);
    if (own) return t(own);
  }
  return e instanceof Error && !(e instanceof ApiError) ? e.message : errorText(e);
}

function serverName(): string {
  return session.server === GLOBAL_URL ? t('hud.globalServer') : new URL(session.server).host;
}

// ------------------------------------------------------------------ HUD/Onboarding

export const STEP_KEYS = ['ob.step.depart', 'ob.step.company', 'ob.step.aircraft', 'ob.step.realism', 'ob.step.bridge', 'ob.step.go'] as const;

export function obTop(current: OnboardingStep, maxReached: OnboardingStep, onStep: (s: OnboardingStep) => void, onQuit: () => void): HTMLElement {
  const items: Child[] = [];
  STEP_KEYS.forEach((key, i) => {
    const n = (i + 1) as OnboardingStep;
    const state = n === current ? 'current' : n < current ? 'done' : 'todo';
    if (i > 0) items.push(h('li', { class: 'ob-connector', 'aria-hidden': 'true' }));
    const label = h('span', { class: 'ob-label' }, t(key));
    const index = h('span', { class: 'ob-index', 'aria-hidden': 'true' }, state === 'done' ? icon('check', 13) : String(n));
    const content = [index, label];
    items.push(h('li', { class: `ob-step ${state}` },
      state === 'done' && n <= maxReached
        ? h('button', { type: 'button', class: 'ob-step-btn', 'aria-label': t('ob.stepAria', { n, name: t(key) }), onclick: () => onStep(n) }, content)
        : h('span', { class: 'ob-step-btn', 'aria-current': state === 'current' ? 'step' : null }, content)));
  });
  return h('header', { class: 'ob-top' },
    brandBlock(PRODUCT_NAME, h('div', { class: 'server-line' }, serverName(), h('span', { class: 'dim', 'aria-hidden': 'true' }, '·'), t('ob.newCompany'))),
    h('nav', { 'aria-label': t('ob.stepsNav') }, h('ol', { class: 'ob-steps' }, items)),
    h('div', { class: 'ob-quit' }, h('button', { type: 'button', onclick: onQuit }, t('ob.saveQuit'), icon('log-out', 15))));
}

// ------------------------------------------------------------------ HUD/Bottom (bridge status, season, key hints)

export type BottomBar = { el: HTMLElement; setBridge: (probe: BridgeStatus | null) => void };
export function bridgeLabel(probe: BridgeStatus | null): { text: string; dot: 'ok' | 'idle' | 'route' } {
  if (!probe) return { text: t('ob.bridge.none'), dot: 'idle' };
  if (probe.sim === 'connected') return { text: t('ob.bridge.connected'), dot: 'ok' };
  if (probe.sim === 'waiting') return { text: t('ob.bridge.waitingSim'), dot: 'route' };
  return { text: t('ob.bridge.running'), dot: 'ok' };
}

export function obBottom(hints: Hint[], probe: BridgeStatus | null, now = Date.now()): BottomBar {
  const { month, daysLeft } = fmt().season(now);
  const dot = h('span', { class: 'dot idle' });
  const value = h('span', { class: 'dim' });
  const paint = (p: BridgeStatus | null): void => {
    const l = bridgeLabel(p);
    dot.className = `dot ${l.dot === 'ok' ? '' : l.dot}`.trim();
    value.textContent = l.text;
  };
  paint(probe);
  const el = h('footer', { class: 'hud-bottom' },
    h('div', { class: 'hud-status' },
      h('span', { role: 'status' }, dot, t('ob.bridge.label'), h('span', { class: 'dim', 'aria-hidden': 'true' }, '·'), value),
      h('span', null, icon('calendar-clock', 14), t('hud.season', { month }), h('span', { class: 'dim' }, daysLeft === 0 ? t('hud.lastDay') : tp('hud.daysLeft', daysLeft)))),
    h('div', { class: 'hints' }, hints.map((x) => h('span', { class: 'hint' }, keycap(x.key), x.label))));
  return { el, setBridge: paint };
}

// ------------------------------------------------------------------ page pieces

export const titleArea = (over: Child, title: string, sub?: Child): HTMLElement =>
  h('div', { class: 'ob-title' }, h('div', { class: 'ob-over' }, over), h('h1', { class: 'ob-h1' }, title), sub ? h('p', { class: 'ob-sub' }, sub) : null);

export const hintsOf = (...pairs: [string, string][]): Hint[] => pairs.map(([key, label]) => ({ key, label }));
export const money = (n: number): string => fmt().money(n);
export const arrows = (dir: 'ud' | 'lr'): string => (dir === 'ud' ? '↑ ↓' : '← →');

/** A short-lived busy state for an async action on a button: disabled while it runs, and its error shown in `errorEl`. */
export async function guarded(button: HTMLButtonElement, errorEl: HTMLElement, fn: () => Promise<void>): Promise<void> {
  if (button.disabled) return;
  errorEl.textContent = '';
  button.disabled = true;
  try { await fn(); } catch (e) { errorEl.textContent = obError(e); } finally { button.disabled = false; }
}

export const zuluOf = (ms: number): string => fmt().zulu(ms);
export const NB = NBSP;
