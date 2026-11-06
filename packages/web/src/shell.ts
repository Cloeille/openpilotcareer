import { hudBottom, hudTop, type HudData } from './hud.ts';
import type { Hint } from './screen.ts';
import { SCENES, type SceneId } from './scenes.ts';
import { t } from './i18n.ts';
import { fitScale } from './fit.ts';
import { h } from './ui.ts';

export function fitStage(): void {
  document.documentElement.style.setProperty('--s', String(fitScale(window.innerWidth, window.innerHeight)));
}

/** The 1600x900 stage: scene backdrop, scrim, then the given layers. */
export function stage(scene: SceneId, ...layers: (Node | null)[]): HTMLElement {
  return h('div', { class: 'stage' },
    h('div', { class: 'scene', style: `background-image:url("${SCENES[scene]}")`, 'aria-hidden': 'true' }),
    h('div', { class: 'scrim', 'aria-hidden': 'true' }),
    h('a', { class: 'skip', href: '#main' }, t('skip')),
    ...layers);
}

/** A bare view fills the stage (login, loading): no HUD. */
export const bareView = (content: Node | Node[], cls = ''): HTMLElement =>
  h('main', { id: 'main', class: `view bare ${cls}`.trim(), tabindex: -1 }, content);

/** A HUD view sits between the two HUD bars. */
export const hudView = (content: Node | Node[], cls = ''): HTMLElement =>
  h('main', { id: 'main', class: `view ${cls}`.trim(), tabindex: -1 }, content);

export function hudStage(scene: SceneId, view: HTMLElement, hud: HudData, hints: Hint[]): HTMLElement {
  return stage(scene, view, hudTop(hud), hudBottom(hints, hud.antiCheat));
}
