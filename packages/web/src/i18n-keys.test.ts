import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDIT_BANK_IDS, CREDIT_REFUSALS, SIM_AIRCRAFT_SOURCES, CATEGORIES, COST_PARTS, DECISIONS, FINANCE_SCREENS, PROFIT_BY, SCENARIOS, AIRCRAFT_CATEGORIES, COMPONENTS, FACILITY_KINDS, HAULS, MECHANICAL, MEAL_QUALITIES, PARTS_POLICIES, PART_CLASSES, REALISM_TOGGLES, RANKS, REST_POLICY_NAMES, SERVICE_ITEMS, SERVICE_MODES, STAFF_FAMILIES, WTCS, type AirportSize, type Ownership } from '@opc/shared';
import { CESSION_REFUSALS, GROUP_ACTIVITIES, GROUP_CREATE_REFUSALS, GROUP_ROLES, SCOPES } from '@opc/shared';
import { BALLOT_CHOICES, VOTE_STATUSES } from '@opc/shared';
import { PAY_LEVELS, type PayLevel } from '@opc/shared';
import type { Coverage, DutyRule, StaffRole, StaffState } from './api-staff.ts';
import type { Meter, Level } from './staff-view.ts';
import type { DuelKey, Kind } from './standings.ts';
import type { OpsBadge, LineVisual, Part, Phase } from './lines-view.ts';
import type { ProjectionStatus, ResolveOption, ScheduledFlightStatus } from './api-lines.ts';
import type { AddonCategory } from './finance-view.ts';
import type { RowState } from './simair-view.ts';
import type { EffectLines } from './parts-view.ts';
import type { Comfort, Effect } from './service-view.ts';
import { OWN_WHY, RETRAIN_WHY } from './training-view.ts';
import { ACTIVITY_KEY, CESSION_KEY, CREATE_REFUSAL_KEY, ROLE_KEY } from './group-view.ts';
import { BALLOT_KEY, CHOICE_KEY, PROPOSE_KEY, STATUS_KEY } from './alliance-view.ts';
import { OPTION_HASH, OPTION_NOTE, OPTION_PHASES, OPTION_SUB, OPTION_TITLE, OPTION_UNAVAILABLE, SAVED_AGAINST } from './agency-view.ts';
import type { KitchenDeparture } from './api-service.ts';
import type { AgencyOptionId } from './api-agency.ts';
import type { OwnWhy, RetrainWhy, TrainPlace } from './api-training.ts';
import type { TrainMode } from './training-view.ts';
import { METRICS } from './kitchen-view.ts';
import { LEVEL_KEY } from './hr-view.ts';
import type { NoAircraftReason } from './board.ts';
import { GROUPS } from './catalogue.ts';
import { GROUPS as SERVICE_GROUPS } from './service-view.ts';
import { STATUS_FILTERS } from './history.ts';
import { LADDER, LIVERY_COLORS, PRESETS } from './onboarding-model.ts';
import { CAUSE_KEYS, OPS_FILTERS, WEEKDAYS } from './lines-view.ts';
import { SORT_KEYS } from './standings.ts';
import { PERIODS } from './reports-view.ts';
import { translate, translateCode, translatePlural } from './i18n.ts';
import { en, fr, messageFor } from './messages.ts';

/**
 * Every message the UI builds from a closed set of values (`t(`st.role.${role}`)`) must exist in both languages for every value.
 * `typecheck` already refuses a lookup that no message matches; this walks the real values, so a union that grows without its messages fails here too.
 * A union with no runtime list is written as a `Record<Union, ...>`: adding a member to the union breaks this file's typecheck until it is listed.
 */
const every = <T extends string>(all: Record<T, unknown>): T[] => Object.keys(all) as T[];

const ROLES = every<StaffRole>({ captain: 0, fo: 0, attendant: 0, agent: 0, clerk: 0, technician: 0, cook: 0, instructor: 0 });
const STAFF_STATES = every<StaffState>({ pending: 0, free: 0, onDuty: 0, resting: 0, leave: 0, training: 0 });
const COVERAGES = every<Coverage>({ ok: 0, tight: 0, short: 0, none: 0 });
const DUTY_RULES = every<DutyRule>({ busy: 0, rest: 0, daily: 0, flight28: 0, flight12: 0, week: 0, streak: 0 });
const LEVELS = every<Level>({ high: 0, medium: 0, low: 0 });
const METERS = every<Meter['key']>({ 28: 0, 7: 0, 12: 0 });
const FLIGHT_STATUSES = every<ScheduledFlightStatus>({ scheduled: 0, flying: 0, done: 0, delayed: 0, cancelled: 0 });
const PROJECTIONS = every<ProjectionStatus>({ assured: 0, stopped: 0, off: 0 });
const LINE_VISUALS = every<LineVisual>({ ok: 0, delayed: 0, interrupted: 0, paused: 0 });
const BADGES = every<OpsBadge>({ ontime: 0, delayed: 0, cancelled: 0, mine: 0 });
const PHASES = every<Phase>({ climb: 0, cruise: 0, descent: 0 });
const PARTS = every<Part>({ fuel: 0, fees: 0, crews: 0, maintenance: 0, margin: 0 });
const OPTIONS = every<ResolveOption>({ reassign: 0, recruit: 0, pause: 0, interim: 0, start_now: 0 });
const KINDS = every<Kind>({ you: 0, pilot: 0, cautious: 0, aggressive: 0 });
const DUEL_KEYS = every<DuelKey>({ worth: 0, gain: 0, flights: 0, reputation: 0, hours: 0, revenuePerFlight: 0 });
const OWNERSHIPS = every<Ownership>({ owned: 0, leased: 0, financed: 0, club: 0, rented: 0 });
const AIRPORT_SIZES = every<AirportSize>({ large: 0, medium: 0, small: 0 });
const ADDONS = every<AddonCategory>({ piston: 0, turboprop: 0, jet: 0, helicopter: 0 });
const NO_AIRCRAFT_REASONS = every<NoAircraftReason['kind']>({ none: 0, type: 0, seats: 0, cargo: 0, range: 0, unsuited: 0, elsewhere: 0, far: 0, arriving: 0, busy: 0 });
const STYLES = ['cautious', 'aggressive'] as const;
const EFFECT_KINDS = every<NonNullable<EffectLines['main']>['kind']>({ performance: 0, reliability: 0, satisfaction: 0 });
const COMFORTS = every<Comfort['level']>({ basic: 0, comfort: 0, premium: 0 });
const TRADES = every<Effect['label']>({ sat: 0, margin: 0, meals: 0, cooks: 0 });
const DEPARTURES = every<KitchenDeparture['status']>({ scheduled: 0, done: 0 });
const CATALOGUES = every<'reduced' | 'full'>({ reduced: 0, full: 0 });
const AGENCY_OPTIONS = every<AgencyOptionId>({ agency: 0, train: 0, classic: 0 });
const SIM_STATES = every<RowState>({ offered: 0, hidden: 0, noType: 0 });
const OWN_WHYS = every<OwnWhy>({ no_training_centre: 0, no_instructor: 0, centre_full: 0 });
const RETRAIN_WHYS = every<RetrainWhy>({ not_a_pilot: 0, not_employed: 0, temporary_contract: 0, already_instructor: 0, not_a_captain: 0, no_rating: 0 });
const TRAIN_MODES = every<TrainMode>({ trainees: 0, instructors: 0 });
const TRAIN_PLACES = every<TrainPlace>({ own: 0, outside: 0 });
const PAY_LEVEL_UNION: Record<PayLevel, 0> = { '-10': 0, '-5': 0, 0: 0, 5: 0, 10: 0 };

/** [message prefix, the values it is followed by, an optional suffix]. */
const LOOKUPS: readonly (readonly [string, readonly (string | number)[], string?])[] = [
  ['st.fam.', STAFF_FAMILIES], ['st.fam.sub.', STAFF_FAMILIES], ['st.fam.short.', STAFF_FAMILIES],
  ['st.role.', ROLES], ['st.role.', ROLES, 'Full'],
  ['st.view.', ['staff', 'hire', 'agency', 'training', 'hr']], ['st.level.', LEVELS], ['st.m.state.', STAFF_STATES], ['st.contract.', ['cdi', 'cdd']],
  ['st.al.rule.', DUTY_RULES], ['st.lim.', METERS], ['st.l.c.', COVERAGES], ['st.l.d.', COVERAGES], ['st.du.l.', ['done', 'flying', 'planned', 'over']],
  ['st.p.', REST_POLICY_NAMES], ['st.p.btn.', REST_POLICY_NAMES],
  ['ln.wd.', WEEKDAYS], ['ln.fs.', FLIGHT_STATUSES], ['ln.part.', PARTS], ['ln.why.', ['aircraft', 'crew']], ['ln.applied.', OPTIONS], ['ln.proj.day.', PROJECTIONS],
  ['ln.state.', LINE_VISUALS], ['ln.ops.b.', BADGES], ['ln.ops.phase.', PHASES], ['ln.ops.f.', OPS_FILTERS],
  ['cat.', AIRCRAFT_CATEGORIES], ['wtc.', WTCS], ['cat.group.', [...GROUPS, ...ADDONS]],
  ['lb.kind.', [...KINDS, 'ai']], ['lb.sort.', SORT_KEYS], ['hist.tab.', STATUS_FILTERS], ['duel.', DUEL_KEYS],
  ['sheet.style.', STYLES], ['sheet.doctrine.', STYLES], ['fin.own.', OWNERSHIPS], ['hub.size.', AIRPORT_SIZES],
  ['fc.kind.', [...FACILITY_KINDS, 'all', 'parking']], ['fc.lv.maintenance.', [1, 2, 3]],
  ['rank.', RANKS.map((_, i) => i)],
  ['ob.s3b.rung.', LADDER.map((l) => l.id)], ['ob.s4.', PRESETS], ['ob.s4.', PRESETS, 'Desc'], ['ob.s4.t.', REALISM_TOGGLES], ['ob.s4.d.', REALISM_TOGGLES],
  ['pt.c.', COMPONENTS], ['pt.cls.', PART_CLASSES], ['pt.w.pol.', PARTS_POLICIES], ['pt.w.aog.fail.', MECHANICAL], ['pt.r.eff.', EFFECT_KINDS],
  ['sv.haul.', HAULS], ['sv.haul.on.', HAULS], ['sv.haul.sub.', HAULS], ['sv.mode.', [...SERVICE_MODES, 'unavailable']], ['sv.item.', SERVICE_ITEMS],
  ['sv.group.', SERVICE_GROUPS.map((g) => g.id)], ['sv.comfort.', COMFORTS], ['sv.q.', MEAL_QUALITIES], ['sv.trade.', TRADES], ['sv.cell.catalogue.', CATALOGUES],
  ['kt.m.', METRICS.map((m) => m.id)], ['kt.m.', METRICS.map((m) => m.id), '.sub'], ['kt.q.', MEAL_QUALITIES, '.desc'], ['kt.dep.', DEPARTURES],
  ['ferry.why.', NO_AIRCRAFT_REASONS],
  ['sa.state.', SIM_STATES], ['sa.source.', SIM_AIRCRAFT_SOURCES], ['set.nav.', ['keys', 'aircraft', 'simbrief', 'account']],
  ['ob.s2.color.', [...LIVERY_COLORS.map((c) => c.id), 'none']], ['ob.s6.own.', [...OWNERSHIPS, 'plain']],
  ['rp.cat.', CATEGORIES], ['rp.part.', COST_PARTS], ['rp.sc.', SCENARIOS], ['rp.sc.', SCENARIOS, '.note'], ['rp.f.d.', DECISIONS], ['rp.f.d.', DECISIONS, '.note'],
  ['rp.nav.', FINANCE_SCREENS], ['rp.l.by.', PROFIT_BY], ['rp.l.period.', PERIODS],
  ['tr.why.', OWN_WHYS], ['err.', OWN_WHYS], ['rt.why.', RETRAIN_WHYS], ['tr.mode.', TRAIN_MODES], ['tr.place.', TRAIN_PLACES],
  ['cr.bank.', CREDIT_BANK_IDS], ['cr.refusal.', CREDIT_REFUSALS], ['err.', CREDIT_REFUSALS],
  ['scope.', SCOPES], ['gr.activity.', GROUP_ACTIVITIES], ['gr.role.', GROUP_ROLES], ['gr.cession.', CESSION_REFUSALS], ['gr.refusal.', GROUP_CREATE_REFUSALS], ['err.', ['has_subsidiaries', 'has_debt', 'is_subsidiary', 'not_in_group', 'leased_aircraft', 'aircraft_not_found', 'code_taken']],
  ['tx.kind.', ['credit', 'credit_fee', 'credit_installment', 'credit_prepay', 'credit_late_fee', 'overdraft_interest']], ['fin.kind.', ['credit_installment', 'overdraft_interest']],
  ['err.', ['not_in_alliance', 'alliance_full', 'alliance_name_taken', 'already_member', 'already_invited', 'already_voted', 'vote_closed', 'vote_not_found', 'not_invitable', 'leaving', 'already_leaving', 'company_not_found', 'invitation_not_found']],
  ['tx.kind.', ['alliance_dues']], ['fin.kind.', ['alliance_dues']],
];

test('every value of every closed set a message is looked up by has a message in both languages', () => {
  const missing: string[] = [];
  for (const [prefix, values, suffix = ''] of LOOKUPS) {
    for (const v of values) {
      const key = `${prefix}${v}${suffix}`;
      if (messageFor(key) === null) { missing.push(key); continue; }
      for (const lang of ['en', 'fr'] as const) {
        const text = (lang === 'en' ? en : fr)[key as keyof typeof en];
        if (text.trim() === '' || text === key) missing.push(`${key} (${lang})`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('the training reasons map to a message in both languages, every one of them typed', () => {
  for (const key of [...Object.values(OWN_WHY), ...Object.values(RETRAIN_WHY)]) for (const lang of ['en', 'fr'] as const) assert.notEqual((lang === 'en' ? en : fr)[key].trim(), '', `${key} (${lang})`);
  assert.deepEqual(Object.keys(OWN_WHY).sort(), OWN_WHYS.slice().sort());
  assert.deepEqual(Object.keys(RETRAIN_WHY).sort(), RETRAIN_WHYS.slice().sort());
});

test('every agency option has its title, sub, note, phases, unavailable reason, and a place to go; the keys are typed, so a new option breaks the Record before it reaches here', () => {
  const keys = [OPTION_TITLE, OPTION_SUB, OPTION_NOTE, OPTION_PHASES, OPTION_UNAVAILABLE].flatMap((m) => AGENCY_OPTIONS.map((o) => m[o]));
  keys.push(...(Object.values(SAVED_AGAINST)));
  for (const key of keys) for (const lang of ['en', 'fr'] as const) assert.notEqual((lang === 'en' ? en : fr)[key].trim(), '', `${key} (${lang})`);
  assert.deepEqual(Object.keys(OPTION_HASH).sort(), AGENCY_OPTIONS.filter((o) => o !== 'agency').sort());
});

test('every group union has its message, through the typed Record the screens look it up by', () => {
  const keys = [...GROUP_ACTIVITIES.map((a) => ACTIVITY_KEY[a]), ...GROUP_ROLES.map((r) => ROLE_KEY[r]), ...CESSION_REFUSALS.map((c) => CESSION_KEY[c]), ...GROUP_CREATE_REFUSALS.map((c) => CREATE_REFUSAL_KEY[c])];
  assert.equal(keys.length, GROUP_ACTIVITIES.length + GROUP_ROLES.length + CESSION_REFUSALS.length + GROUP_CREATE_REFUSALS.length);
  for (const key of keys) for (const lang of ['en', 'fr'] as const) assert.notEqual((lang === 'en' ? en : fr)[key].trim(), '', `${key} (${lang})`);
});

test('every alliance union has its message, through the typed Record the screens look it up by', () => {
  const keys = [...VOTE_STATUSES.map((v) => STATUS_KEY[v]), ...BALLOT_CHOICES.flatMap((c) => [CHOICE_KEY[c], BALLOT_KEY[c]]), ...Object.values(PROPOSE_KEY)];
  assert.equal(keys.length, VOTE_STATUSES.length + BALLOT_CHOICES.length * 2 + 2);
  for (const key of keys) for (const lang of ['en', 'fr'] as const) assert.notEqual((lang === 'en' ? en : fr)[key].trim(), '', `${key} (${lang})`);
});

test('every pay level has its message, through the typed Record the HR screen looks it up by', () => {
  assert.deepEqual(Object.keys(LEVEL_KEY).sort(), Object.keys(PAY_LEVEL_UNION).sort(), 'the Record lists exactly the levels of the union');
  assert.deepEqual(Object.keys(PAY_LEVEL_UNION).map(Number).sort((a, b) => a - b), [...PAY_LEVELS], 'and the union is the shared list');
  for (const key of PAY_LEVELS.map((l) => LEVEL_KEY[l])) for (const lang of ['en', 'fr'] as const) assert.notEqual((lang === 'en' ? en : fr)[key].trim(), '', `${key} (${lang})`);
});

test('a cancellation cause maps to a message in both languages', () => {
  for (const key of Object.values(CAUSE_KEYS)) {
    assert.notEqual(translate('en', key), key);
    assert.notEqual(translate('fr', key), key);
  }
});

test('the roles the staff screens used to show as raw keys read in words, in French first', () => {
  const fr_ = (key: 'st.role.attendant' | 'st.role.agent' | 'st.role.clerk' | 'st.role.technician' | 'st.role.cook' | 'st.role.attendantFull' | 'st.role.agentFull' | 'st.role.clerkFull' | 'st.role.technicianFull' | 'st.role.cookFull'): string => translate('fr', key);
  assert.deepEqual(
    [fr_('st.role.attendant'), fr_('st.role.agent'), fr_('st.role.clerk'), fr_('st.role.technician'), fr_('st.role.cook')],
    ['PNC', 'Agent', 'Adm.', 'Technicien', 'Cuisinier']);
  assert.deepEqual(
    [fr_('st.role.attendantFull'), fr_('st.role.agentFull'), fr_('st.role.clerkFull'), fr_('st.role.technicianFull'), fr_('st.role.cookFull')],
    ['Personnel navigant commercial', 'Agent d’escale', 'Employé administratif', 'Technicien de maintenance', 'Cuisinier']);
});

test('a code the server sends that has no message reads as words, never as a key', () => {
  assert.equal(translateCode('fr', 'payroll', 'fin.kind'), 'Masse salariale');
  assert.equal(translateCode('fr', 'severance', 'tx.kind', 'fin.kind'), 'indemnité de départ');
  assert.equal(translateCode('fr', 'parking', 'tx.kind', 'fin.kind'), 'Parking');
  assert.equal(translateCode('en', 'brand_new_kind', 'tx.kind', 'fin.kind'), 'brand new kind');
  assert.equal(translateCode('fr', 'brand_new_kind', 'fin.kind'), 'brand new kind');
});

test('counts of one read in the singular (French counts 0 and 1 as singular)', () => {
  assert.equal(translatePlural('en', 'st.avail.vacant', 1), '1 vacant');
  assert.equal(translatePlural('fr', 'st.avail.vacant', 1), '1 vacant');
  assert.equal(translatePlural('fr', 'st.avail.vacant', 3), '3 vacants');
  assert.equal(translatePlural('fr', 'st.avail.free', 1), '1 disponible');
  assert.equal(translatePlural('fr', 'st.avail.free', 4), '4 disponibles');
  assert.equal(translatePlural('fr', 'fc.hub.parkingUsed', 1, { used: 1, spots: 10 }), '1 occupé sur 10');
  assert.equal(translatePlural('fr', 'fc.hub.parkingUsed', 4, { used: 4, spots: 10 }), '4 occupés sur 10');
  assert.equal(translatePlural('fr', 'job.contestedNote', 1, { names: 'Méridia', origin: 'LFMN' }), 'Méridia peut prendre ce job au départ de LFMN.');
  assert.equal(translatePlural('fr', 'job.contestedNote', 2, { names: 'A, B', origin: 'LFMN' }), 'A, B peuvent prendre ce job au départ de LFMN.');
});

const SRC = import.meta.dirname;
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && e.name !== 'messages.ts' ? [join(dir, e.name)] : []));

test('no source casts a built string to a message key: the cast is what hid the missing roles', () => {
  const casts = sources(SRC).flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (/`\s+as\s+(Key|'[a-z][\w.]*')/.test(line) || /\bas Key\b/.test(line) ? [`${f.slice(SRC.length + 1)}:${i + 1}`] : [])));
  assert.deepEqual(casts, []);
});

test('every literal plural base passed to tp() has a .one and a .other message', () => {
  const bases = new Set(sources(SRC).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\btp\('([\w.]+)'/g)].map((m) => m[1]!)));
  assert.ok(bases.size > 20, `found ${bases.size} plural bases`);
  const bad = [...bases].filter((b) => messageFor(`${b}.one`) === null || messageFor(`${b}.other`) === null);
  assert.deepEqual(bad, []);
});
