import type { CentreView, OwnWhy, PilotRef, RetrainView, RetrainWhy, TrainOffer, TrainingView } from './api-training.ts';
import type { Key } from './messages.ts';
import type { Tone } from './staff-view.ts';

/** What the training screens decide without asking the server: how the lists line up, what may be pressed and why not. The money and the capacity are always the server's. */

/** Why the centre cannot take a pilot (the server's `ownWhy`). */
export const OWN_WHY: Record<OwnWhy, Key> = { no_training_centre: 'tr.why.no_training_centre', no_instructor: 'tr.why.no_instructor', centre_full: 'tr.why.centre_full' };
/** Why a captain cannot become an instructor (the server's `why`). */
export const RETRAIN_WHY: Record<RetrainWhy, Key> = {
  not_a_pilot: 'rt.why.not_a_pilot', not_employed: 'rt.why.not_employed', temporary_contract: 'rt.why.temporary_contract', already_instructor: 'rt.why.already_instructor',
  not_a_captain: 'rt.why.not_a_captain', no_rating: 'rt.why.no_rating',
};

export type TrainMode = 'trainees' | 'instructors';
export const MODES: readonly TrainMode[] = ['trainees', 'instructors'];
export const nextMode = (m: TrainMode): TrainMode => (m === 'trainees' ? 'instructors' : 'trainees');

/** `all` first, then every base that has a pilot to train, an instructor or a centre. */
export function basesOf(v: Pick<TrainingView, 'offers' | 'instructors' | 'centres' | 'convertible'>): string[] {
  return [...new Set([...v.centres.map((c) => c.hub), ...v.offers.map((o) => o.base), ...v.instructors.map((i) => i.base), ...v.convertible.map((c) => c.base)])].sort();
}
/** The base `dir` steps away in [all, ...bases], stopping at the ends (← → in the mockup). `null` is all. */
export function stepBase(bases: readonly string[], current: string | null, dir: 1 | -1): string | null {
  const all = [null, ...bases];
  const i = Math.max(0, all.indexOf(current));
  return all[Math.min(all.length - 1, Math.max(0, i + dir))] ?? null;
}

export const offerKey = (o: Pick<TrainOffer, 'staffId' | 'type'>): string => `${o.staffId}.${o.type}`;
/** The offers of a base (all of them for `null`): the ones the centre can take first, then by pilot and type, so the list does not jump when seats fill. */
export function offersAt(offers: readonly TrainOffer[], base: string | null): TrainOffer[] {
  return offers.filter((o) => base === null || o.base === base)
    .sort((a, b) => Number(a.ownWhy !== null) - Number(b.ownWhy !== null) || a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.staffId - b.staffId);
}
/** The offer to show selected: the one the player had, else the first. */
export const keepOffer = (list: readonly TrainOffer[], key: string | null): string | null => (list.some((o) => offerKey(o) === key) ? key : (list[0] ? offerKey(list[0]) : null));
/** Own is the cheaper course and the default whenever the centre can take the pilot; outside is always possible. */
export const defaultPlace = (o: Pick<TrainOffer, 'ownWhy'>): 'own' | 'outside' => (o.ownWhy === null ? 'own' : 'outside');
/** Whether the player can afford a course. */
export const canAfford = (cost: number, balance: number): boolean => balance >= cost;

export const seatTone = (c: Pick<CentreView, 'seats' | 'used'>): Tone => (c.seats === 0 ? 'bad' : c.used >= c.seats ? 'warn' : 'ok');
export const seatFraction = (c: Pick<CentreView, 'seats' | 'used'>): number => (c.seats === 0 ? 0 : Math.min(1, c.used / c.seats));

/** Pilots who can be made instructors at a base (all for `null`), soonest retirement first as the server sorted them. */
export const convertibleAt = (list: readonly PilotRef[], base: string | null): PilotRef[] => list.filter((p) => base === null || p.base === base);

/** The line pilots of a type left once he teaches: tone `bad` when the timetable then lacks any, `warn` when it has none to spare. */
export function gapTone(g: RetrainView['gap'][number]): Tone {
  const left = g.have - 1;
  return left < g.need ? 'bad' : left === g.need ? 'warn' : 'ok';
}
