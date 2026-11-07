import { parseHash } from './keys.ts';
import type { ScreenFn, Tab } from './screen.ts';
import { companySheet } from './screens/company-sheet.ts';
import { dashboard } from './screens/dashboard.ts';
import { duelScreen } from './screens/duel.ts';
import { leaderboard } from './screens/leaderboard.ts';
import { recap } from './screens/recap.ts';
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
import { settings } from './screens/settings.ts';
import { lease } from './screens/lease.ts';
import { live } from './screens/live.ts';
import { simbrief } from './screens/simbrief.ts';
import { realism } from './screens/ob-realism.ts';
import { network } from './screens/network.ts';
import { lineScreen } from './screens/line.ts';
import { lineNew } from './screens/line-new.ts';
import { ops } from './screens/ops.ts';

/** Every HUD tab is a route (the HUD links to `#<tab>`), which the type enforces: a tab added to TABS without a screen does not compile. */
export const routes: Record<Tab, ScreenFn> & Record<string, ScreenFn> = {
  dashboard,
  live,
  jobs,
  job: jobDetail,
  simbrief,
  fleet, catalogue, buy, hubs, custom, company: newCompany,
  lease,
  history, flight: flightDetail, manual,
  leaderboard, duel: duelScreen, 'company-sheet': companySheet, recap,
  settings,
  realism,
  // ---- lines (v3 F1)
  network, line: lineScreen, 'line-new': lineNew, ops,
};

/** Old bookmarks (`#flights`) keep working. */
const ALIASES: Record<string, string> = { flights: 'history' };

export function resolve(hash: string): { name: string; arg: string | null } {
  const { name, arg } = parseHash(hash);
  const target = ALIASES[name] ?? name;
  return { name: target in routes ? target : 'dashboard', arg };
}
