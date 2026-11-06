import { RANKS, type Pilot } from '@opc/shared';

/** Where a pilot stands on the rank ladder. Ranks need BOTH an hours and a flights threshold, so progress is the slower of the two. */
export function rankProgress(p: Pick<Pilot, 'hours' | 'flights'>): { index: number; fraction: number; hasNext: boolean } {
  let index = 0;
  RANKS.forEach((r, i) => { if (p.hours >= r.hours && p.flights >= r.flights) index = i; });
  const next = RANKS[index + 1];
  if (!next) return { index, fraction: 1, hasNext: false };
  const cur = RANKS[index]!;
  const part = (have: number, from: number, to: number): number => Math.min(1, Math.max(0, (have - from) / (to - from)));
  return { index, fraction: Math.min(part(p.hours, cur.hours, next.hours), part(p.flights, cur.flights, next.flights)), hasNext: true };
}
