import { parseHash } from './keys.ts';
import { t } from './i18n.ts';
import type { Ctx, Screen, ScreenFn, Tab } from './screen.ts';
import { pages } from './pages.ts';
import { h } from './ui.ts';
import type { SceneId } from './scenes.ts';

/** Pages not yet rebuilt run inside the new shell, in a scrollable pane with their old styling. */
function legacy(page: keyof typeof pages, scene: SceneId, tab: Tab | 'settings'): ScreenFn {
  return async (ctx: Ctx): Promise<Screen> => {
    const p = pages[page]!;
    const view = h('div', { class: 'legacy' }, await p.render({ me: ctx.me, refresh: ctx.refresh, go: (name) => ctx.go(`#${name}`) }));
    return { title: p.title, scene, tab, hints: [{ key: t('key.esc'), label: t('hint.back') }], back: null, view };
  };
}

export const routes: Record<string, ScreenFn> = {
  dashboard: legacy('dashboard', 'dashboard', 'dashboard'),
  jobs: legacy('jobs', 'jobs', 'jobs'),
  fleet: legacy('fleet', 'fleet', 'fleet'),
  history: legacy('flights', 'history', 'history'),
  leaderboard: legacy('leaderboard', 'leaderboard', 'leaderboard'),
  settings: legacy('settings', 'settings', 'settings'),
};

/** Old bookmarks (`#flights`) keep working. */
const ALIASES: Record<string, string> = { flights: 'history' };

export function resolve(hash: string): { name: string; arg: string | null } {
  const { name, arg } = parseHash(hash);
  const target = ALIASES[name] ?? name;
  return { name: target in routes ? target : 'dashboard', arg };
}
