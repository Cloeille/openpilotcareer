import { cannotFly, type Job, type Me } from '@opc/shared';

/** The shape of GET /jobs: board jobs at every airport where the company has an aircraft, plus the player's pending SimBrief imports. */
export type Board = { jobs: Job[]; imported: Job[] };

/** Can one of the company's idle aircraft, standing at the job's origin, fly it? */
export const flyable = (me: Me, j: Job): boolean => me.fleet.some((a) => !a.busy && a.location === j.origin && !cannotFly(a.type, j));

/** Idle aircraft that can take `j` right now. */
export const candidates = (me: Me, j: Job): Me['fleet'] => me.fleet.filter((a) => !a.busy && a.location === j.origin && !cannotFly(a.type, j));

/** Jobs the player can act on: those starting where an idle aircraft stands, the flyable ones first, then by payout. */
export function jobsAtIdleAirports(me: Me, board: Board): Job[] {
  const airports = new Set(me.fleet.filter((a) => !a.busy).map((a) => a.location));
  const fly = new Map(board.jobs.map((j) => [j.id, flyable(me, j)]));
  return board.jobs.filter((j) => airports.has(j.origin)).sort((a, b) => Number(fly.get(b.id)) - Number(fly.get(a.id)) || b.payout - a.payout || a.id.localeCompare(b.id));
}
