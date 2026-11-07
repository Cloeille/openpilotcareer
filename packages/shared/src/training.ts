// Lot TRAINING (v4): the training centre, instructors, ages and the reconversion of a pilot into an instructor (docs/v4-plan.md A.4, B.8, C26). Pure rules, constants, request schemas and wire types.
// A course is `train()` of staff-people.ts: the centre is a building (facilities.ts, effect `training`) that makes the same course cheaper and shorter, and the instructors who hold the type
// set how many people it can teach at once. Imports staff.ts and only types from index.ts, so there is no runtime cycle.
import { z } from 'zod';
import type { AircraftCategory } from './index.ts';
import { DAY_MS } from './lines.ts';
import { ROLE_INSTRUCTOR, TRAINING_COURSE, trainSchema, type StaffFamily, type StaffMember, type TrainPlace } from './staff.ts';

// ---------------------------------------------------------------- the centre (C26)

/** C26: an in-house course costs 0.6 of the outside price. It also lasts 0.75 of its days, rounded up [tuned: the plan fixes the price only]. */
export const TRAINING_INHOUSE_FACTOR = 0.6;
export const TRAINING_INHOUSE_DAYS_FACTOR = 0.75;
/** People one instructor teaches at once; a hub's instructors share their seats between the types they teach. [Tuned.] */
export const SEATS_PER_INSTRUCTOR = 2;

export type Course = { days: number; cost: number };
/** A type rating by category: outside it is S2's `TRAINING_COURSE` (the server's price wins over the mockup's 42 000 euros and 18 days, C26), at the centre the same course made cheaper and shorter. */
export function courseOf(category: AircraftCategory, place: TrainPlace): Course {
  const c = TRAINING_COURSE[category];
  return place === 'outside' ? c : { days: Math.ceil(c.days * TRAINING_INHOUSE_DAYS_FACTOR), cost: Math.round(c.cost * TRAINING_INHOUSE_FACTOR) };
}
/** What the company's centre at one hub can teach: the building, the instructors employed there who hold the type asked about (`teachers`), and the seats all its instructors give together against the own courses running (of any type). */
export type TrainingSeats = { centre: boolean; teachers: number; seats: number; used: number };
/** Why the centre cannot take a pilot now. The words are also the error codes of the refusal (409). */
export type OwnWhy = 'no_training_centre' | 'no_instructor' | 'centre_full';
export const ownWhy = (s: TrainingSeats): OwnWhy | null => (!s.centre ? 'no_training_centre' : s.teachers === 0 ? 'no_instructor' : s.used >= s.seats ? 'centre_full' : null);

// ---------------------------------------------------------------- age and retirement (C26: no medical event)

export const RETIREMENT_AGE = 65;
/** An instructor teaches on the ground, so he works on past the age a pilot may fly until [the plan has one age; with it the reconversion would only delay nothing]. */
export const INSTRUCTOR_RETIREMENT_AGE = 70;
/** The reconversion is put to a pilot this long before his retirement (C26). The conversion itself is open to any captain: nobody would ever have an instructor to start the centre with otherwise. */
export const RETRAIN_WINDOW_DAYS = 365;
/** What an instructor earns of his pay as a pilot (the mockup's 8 600 and 9 800 against 11 400: 75 and 86 %). [Tuned.] */
export const INSTRUCTOR_PAY_PCT = 80;
/** Nobody is hired older than this, so that a hire never retires within five years of the day he signs. */
export const HIRE_AGE_MAX = RETIREMENT_AGE - 5;

/** Age at hiring: a pilot's follows his hours (350 a year from 24), the others' their years of experience, plus the person's own spread (`id * 37 % 8`). The migration backfills the same formula in SQL. */
export const hireAge = (p: { id: number; family: StaffFamily; experience: number }): number =>
  Math.min(HIRE_AGE_MAX, (p.family === 'pilot' ? 24 + Math.floor(p.experience / 350) : 22 + Math.floor(p.experience)) + ((p.id * 37) % 8));
export const birthYearOf = (p: { id: number; family: StaffFamily; experience: number; hiredAt: number }): number => new Date(p.hiredAt).getUTCFullYear() - hireAge(p);

/** The instant a person must stop working: the 1st of January of the year they turn the limit. A row from before the column has no birth year: never. */
export const retirementAt = (birthYear: number | null, role: string): number | null =>
  birthYear === null ? null : Date.UTC(birthYear + (role === ROLE_INSTRUCTOR ? INSTRUCTOR_RETIREMENT_AGE : RETIREMENT_AGE), 0, 1);
export const ageAt = (birthYear: number | null, now: number): number | null => (birthYear === null ? null : new Date(now).getUTCFullYear() - birthYear);
/** A pilot within RETRAIN_WINDOW_DAYS of his retirement. */
export const inRetrainWindow = (retiresAt: number | null, now: number): boolean => retiresAt !== null && retiresAt - now <= RETRAIN_WINDOW_DAYS * DAY_MS;

export const instructorSalary = (salary: number): number => Math.round((salary * INSTRUCTOR_PAY_PCT) / 100 / 50) * 50;

// ---------------------------------------------------------------- request schemas

/** `POST /training/courses`: schedule one pilot's type rating at the centre or outside (the same course as `POST /staff/:id/train`, which also takes `place`). */
export const courseBodySchema = trainSchema.extend({ staffId: z.int().min(1), place: z.enum(['own', 'outside']) });
/** The only reconversion modelled: the mockup's other options (chief pilot, retirement bonus) have effects no model produces (B.8). */
export const retrainSchema = z.object({ option: z.literal('instructor') });

// ---------------------------------------------------------------- wire types

export type CourseView = {
  id: number; staffId: number; name: string; type: string; base: string; place: TrainPlace; startAt: number; endAt: number;
  /** What it cost and what the centre saved against the outside price (0 outside). */
  cost: number; saved: number; running: boolean;
};
/** A pilot who could take a type of the fleet he does not hold, with both courses. `own` is the course at the centre whether or not it can take him; `saved` is `outside.cost - own.cost`. */
export type TrainOffer = { staffId: number; name: string; base: string; type: string; typeName: string; outside: Course; own: Course; saved: number; ownWhy: OwnWhy | null };
/** `inWindow`: within RETRAIN_WINDOW_DAYS of the retirement. */
export type PilotRef = { staffId: number; name: string; base: string; role: StaffMember['role']; age: number | null; retiresAt: number | null; inWindow: boolean; types: string[] };
export type CentreView = { hub: string; instructors: number; seats: number; used: number; monthly: number };
export type TrainingView = {
  /** People in a course now (the centre's own and outside ones). */
  running: number;
  /** Saved against outside prices since 1 January. */
  savedYear: number;
  centres: CentreView[]; courses: CourseView[]; offers: TrainOffer[]; instructors: PilotRef[];
  /** Pilots who could be made instructors, soonest retirement first. */
  convertible: PilotRef[];
};

export type RetrainWhy = 'not_a_pilot' | 'not_employed' | 'temporary_contract' | 'already_instructor' | 'not_a_captain' | 'no_rating';
/** `offer`: what the conversion would do (null when `why` says it cannot be done): his pay as an instructor, his retirement then, the types he would teach, the seats he adds to the centre
 *  (`centre`: whether the company holds one at his base, without it he teaches nobody). `gap`: for each type he holds, the line pilots left at his base without him against what its timetable needs. */
export type RetrainView = {
  member: StaffMember; age: number | null; retiresAt: number | null; inWindow: boolean;
  offer: { salary: number; retiresAt: number | null; types: string[]; seats: number; centre: boolean } | null; why: RetrainWhy | null;
  gap: { type: string; have: number; need: number }[];
};
export type RetrainResult = { member: StaffMember; salary: number };
