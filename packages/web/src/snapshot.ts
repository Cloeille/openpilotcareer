import type { Flight, Me } from '@opc/shared';
import { api, fetchInfo, session } from './api.ts';
import { ApiError } from './errors.ts';
import type { Board } from './board.ts';

/** Everything the shell needs on every screen, loaded together at sign-in and after every action: the account, the job board (the HUD counts its jobs) and the last flight. Also what the offline screen shows, as it was at the last exchange. */
export type Snapshot = { me: Me; board: Board; lastFlight: Flight | null; antiCheat: boolean; at: number };

/** The account as the remembered company: if that company is gone or was never ours (another account on this server), fall back to the default. */
async function loadMe(): Promise<Me> {
  let m: Me;
  try {
    m = await api<Me>('/me');
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'not_your_company')) throw e;
    session.company = null;
    m = await api<Me>('/me');
  }
  session.company = m.company.id;
  return m;
}

export type BootStep = 'profile' | 'jobs';

/** `onStep` reports each step as it completes (the loading screen shows them). */
export async function loadSnapshot(onStep?: (step: BootStep, snap: Partial<Snapshot>) => void): Promise<Snapshot> {
  const me = await loadMe();
  onStep?.('profile', { me });
  const [board, flights, antiCheat] = await Promise.all([
    api<Board>('/jobs'),
    api<Flight[]>('/me/flights?limit=1'),
    // the badge is a courtesy: an unreachable /info must not break the page
    fetchInfo(session.server).then((i) => i.antiCheat, () => true),
  ]);
  onStep?.('jobs', { me, board });
  return { me, board, lastFlight: flights[0] ?? null, antiCheat, at: Date.now() };
}
