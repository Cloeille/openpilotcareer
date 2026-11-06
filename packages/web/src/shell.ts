import { createHud, type HudData } from './hud.ts';
import type { Hint } from './screen.ts';
import { SCENES, decodeScene, type SceneId } from './scenes.ts';
import { t } from './i18n.ts';
import { fitScale } from './fit.ts';
import { LOADING_DELAY_MS, STAGGER_MAX, motionOK, type Slide } from './motion.ts';
import { h } from './ui.ts';

export function fitStage(): void {
  document.documentElement.style.setProperty('--s', String(fitScale(window.innerWidth, window.innerHeight)));
}

/** A new backdrop fades in over the old one for this long (motion.css); the old layer is dropped once covered. */
const SCENE_FADE_MS = 450;
/** `data-enter` (the enter animation of motion.css) is removed after this, so content a screen adds later never replays it. */
const ENTER_MS = 700;

type Stage = {
  readonly el: HTMLElement;
  readonly scenes: HTMLElement;
  readonly skip: HTMLElement;
  scene: SceneId | null;
  sceneSeq: number;
  main: HTMLElement | null;
};
let current: Stage | null = null;
const hud = createHud();

/**
 * The one 1600x900 stage of the page. It is created on first use and never rebuilt: backdrop, scrim and HUD stay in the DOM across screen changes, and only `<main>` (plus what changed in the HUD) is replaced.
 * Rebuilding all of it on every navigation re-decoded the backdrop image and painted it a frame after the rest, which was the flicker.
 */
function theStage(): Stage {
  if (current) return current;
  const scenes = h('div', { class: 'scenes', 'aria-hidden': 'true' });
  const skip = h('a', { class: 'skip', href: '#main' });
  const el = h('div', { class: 'stage' }, scenes, h('div', { class: 'scrim', 'aria-hidden': 'true' }), skip);
  return (current = { el, scenes, skip, scene: null, sceneSeq: 0, main: null });
}

/** Show a backdrop. It is added once decoded (they are preloaded, so that is the same frame) and cross-fades over the old layer, which stays until then: the backdrop is never missing. */
function setScene(s: Stage, id: SceneId): void {
  if (s.scene === id) return;
  s.scene = id;
  const seq = ++s.sceneSeq;
  const layer = h('div', { class: 'scene', style: `background-image:url("${SCENES[id]}")` });
  if (s.scenes.childElementCount === 0) { s.scenes.append(layer); return; }
  layer.classList.add('fade-in');
  void decodeScene(id).then(() => {
    if (seq !== s.sceneSeq) return;
    const old = [...s.scenes.children];
    s.scenes.append(layer);
    if (motionOK()) window.setTimeout(() => old.forEach((o) => o.remove()), SCENE_FADE_MS + 50);
    else old.forEach((o) => o.remove());
  });
}

/** Everything after the fixed parts (backdrop, scrim, skip link) is the current screen's layers. */
function setLayers(s: Stage, layers: (Node | null)[]): void {
  while (s.el.childElementCount > 3) s.el.lastElementChild!.remove();
  s.el.append(...layers.filter((l): l is Node => l !== null));
}

const sync = (s: Stage, scene: SceneId): void => {
  setScene(s, scene);
  s.skip.textContent = t('skip');
};

/** The stage with the given scene and layers, without HUD (login, loading). Always the same element: the caller may mount it again, nothing is rebuilt. */
export function stage(scene: SceneId, ...layers: (Node | null)[]): HTMLElement {
  const s = theStage();
  sync(s, scene);
  setLayers(s, layers);
  s.main = null;
  hud.reset();
  return s.el;
}

/** Put the stage in the page; a no-op when it is already the only thing there (so progress redraws never detach it). */
export function mount(root: HTMLElement, el: HTMLElement): void {
  if (root.firstElementChild !== el || root.childElementCount !== 1) root.replaceChildren(el);
}

/** A bare view fills the stage (login, loading): no HUD. */
export const bareView = (content: Node | Node[], cls = ''): HTMLElement =>
  h('main', { id: 'main', class: `view bare ${cls}`.trim(), tabindex: -1 }, content);

/** A HUD view sits between the two HUD bars. */
export const hudView = (content: Node | Node[], cls = ''): HTMLElement =>
  h('main', { id: 'main', class: `view ${cls}`.trim(), tabindex: -1 }, content);

const ENTER_NAME: Record<Slide, string> = { [-1]: 'left', 0: 'up', 1: 'right' };

/** Number the panels (`--i`) and the list rows (`--r`) of a screen in document order; motion.css turns the number into a 30 ms delay, and the last STAGGER_MAX share the same step. */
function stagger(view: HTMLElement): void {
  const number = (selector: string, prop: string): void => view.querySelectorAll<HTMLElement>(selector).forEach((el, i) => el.style.setProperty(prop, String(Math.min(i, STAGGER_MAX - 1))));
  number('.title-block, .panel', '--i');
  number('[data-row]', '--r');
}

const hudMounted = (s: Stage): boolean => !!s.main?.isConnected && hud.top.parentElement === s.el && hud.bottom.parentElement === s.el;

/**
 * Put `view` between the HUD bars. When the HUD is already up, only `<main>` is swapped, the backdrop is changed if the scene differs, and the HUD is updated in place.
 * `enter` is how the screen animates in (null = not at all: a redraw of the screen already shown).
 */
export function showScreen(root: HTMLElement, scene: SceneId, view: HTMLElement, data: HudData, hints: Hint[], enter: Slide | null): void {
  const s = theStage();
  sync(s, scene);
  hud.update(data, hints);
  if (enter !== null && motionOK()) {
    stagger(view);
    view.dataset.enter = ENTER_NAME[enter];
    window.setTimeout(() => delete view.dataset.enter, ENTER_MS);
  }
  if (hudMounted(s)) s.main!.replaceWith(view);
  else setLayers(s, [view, hud.top, hud.bottom]);
  s.main = view;
  mount(root, s.el);
}

/** A placeholder for `<main>` while a route loads. Only on a stage that already shows a screen (the loading screen covers the first load). */
export function showLoading(): void {
  const s = current;
  if (!s || !hudMounted(s)) return;
  const bar = (cls: string): HTMLElement => h('div', { class: `skeleton ${cls}` });
  const view = h('main', { id: 'main', class: 'view loading', tabindex: -1, 'aria-busy': 'true' },
    h('span', { class: 'sr', role: 'status' }, t('common.loading')),
    h('section', { class: 'panel skeleton-panel', 'aria-hidden': 'true' }, h('div', { class: 'panel-body' }, bar('title'), bar('row'), bar('row'), bar('row'), bar('row'))));
  s.main!.replaceWith(view);
  s.main = view;
}

/** Await `load`, showing the skeleton only if it takes longer than LOADING_DELAY_MS (a fast load never flashes it) and `isCurrent()` still holds (a newer navigation must not be covered by an older one's skeleton). */
export async function withLoading<T>(load: Promise<T> | T, isCurrent: () => boolean): Promise<T> {
  const timer = window.setTimeout(() => { if (isCurrent()) showLoading(); }, LOADING_DELAY_MS);
  try { return await load; } finally { clearTimeout(timer); }
}
