import { session } from './api.ts';
import { getMe, getOnboarding, myCompanyIds, putOnboarding } from './api-onboarding.ts';
import { errorText } from './error-text.ts';
import { ApiError } from './errors.ts';
import type { NavState } from './input.ts';
import { t } from './i18n.ts';
import { bridgeStatus } from './api-onboarding.ts';
import { START_FACTS, clampStep, emptyForm, readDraft, resumeStep, toDraft, type Draft } from './onboarding-model.ts';
import { obBottom, obTop, type BottomBar, type StepResult, type Wizard } from './onboarding-shell.ts';
import type { BridgeStatus, MeV2, Onboarding, OnboardingStep, StartMode } from './onboarding-types.ts';
import { step1, step2 } from './screens/ob-start.ts';
import { step3a, step3b } from './screens/ob-aircraft.ts';
import { step4 } from './screens/ob-realism.ts';
import { step5 } from './screens/ob-bridge.ts';
import { step6 } from './screens/ob-go.ts';
import { stage } from './shell.ts';
import { PRODUCT_NAME } from './brand.ts';
import { h, notify } from './ui.ts';

export type OnboardingHost = {
  root: HTMLElement;
  /** Hand the Esc / shortcut table to the global input layer. */
  setNav: (nav: NavState) => void;
  /** The wizard is over: go to `dest` (a hash) and reload the shell. */
  onDone: (dest: string) => void;
  /** "Enregistrer et quitter" / Esc on the first step. */
  onQuit: (additional: boolean) => void;
};

/** What to do right after sign-in: `supported` = the server knows onboarding; `pending` = the wizard must run now. A player who already has another, working company is never forced into a saved "new company" wizard: they pick it up again from the company switcher. */
export async function onboardingState(): Promise<{ supported: boolean; pending: Onboarding | null }> {
  const ob = await getOnboarding();
  if (!ob) return { supported: false, pending: null };
  if (ob.completed) return { supported: true, pending: null };
  const others = (await myCompanyIds().catch(() => [])).filter((id) => id !== ob.companyId);
  return { supported: true, pending: others.length > 0 ? null : ob };
}

/** The wizard behind "+ New company": a saved, unfinished run resumes; otherwise a fresh one starts. */
export async function additionalOnboarding(): Promise<Onboarding> {
  const ob = await getOnboarding().catch(() => null);
  return ob && !ob.completed ? ob : freshOnboarding();
}
/** Used for a player who has no company yet and no onboarding record. */
export const freshOnboarding = (): Onboarding => ({ completed: false, step: 1, startMode: null, companyId: null, draft: {} });

const NOOP = (): void => undefined;

/** Run the six-step onboarding inside `host.root`. `additional`: a NEW company of a player who finished onboarding already. */
export type OnboardingRun = { stop: () => void; redraw: () => void };
export function runOnboarding(host: OnboardingHost, initial: Onboarding, additional: boolean): OnboardingRun {
  let alive = true;
  let rendering = 0;
  let cleanup: (() => void) | null = null;
  let bottom: BottomBar | null = null;
  let current: OnboardingStep = 1;
  const draft: Draft = readDraft(initial.draft);
  if (initial.startMode === null) draft.form = emptyForm();

  const w: Wizard = {
    ob: { ...initial },
    form: draft.form,
    bridge: draft.bridge,
    additional,
    wantsCustom: false,
    key: null,
    me: null,
    async loadMe(fresh = false) {
      if (w.me && !fresh) return w.me;
      const me: MeV2 = await getMe();
      w.me = me;
      return me;
    },
    go: (n) => void render(clampStep(n)),
    next: () => void render(clampStep(current + 1)),
    prev: () => { if (current > 1) void render(clampStep(current - 1)); else if (additional) host.onQuit(true); },
    async save() {
      try {
        w.ob = { ...w.ob, ...(await putOnboarding({ step: current, draft: toDraft({ form: w.form, bridge: w.bridge }) })) };
      } catch { /* a failed save must never block the player; the next step saves again */ }
    },
    bridgeSeen: (p: BridgeStatus | null) => bottom?.setBridge(p),
    async finish(dest) { alive = false; cleanup?.(); host.onDone(dest); },
    startMode: (): StartMode => w.ob.startMode ?? 'airliner',
  };

  const quit = async (): Promise<void> => {
    await w.save();
    notify(t('ob.saved'));
    host.onQuit(additional);
  };

  async function build(n: OnboardingStep): Promise<StepResult> {
    switch (n) {
      case 1: return step1(w);
      case 2: return step2(w);
      case 3: return w.startMode() === 'airliner' ? step3a(w) : step3b(w);
      case 4: return step4(w);
      case 5: return step5(w);
      case 6: return step6(w);
    }
  }

  async function render(n: OnboardingStep): Promise<void> {
    const id = ++rendering;
    cleanup?.(); cleanup = null;
    current = n;
    w.ob.step = n;
    void w.save();
    let result: StepResult;
    try {
      result = await build(n);
    } catch (e) {
      if (id !== rendering || !alive) return;
      result = {
        scene: 'login', hints: [], back: () => w.prev(),
        view: h('div', { class: 'ob-page', style: 'justify-content:flex-start' },
          h('div', { class: 'ob-empty', role: 'alert' }, h('p', { class: 'error-text' }, e instanceof ApiError && e.code === 'no_company' ? t('ob.err.no_company') : errorText(e)),
            h('button', { type: 'button', class: 'btn secondary', onclick: () => void render(n) }, t('ob.retry')))),
      };
    }
    if (id !== rendering || !alive) { result.cleanup?.(); return; }
    cleanup = result.cleanup ?? null;
    bottom = obBottom(result.hints, null);
    const main = h('main', { id: 'main', class: 'view wide', tabindex: -1 }, result.view);
    // A radio has no native Enter, but the global input layer leaves every <input> alone: so Enter on a card or a row presses the screen's primary button here.
    main.addEventListener('keydown', (e) => {
      const el = e.target;
      if (e.key !== 'Enter' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !(el instanceof HTMLInputElement) || el.type !== 'radio') return;
      const primary = main.querySelector<HTMLButtonElement>('[data-primary]:not(:disabled)');
      if (!primary) return;
      e.preventDefault();
      primary.click();
    });
    host.root.replaceChildren(stage(result.scene, main,
      obTop(n, n, (s) => void render(s), () => void quit()), bottom.el));
    document.title = `${t(`ob.step.${['depart', 'company', 'aircraft', 'realism', 'bridge', 'go'][n - 1]}` as 'ob.step.depart')} - ${PRODUCT_NAME}`;
    // Q / E would cycle the app's tabs, which do not exist yet: claim them. The screen's own keys win over the defaults.
    host.setNav({ tab: null, back: result.back ?? (() => w.prev()), keys: { q: NOOP, e: NOOP, ...(result.keys ?? {}) } });
    void bridgeStatus().then((p) => { if (id === rendering && alive) bottom?.setBridge(p); });
    // Put the focus on the selection of the screen, so the arrow keys work at once.
    const target = main.querySelector<HTMLElement>('input[type=radio]:checked') ?? main.querySelector<HTMLElement>('input:not([type=radio]):not([disabled])');
    (target ?? main).focus({ preventScroll: true });
  }

  void (async () => {
    // A saved run resumes where it was; for a new additional company it starts at the top.
    const first = resumeStep(initial);
    if (initial.companyId !== null) session.company = initial.companyId;
    await render(first);
  })();
  return { stop: () => { alive = false; rendering++; cleanup?.(); }, redraw: () => { if (alive) void render(current); } };
}

export { START_FACTS };
