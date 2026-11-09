import { AGENCY_MAX_COUNT, HIRED_ROLES } from '@opc/shared';
import type { AgencyOption, AgencyOptionId, AgencyPost, AgencyRequest, MissionView } from './api-agency.ts';
import type { Key } from './messages.ts';

/** What the recruiter agency screen decides without asking the server: how the options line up, which candidates are held, what may be pressed. The money is always the server's (`quote`, `options`). */

export const OPTION_TITLE: Record<AgencyOptionId, Key> = { agency: 'ag.opt.title.agency', train: 'ag.opt.title.train', classic: 'ag.opt.title.classic' };
export const OPTION_SUB: Record<AgencyOptionId, Key> = { agency: 'ag.opt.sub.agency', train: 'ag.opt.sub.train', classic: 'ag.opt.sub.classic' };
export const OPTION_NOTE: Record<AgencyOptionId, Key> = { agency: 'ag.opt.note.agency', train: 'ag.opt.note.train', classic: 'ag.opt.note.classic' };
export const OPTION_PHASES: Record<AgencyOptionId, Key> = { agency: 'ag.opt.phases.agency', train: 'ag.opt.phases.train', classic: 'ag.opt.phases.classic' };
/** Why an option cannot be taken. */
export const OPTION_UNAVAILABLE: Record<AgencyOptionId, Key> = { agency: 'ag.opt.no.agency', train: 'ag.opt.no.train', classic: 'ag.opt.no.classic' };
/** What the footer compares the agency with. */
export const SAVED_AGAINST: Record<Exclude<AgencyOptionId, 'agency'>, Key> = { train: 'ag.saved.train', classic: 'ag.saved.classic' };
/** Where an option other than the agency leads: the staff screens that already do it. */
export const OPTION_HASH: Record<Exclude<AgencyOptionId, 'agency'>, string> = { train: '#staff', classic: '#staff/hire' };

/** Widths in percent of the two phases of each option on one shared axis (the longest option fills it), so the bars compare in days. */
export function barWidths(options: readonly Pick<AgencyOption, 'id' | 'phases'>[]): Record<AgencyOptionId, [number, number]> {
  const longest = Math.max(1, ...options.map((o) => o.phases[0] + o.phases[1]));
  const widths: Record<AgencyOptionId, [number, number]> = { agency: [0, 0], train: [0, 0], classic: [0, 0] };
  for (const o of options) widths[o.id] = [(o.phases[0] / longest) * 100, (o.phases[1] / longest) * 100];
  return widths;
}

/** Change one field of the post the player is choosing. A new family starts over from its first role and, for pilots, the first type she flies (`types`), so the post is always one that exists. */
export function retarget(r: AgencyRequest, to: Partial<Pick<AgencyPost, 'family' | 'role' | 'base' | 'qual'>>, types: readonly string[]): AgencyRequest {
  if (to.family === undefined || to.family === r.family) return { ...r, ...to };
  return { ...r, ...to, family: to.family, role: HIRED_ROLES[to.family][0]!, qual: to.family === 'pilot' ? (to.qual ?? types[0] ?? null) : null };
}

/** One more or one fewer person, kept between 1 and what one mission can ask. */
export const stepCount = (count: number, dir: 1 | -1): number => Math.min(AGENCY_MAX_COUNT, Math.max(1, count + dir));

/** Hold or release one candidate; a mission for `count` people holds at most `count`. */
export function toggle(ids: readonly string[], id: string, count: number): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= count ? [...ids] : [...ids, id];
}

/** The mission can be signed: the search is over, someone is held and the commission leaves the balance at zero or more. */
export const canSign = (m: Pick<MissionView, 'ready' | 'quote'>): boolean => m.ready && m.quote !== null && m.quote.picked.length > 0 && m.quote.balanceAfter >= 0;
