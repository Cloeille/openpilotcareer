'use strict';
/* View-model tests for the EFB tablet: the three design frames (flight, finished, rejected), the optional fields the
 * bridge does not send yet (shown as a dash, never invented), close-flight rules, languages and number formats. */
const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('../openpilotcareer-panel/html_ui/InGamePanels/OpenPilotCareer/view-model.js');
const { SCENARIOS } = require('../mock/mock-status-server.js');

const DASH = '\u2014';
const NBSP = '\u00A0';
const MINUS = '\u2212';
const FR = { lang: 'fr' };
const EN = { lang: 'en' };
const BARE_FLIGHT = { id: 7, from: 'LFMN', to: 'LFPG', aircraftIcao: 'AT76' };
const bare = (over = {}) => ({ phase: 'airborne', flight: BARE_FLIGHT, verification: 'pending', flags: [], serverUrl: 'https://x.example', ...over });
const scenario = (name, opts = FR) => VM.fromStatus(SCENARIOS[name], opts);

test('flight frame: status line, title, meta, route, stepper, facts and footer come from the bridge data', () => {
  const vm = scenario('efb-flight');
  assert.equal(vm.mode, 'flight');
  assert.equal(vm.view.status.text, 'En vol \u00B7 croisi\u00E8re FL240');
  assert.equal(vm.view.title, 'Nice \u2192 Paris-CDG');
  assert.equal(vm.view.meta, 'AZR 4127 \u00B7 ATR 72-600 \u00B7 F-HAZR');
  assert.deepEqual(vm.view.route, { from: 'LFMN', to: 'LFPG', progress: 0.37, label: 'Progression du trajet : 37 pour cent' });
  assert.deepEqual(vm.view.steps.map((s) => [s.label, s.state]), [['Pr\u00E9paration', 'done'], ['Roulage', 'done'], ['En vol', 'current'], ['Atterri', 'todo'], ['Parqu\u00E9', 'todo']]);
  assert.deepEqual(vm.view.facts.map((f) => [f.label, f.value]), [
    ['Arriv\u00E9e pr\u00E9vue', '18:42Z'],
    ['Carburant \u00E0 l\u2019arriv\u00E9e', `1${NBSP}280${NBSP}kg`],
    ['Gain estim\u00E9', `\u2248${NBSP}14${NBSP}820${NBSP}\u20AC`],
  ]);
  assert.equal(vm.footer.verifText, 'V\u00E9rification en cours \u00B7 aucune anomalie');
  assert.equal(vm.footer.canClose, false);
  assert.equal(vm.footer.hint, 'Disponible une fois parqu\u00E9');
  assert.equal(vm.header.clock, '17:56Z');
  assert.deepEqual(vm.tabs.map((t) => t.label), ['Vol', 'Job', 'SimBrief', 'Cabine']);
});

test('finished frame: landing figures, verified box with the net pay, report link and a close button that works', () => {
  const vm = scenario('efb-finished');
  assert.equal(vm.mode, 'finished');
  assert.equal(vm.view.title, 'Vol termin\u00E9');
  assert.equal(vm.view.status.text, 'Parqu\u00E9 \u00B7 poste F12 \u00B7 18:39Z');
  assert.equal(vm.view.meta, 'AZR 4127 \u00B7 LFMN \u2192 LFPG \u00B7 1 h 41');
  assert.deepEqual(vm.view.results.map((r) => [r.label, r.value, r.sub]), [
    ['Taux d\u2019atterrissage', `${MINUS}142${NBSP}ft/min`, 'Atterrissage en douceur'],
    ['Facteur de charge', `1,18${NBSP}g`, null],
    ['Carburant restant', `1${NBSP}310${NBSP}kg`, `+30${NBSP}kg vs SimBrief`],
  ]);
  const v = vm.view.verdict;
  assert.equal(v.tone, 'ok');
  assert.equal(v.title, 'Vol v\u00E9rifi\u00E9 par le pont SimConnect');
  assert.equal(v.text, 'Aucune anomalie : ni slew, ni acc\u00E9l\u00E9ration du temps, ni pause, ni saut de position.');
  assert.equal(v.gainLabel, 'Gain net');
  assert.equal(v.gainValue, `+14${NBSP}820${NBSP}\u20AC`);
  assert.equal(v.gainTone, 'ok');
  assert.equal(vm.footer.link.label, 'Voir le rapport complet');
  assert.equal(vm.footer.canClose, true);
  assert.equal(vm.footer.closeLabel, 'Cl\u00F4turer le vol');
  assert.equal(vm.footer.closeKey, 'Entr\u00E9e');
  assert.equal(vm.footer.hint, null);
});

test('rejected frame: the reason is shown, the pay is 0 EUR, nothing is paid or counted', () => {
  const vm = scenario('efb-rejected');
  assert.equal(vm.mode, 'rejected');
  assert.equal(vm.view.title, 'Vol rejet\u00E9');
  const v = vm.view.verdict;
  assert.equal(v.tone, 'bad');
  assert.equal(v.icon, 'shield-x');
  assert.equal(v.title, 'Vol rejet\u00E9 par la v\u00E9rification');
  assert.equal(v.gainValue, `0${NBSP}\u20AC`);
  assert.equal(v.gainTone, 'muted');
  assert.match(v.text, /Acc\u00E9l\u00E9ration du temps/);
  assert.match(v.text, /Le vol n\u2019est pas pay\u00E9 et ne compte pas pour la saison\.$/);
  assert.equal(vm.footer.link.label, 'Voir le d\u00E9tail du vol');
  assert.equal(vm.footer.canClose, true);
  assert.equal(vm.verification.reason, SCENARIOS['efb-rejected'].reason);
});

test('rejected: a free-text reason from the bridge is shown as sent, flag codes are said in the pilot\u2019s language', () => {
  const free = VM.fromStatus(bare({ phase: 'parked', verification: 'rejected', reason: 'Landed at LFMD, not at the destination LFPG.' }), EN).view.verdict.text;
  assert.equal(free, 'Landed at LFMD, not at the destination LFPG. The flight is not paid and does not count for the season.');
  const both = VM.fromStatus(bare({ phase: 'parked', verification: 'rejected', reason: 'Too fast.', flags: ['slew_detected'] }), EN).view.verdict.text;
  assert.equal(both, 'Too fast. Flags: Slew mode used. The flight is not paid and does not count for the season.');
  const codeOnly = VM.fromStatus(bare({ phase: 'parked', verification: 'rejected', reason: 'flagged: long_pause', flags: ['long_pause'] }), EN).view.verdict.text;
  assert.equal(codeOnly, 'Flags: Long pause. The flight is not paid and does not count for the season.');
  const none = VM.fromStatus(bare({ phase: 'parked', verification: 'rejected' }), EN).view.verdict.text;
  assert.equal(none, 'No reason given. The flight is not paid and does not count for the season.');
});

test('finished with anti-cheat flags says so instead of claiming "no anomaly"', () => {
  const vm = VM.fromStatus(bare({ phase: 'parked', verification: 'verified', flags: ['long_pause'], result: { netPay: 1200 } }), EN);
  assert.equal(vm.mode, 'finished');
  assert.match(vm.view.verdict.text, /^Accepted with 1 flag raised: Long pause\.$/);
});

test('fields the bridge does not send are a dash, never a made-up number', () => {
  const vm = VM.fromStatus(bare(), EN);
  assert.equal(vm.mode, 'flight');
  assert.deepEqual(vm.view.facts.map((f) => f.value), [DASH, DASH, DASH]);
  assert.equal(vm.view.title, 'LFMN \u2192 LFPG');
  assert.equal(vm.view.meta, 'AT76');
  assert.equal(vm.header.clock, DASH);
  assert.equal(vm.view.route.progress, null);
  assert.equal(vm.view.route.label, 'Route progress unknown');
  assert.equal(vm.view.status.text, 'Airborne');
  const done = VM.fromStatus(bare({ phase: 'parked', verification: 'verified' }), EN);
  assert.deepEqual(done.view.results.map((r) => r.value), [DASH, DASH, DASH]);
  assert.deepEqual(done.view.results.map((r) => r.sub), [null, null, null]);
  assert.equal(done.view.verdict.gainValue, DASH);
  assert.equal(done.view.verdict.gainTone, 'muted');
  assert.equal(done.view.meta, 'LFMN \u2192 LFPG');
});

test('wrongly typed optional fields degrade to a dash instead of an error', () => {
  const vm = VM.fromStatus(bare({ live: { etaAt: 'soon', fuelArrivalKg: NaN, progress: '0.4' }, estimatedPay: '14820', plan: 'x', cabin: [], simTime: null, sim: 'maybe', result: 5 }), EN);
  assert.equal(vm.connection, 'online');
  assert.deepEqual(vm.view.facts.map((f) => f.value), [DASH, DASH, DASH]);
  assert.equal(vm.view.route.progress, null);
  assert.equal(vm.header.clock, DASH);
  assert.equal(vm.header.bridgeTone, 'ok');
  const text = JSON.stringify(vm);
  assert.ok(!text.includes('NaN') && !text.includes('undefined'), text.slice(0, 200));
});

test('route progress: from the bridge when given (clamped), 0 before take-off, 1 once landed, unknown while airborne without data', () => {
  const at = (phase, live) => VM.fromStatus(bare({ phase, live }), EN).view.route.progress;
  assert.equal(at('airborne', { progress: 0.5 }), 0.5);
  assert.equal(at('airborne', { progress: 7 }), 1);
  assert.equal(at('airborne', { progress: -2 }), 0);
  assert.equal(at('preflight'), 0);
  assert.equal(at('taxiOut'), 0);
  assert.equal(at('airborne'), null);
});

test('status line says "cruise" only when the plan\u2019s cruise level is known and the aircraft is near it', () => {
  const line = (live, plan) => VM.fromStatus(bare({ live, plan }), EN).view.status.text;
  assert.equal(line({ altFt: 24000 }, { cruiseAltFt: 24000 }), 'Airborne \u00B7 Cruise FL240');
  assert.equal(line({ altFt: 23500 }, { cruiseAltFt: 24000 }), 'Airborne \u00B7 Cruise FL235');
  assert.equal(line({ altFt: 12000 }, { cruiseAltFt: 24000 }), `Airborne \u00B7 12${NBSP}000${NBSP}ft`);
  assert.equal(line({ altFt: 24000 }, undefined), 'Airborne \u00B7 FL240');
  assert.equal(line(undefined, { cruiseAltFt: 24000 }), 'Airborne');
});

test('close flight: only a parked flight can be closed; a verdict that arrives later re-opens it', () => {
  assert.equal(VM.fromStatus(bare({ phase: 'airborne' }), EN).canClose, false);
  assert.equal(VM.fromStatus(bare({ phase: 'landed' }), EN).canClose, false);
  assert.equal(VM.fromStatus(bare({ phase: 'parked', verification: 'pending' }), EN).canClose, true);
  assert.equal(VM.fromStatus(bare({ phase: 'parked', flight: null, verification: null }), EN).canClose, false);

  const pending = VM.fromStatus(bare({ phase: 'parked', verification: 'pending' }), EN);
  assert.equal(pending.closeKey, '7:pending');
  const closed = VM.fromStatus(bare({ phase: 'parked', verification: 'pending' }), { lang: 'en', closed: pending.closeKey });
  assert.equal(closed.mode, 'closed');
  assert.equal(closed.canClose, false);
  assert.equal(closed.view.title, 'Flight closed');
  assert.equal(closed.footer.hint, 'No active flight');
  const verdict = VM.fromStatus(bare({ phase: 'parked', verification: 'verified' }), { lang: 'en', closed: pending.closeKey });
  assert.equal(verdict.mode, 'finished');
  const other = VM.fromStatus(bare({ phase: 'parked', verification: 'pending', flight: { ...BARE_FLIGHT, id: 8 } }), { lang: 'en', closed: pending.closeKey });
  assert.equal(other.mode, 'flight');
  const flying = VM.fromStatus(bare({ phase: 'airborne', verification: 'pending' }), { lang: 'en', closed: pending.closeKey });
  assert.equal(flying.mode, 'flight');
});

test('no flight: idle screen with the instruction, nothing to close', () => {
  const vm = VM.fromStatus(bare({ phase: 'parked', flight: null, verification: null }), EN);
  assert.equal(vm.mode, 'idle');
  assert.equal(vm.view.title, 'No active flight');
  assert.match(vm.view.text, /Accept a job in the web app/);
  assert.equal(vm.footer.verifText, 'Nothing to verify');
  assert.equal(vm.footer.canClose, false);
  assert.equal(vm.footer.hint, 'No active flight');
  assert.equal(vm.job.active, false);
});

test('footer verification line: running with flags warns, not started and nothing-to-verify are plain', () => {
  const flagged = VM.fromStatus(bare({ flags: ['slew_detected', 'long_pause'] }), EN).footer;
  assert.equal(flagged.verifText, 'Verification in progress \u00B7 2 flags raised');
  assert.equal(flagged.verifTone, 'warn');
  assert.equal(flagged.verifIcon, 'triangle-alert');
  assert.equal(VM.fromStatus(bare({ phase: 'preflight', verification: null }), EN).footer.verifText, 'Verification not started');
  assert.equal(VM.fromStatus(bare(), EN).footer.verifTone, 'muted');
});

test('sim state shows in the status bar only when the simulator is not connected', () => {
  const head = (sim) => VM.fromStatus(bare({ sim }), EN).header;
  assert.deepEqual([head('connected').bridgeTone, head('connected').bridgeLabel], ['ok', 'Bridge connected']);
  assert.deepEqual([head('waiting').bridgeTone, head('waiting').bridgeLabel], ['wait', 'Waiting for MSFS']);
  assert.deepEqual([head('unavailable').bridgeTone, head('unavailable').bridgeLabel], ['wait', 'MSFS unavailable']);
  assert.equal(head(undefined).bridgeTone, 'ok');
  assert.equal(head('connected').bridgeSr, 'Bridge connected');
  assert.match(head('waiting').bridgeSr, /waiting for the simulator/);
});

test('clock is the sim UTC time as HH:MMZ', () => {
  assert.equal(VM.format.timeZ(Date.UTC(2026, 10, 6, 7, 5)), '07:05Z');
  assert.equal(VM.format.timeZ(Date.UTC(2026, 10, 6, 23, 59, 59)), '23:59Z');
  for (const bad of [0, -5, NaN, 'x', null, undefined, Infinity]) assert.equal(VM.format.timeZ(bad), DASH);
});

test('number formats: French uses non-breaking spaces and a decimal comma, English commas', () => {
  assert.equal(VM.format.money(14820, 'fr', { sign: true }), `+14${NBSP}820${NBSP}\u20AC`);
  assert.equal(VM.format.money(14820, 'en', { sign: true }), '+\u20AC14,820');
  assert.equal(VM.format.money(-2500, 'en'), `${MINUS}\u20AC2,500`);
  assert.equal(VM.format.money(1284560, 'fr'), `1${NBSP}284${NBSP}560${NBSP}\u20AC`);
  assert.equal(VM.format.money(0, 'fr'), `0${NBSP}\u20AC`);
  assert.equal(VM.format.money(NaN, 'fr'), DASH);
  assert.equal(VM.format.kg(1310, 'fr'), `1${NBSP}310${NBSP}kg`);
  assert.equal(VM.format.kg(999, 'en'), `999${NBSP}kg`);
  assert.equal(VM.format.kg('1310', 'en'), DASH);
  assert.equal(VM.format.g(1.18, 'fr'), `1,18${NBSP}g`);
  assert.equal(VM.format.g(1.18, 'en'), `1.18${NBSP}g`);
  assert.equal(VM.format.fpm(-142, 'en'), `${MINUS}142${NBSP}ft/min`);
  assert.equal(VM.format.fpm(undefined, 'en'), DASH);
  assert.equal(VM.format.duration(101, 'fr'), '1 h 41');
  assert.equal(VM.format.duration(125, 'fr'), '2 h 05');
  assert.equal(VM.format.duration(45, 'en'), '45 min');
  assert.equal(VM.format.duration(-1, 'en'), null);
  assert.equal(VM.format.level(24000), 'FL240');
  assert.equal(VM.format.level(5000), `5${NBSP}000${NBSP}ft`);
  assert.equal(VM.format.level(0), null);
});

test('landing categories follow the server\u2019s hard-landing threshold (600 ft/min)', () => {
  const sub = (fpm) => VM.fromStatus(bare({ phase: 'parked', verification: 'verified', result: { landingFpm: fpm } }), EN).view.results[0].sub;
  assert.equal(sub(-142), 'Smooth landing');
  assert.equal(sub(-250), 'Smooth landing');
  assert.equal(sub(-251), 'Firm landing');
  assert.equal(sub(-599), 'Firm landing');
  assert.equal(sub(-600), 'Hard landing');
  assert.equal(sub(-1200), 'Hard landing');
});

test('Job, SimBrief and Cabin tabs: rows with real values, a note when the bridge sent nothing', () => {
  const rich = scenario('efb-finished', EN);
  const job = rich.pages.job.sections;
  assert.deepEqual(job[0].rows.map((r) => [r.label, r.value]), [
    ['Departure', 'Nice (LFMN)'], ['Arrival', 'Paris-CDG (LFPG)'], ['Aircraft', 'ATR 72-600 (AT76)'],
    ['Registration', 'F-HAZR'], ['Callsign', 'AZR 4127'], ['Flight number', '4127'],
  ]);
  assert.equal(job[2].rows[1].value, 'https://careers.example.org/#flight/4127');
  const plan = rich.pages.simbrief.sections[0];
  assert.deepEqual(plan.rows.map((r) => r.value), [`2,150${NBSP}kg`, `1,640${NBSP}kg`, `420${NBSP}kg`, 'FL240']);
  assert.equal(plan.note, null);
  assert.deepEqual(rich.pages.cabin.sections[0].rows.map((r) => r.value), ['68', `410${NBSP}kg`, DASH]);

  const poor = VM.fromStatus(bare(), EN).pages;
  assert.deepEqual(poor.simbrief.sections[0].rows.map((r) => r.value), [DASH, DASH, DASH, DASH]);
  assert.equal(poor.simbrief.sections[0].note, 'The bridge sent no SimBrief plan.');
  assert.equal(poor.cabin.sections[0].note, 'The bridge sent no cabin data.');
  assert.deepEqual(poor.job.sections[0].rows.map((r) => r.value).slice(0, 3), ['LFMN', 'LFPG', 'AT76']);
  const flagged = VM.fromStatus(bare({ flags: ['slew_detected'] }), EN).pages.job.sections[1];
  assert.deepEqual(flagged.list, ['Slew mode used']);
});

test('the report link points at the career server flight page, and only for http(s) servers', () => {
  assert.equal(VM.fromStatus(bare({ serverUrl: 'https://a.example/' }), EN).reportUrl, 'https://a.example/#flight/7');
  assert.equal(VM.fromStatus(bare({ serverUrl: 'http://127.0.0.1:3000' }), EN).reportUrl, 'http://127.0.0.1:3000/#flight/7');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', 'not a url', '']) {
    assert.equal(VM.fromStatus(bare({ serverUrl: bad }), EN).reportUrl, null, bad);
  }
  assert.equal(VM.fromStatus(bare({ flight: null, verification: null }), EN).reportUrl, null);
});

test('every English string has a French twin and the other way round', () => {
  const en = Object.keys(VM.strings.en).sort();
  const fr = Object.keys(VM.strings.fr).sort();
  assert.deepEqual(fr, en);
  for (const k of en) {
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(vars(VM.strings.fr[k]), vars(VM.strings.en[k]), `placeholders of ${k}`);
  }
});

test('language: fr and en give different text for the same state, anything else is English', () => {
  assert.equal(scenario('efb-finished', FR).view.title, 'Vol termin\u00E9');
  assert.equal(scenario('efb-finished', EN).view.title, 'Flight finished');
  assert.equal(VM.fromStatus(SCENARIOS['efb-finished']).view.title, 'Flight finished');
  assert.equal(VM.fromStatus(SCENARIOS['efb-finished'], { lang: 'de' }).view.title, 'Flight finished');
  assert.equal(VM.pickLang('fr-FR'), 'fr');
  assert.equal(VM.pickLang('FR_ca'), 'fr');
  assert.equal(VM.pickLang('fra'), 'en');
  assert.equal(VM.pickLang(undefined), 'en');
  assert.equal(VM.offline('fr').connectionLabel, 'Pont non d\u00E9marr\u00E9');
  assert.equal(VM.fromResponse(0, '', FR).connection, 'offline');
  assert.match(VM.fromResponse(500, 'boom', FR).notice, /HTTP 500/);
  assert.match(VM.fromResponse(200, 'nope', FR).notice, /pas du JSON/);
  assert.match(VM.fromStatus({ phase: 'x' }, FR).notice, /phase/);
});

test('connection states carry no tablet content and a header that says why', () => {
  for (const [vm, tone] of [[VM.offline(), 'off'], [VM.connecting(), 'wait'], [VM.error('x'), 'bad']]) {
    assert.equal(vm.tabs, null);
    assert.equal(vm.pages, null);
    assert.equal(vm.view, null);
    assert.equal(vm.footer, null);
    assert.equal(vm.canClose, false);
    assert.equal(vm.header.bridgeTone, tone);
    assert.equal(vm.header.clock, null);
  }
});

test('hostile text from the bridge is passed through as plain text and clipped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const vm = VM.fromStatus(bare({ flight: { ...BARE_FLIGHT, fromName: evil, callsign: 'x'.repeat(500), registration: 5, aircraftName: '   ' } }), EN);
  assert.ok(vm.view.title.startsWith(evil));
  assert.ok(vm.view.meta.length < 200);
  assert.equal(vm.view.meta.includes('5'), false);
  assert.equal(vm.pages.job.sections[0].rows[3].value, DASH);
  const long = VM.fromStatus(bare({ phase: 'parked', verification: 'rejected', reason: 'r'.repeat(5000) }), EN);
  assert.ok(long.view.verdict.text.length < 600);
});

test('announcement still summarises job, phase, verification and flags for screen readers in both languages', () => {
  const fr = scenario('efb-rejected', FR).announcement;
  for (const part of ['Pont connect\u00E9', 'LFMN vers LFPG', 'Parqu\u00E9 (\u00E9tape 5 sur 5)', 'V\u00E9rification Rejet\u00E9', '1 anomalie signal\u00E9e']) assert.ok(fr.includes(part), `${part} in ${fr}`);
  assert.ok(!fr.includes('..'), fr);
  const en = scenario('efb-finished', EN).announcement;
  for (const part of ['LFMN to LFPG', 'Parked (step 5 of 5)', 'Verification Verified', 'No flags raised']) assert.ok(en.includes(part), `${part} in ${en}`);
});

test('stepper carries a screen-reader word for every step and marks exactly one current step', () => {
  for (const phase of ['preflight', 'taxiOut', 'airborne']) {
    const steps = VM.fromStatus(bare({ phase }), EN).view.steps;
    assert.equal(steps.filter((s) => s.state === 'current').length, 1);
    assert.ok(steps.every((s) => ['completed', 'current', 'not reached'].includes(s.srText)));
  }
});
