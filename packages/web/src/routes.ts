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
import { hubsOverview } from './screens/hubs-overview.ts';
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
import { staffRoute } from './screens/staff-route.ts';
import { hubPlan } from './screens/hub-plan.ts';
import { facilityScreen } from './screens/facility.ts';
import { safetyRoute } from './screens/safety.ts';
import { warehouse } from './screens/warehouse.ts';
import { leaseWear } from './screens/lease-wear.ts';
import { service } from './screens/service.ts';
import { kitchen } from './screens/kitchen.ts';
import { financeRoute } from './screens/finance-route.ts';
import { groupRoute } from './screens/group-route.ts';

/** Every HUD tab is a route (the HUD links to `#<tab>`), which the type enforces: a tab added to TABS without a screen does not compile. */
export const routes: Record<Tab, ScreenFn> & Record<string, ScreenFn> = {
  dashboard,
  live,
  jobs,
  job: jobDetail,
  simbrief,
  fleet, catalogue, buy, hubs: hubsOverview, custom, company: newCompany,
  lease,
  history, flight: flightDetail, manual,
  leaderboard, duel: duelScreen, 'company-sheet': companySheet, recap,
  settings,
  realism,
  // ---- lines (v3 F1)
  network, line: lineScreen, 'line-new': lineNew, ops,
  // ---- staff (v3 F2)
  staff: staffRoute,
  // ---- facilities (v3 F3)
  hub: hubPlan, facility: facilityScreen,
  // ---- safety (v3 F4)
  safety: safetyRoute,
  // ---- parts (v3 F5)
  warehouse, wear: leaseWear,
  // ---- service (v3 F6)
  service, kitchen,
  // ---- reports (v4)
  finance: financeRoute,
  // ---- group (v4)
  group: groupRoute,
};

/** Old bookmarks (`#flights`) keep working. */
const ALIASES: Record<string, string> = { flights: 'history' };

export function resolve(hash: string): { name: string; arg: string | null } {
  const { name, arg } = parseHash(hash);
  const target = ALIASES[name] ?? name;
  return { name: target in routes ? target : 'dashboard', arg };
}
