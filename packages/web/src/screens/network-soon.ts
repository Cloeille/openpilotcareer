import { button, panel, titleBlock } from '../components.ts';
import { t } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** Stands in for the Réseau tab until the lines screens (lot fe-lines) replace this route; the tab must lead somewhere honest, and the Q / E cycle must not dead-end. */
export function networkSoon(ctx: Ctx): Screen {
  const view = h('div', { class: 'briefing-column' },
    titleBlock(ctx.snap.me.company.name, t('tab.network')),
    panel({ title: t('soon.title') },
      h('p', { class: 'muted' }, t('soon.network')),
      h('div', { class: 'row' }, button(t('hint.dashboard'), { variant: 'primary', key: t('key.enter'), onclick: () => ctx.go('#dashboard') }))));
  return { title: t('tab.network'), scene: 'dashboard', tab: 'network', view, back: '#dashboard', hints: [{ key: t('key.esc'), label: t('hint.dashboard') }] };
}
