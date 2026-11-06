import { parseHash } from './keys.ts';
import type { ScreenFn } from './screen.ts';
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
import { simbrief } from './screens/simbrief.ts';
import { realism } from './screens/ob-realism.ts';

export const routes: Record<string, ScreenFn> = {
  dashboard,
  jobs,
  job: jobDetail,
  simbrief,
  fleet, catalogue, buy, hubs, custom, company: newCompany,
  history, flight: flightDetail, manual,
  leaderboard, duel: duelScreen, 'company-sheet': companySheet, recap,
  settings,
  realism,
};

/** Old bookmarks (`#flights`) keep working. */
const ALIASES: Record<string, string> = { flights: 'history' };

export function resolve(hash: string): { name: string; arg: string | null } {
  const { name, arg } = parseHash(hash);
  const target = ALIASES[name] ?? name;
  return { name: target in routes ? target : 'dashboard', arg };
}
