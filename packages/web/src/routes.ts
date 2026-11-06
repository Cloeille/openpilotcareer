import { parseHash } from './keys.ts';
import { t } from './i18n.ts';
import type { Ctx, Screen, ScreenFn, Tab } from './screen.ts';
import { pages } from './pages.ts';
import { dashboard } from './screens/dashboard.ts';
import { buy } from './screens/buy.ts';
import { catalogue } from './screens/catalogue.ts';
import { custom } from './screens/custom.ts';
import { fleet } from './screens/fleet.ts';
import { flightDetail } from './screens/flight.ts';
import { history } from './screens/history.ts';
import { hubs } from './screens/hubs.ts';
import { manual } from './screens/manual.ts';
import { jobDetail } from './screens/job.ts';
import { newCompany } from './screens/new-company.ts';
import { jobs } from './screens/jobs.ts';
import { simbrief } from './screens/simbrief.ts';
import { h } from './ui.ts';
import type { SceneId } from './scenes.ts';

/** Pages not yet rebuilt run inside the new shell, in a scrollable pane with their old styling. */
function legacy(page: keyof typeof pages, scene: SceneId, tab: Tab | 'settings'): ScreenFn {
  return async (ctx: Ctx): Promise<Screen> => {
    const p = pages[page]!;
    const view = h('div', { class: 'legacy' }, await p.render({ me: ctx.snap.me, refresh: ctx.refresh, go: (name) => ctx.go(`#${name}`) }));
    return { title: p.title, scene, tab, hints: [{ key: t('key.esc'), label: t('hint.back') }], back: null, view };
  };
}

export const routes: Record<string, ScreenFn> = {
  dashboard,
  jobs,
  job: jobDetail,
  simbrief,
  fleet, catalogue, buy, hubs, custom, company: newCompany,
  history, flight: flightDetail, manual,
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
