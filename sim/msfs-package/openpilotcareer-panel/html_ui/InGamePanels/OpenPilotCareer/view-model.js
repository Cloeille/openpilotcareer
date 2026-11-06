/* Pure mapping: bridge /status response -> display state of the EFB tablet. No DOM, no network.
 * Loaded as a classic script in the sim (window.OPCViewModel) and via require() in node:test.
 * ES5 on purpose: the sim's UI engine version is not documented.
 *
 * Bridge contract (GET http://127.0.0.1:7878/status), REQUIRED part: phase, flight|null, verification|null, reason?,
 * flags[], serverUrl. The EFB shows more than the bridge sends today, so these fields are OPTIONAL and read leniently:
 * a missing or wrongly typed one is shown as a dash, never guessed and never an error.
 *   flight.fromName, flight.toName, flight.callsign, flight.registration, flight.aircraftName, flight.payloadKg
 *   live      { altFt, progress (0..1), etaAt (epoch ms), fuelArrivalKg }       estimatedPay (EUR)
 *   result    { landingFpm, gForce, fuelRemainingKg, fuelVsSimbriefKg, netPay (EUR), blockMinutes, stand, parkedAt (epoch ms) }
 *   plan      { blockFuelKg, tripFuelKg, reserveFuelKg, cruiseAltFt }           cabin { passengers, cargoKg }
 *   simTime (epoch ms, sim UTC)    sim ('connected' | 'waiting' | 'unavailable')
 * flight.id is a number from the real bridge; a string is accepted too. */
(function (root) {
  'use strict';

  /* Keep equal to PRODUCT_NAME in packages/web/src/brand.ts (test/brand.test.js checks it). */
  var BRAND = 'OpenPilotCareer';

  var DASH = '\u2014';
  var NBSP = '\u00A0';
  var MINUS = '\u2212';
  var ARROW = '\u2192';
  var DOT = ' \u00B7 ';
  /* Same threshold as HARD_LANDING_FPM in packages/shared (the server's hard-landing penalty). */
  var HARD_LANDING_FPM = 600;
  var FIRM_LANDING_FPM = 250;

  var PHASES = [
    { key: 'preflight', label: 'Preflight' },
    { key: 'taxiOut', label: 'Taxi out' },
    { key: 'airborne', label: 'Airborne' },
    { key: 'landed', label: 'Landed' },
    { key: 'parked', label: 'Parked' }
  ];
  var VERIFICATIONS = { pending: 1, verified: 1, rejected: 1 };
  var MAX_BODY_CHARS = 65536;
  var MAX_FLAGS_SHOWN = 20;
  var MAX_NAME_CHARS = 60;
  var MAX_REASON_CHARS = 400;
  var MAX_URL_CHARS = 200;
  var LANGS = ['en', 'fr'];
  var TAB_KEYS = ['flight', 'job', 'simbrief', 'cabin'];

  var STR = {
    en: {
      'conn.online': 'Bridge connected',
      'conn.offline': 'Bridge not running',
      'conn.offline.notice': 'Start the ' + BRAND + ' bridge on this PC. This panel retries every 2 seconds.',
      'conn.connecting': 'Connecting to bridge',
      'conn.connecting.notice': 'Waiting for the first status update.',
      'conn.error': 'Bridge status unreadable',
      'problem.object': 'The status is not a JSON object.',
      'problem.phase': 'Field "phase" is missing or unknown.',
      'problem.flight': 'Field "flight" is invalid.',
      'problem.verification': 'Field "verification" is missing or unknown.',
      'problem.reason': 'Field "reason" is invalid.',
      'problem.flags': 'Field "flags" is missing or not a list.',
      'problem.flagsEntry': 'Field "flags" has a non-text entry.',
      'problem.serverUrl': 'Field "serverUrl" is missing or not text.',
      'problem.http': 'The bridge answered with HTTP {code}.',
      'problem.body': 'The bridge sent an empty or oversized answer.',
      'problem.json': 'The bridge sent text that is not valid JSON.',
      'problem.read': 'The panel could not read the answer.',
      'problem.send': 'The panel could not send the request.',
      'phase.preflight': 'Preflight',
      'phase.taxiOut': 'Taxi out',
      'phase.airborne': 'Airborne',
      'phase.landed': 'Landed',
      'phase.parked': 'Parked',
      'phase.summary': '{label} (step {n} of {total})',
      'verif.pending': 'Pending',
      'verif.verified': 'Verified',
      'verif.rejected': 'Rejected',
      'verif.notStarted': 'Not started',
      'verif.nothing': 'Nothing to verify',
      'verif.noReason': 'No reason given.',
      'flags.none': 'No flags raised',
      'flags.one': '1 flag raised',
      'flags.many': '{n} flags raised',
      'flag.slew_detected': 'Slew mode used',
      'flag.time_acceleration_above_1x': 'Time acceleration above 1\u00D7',
      'flag.teleport_jump_over_50nm': 'Position jump over 50 NM',
      'flag.long_pause': 'Long pause',
      'job.none': 'No active job',
      'ann.job': 'Job {from} to {to}, aircraft {aircraft}',
      'ann.phase': 'Phase {summary}',
      'ann.verification': 'Verification {label}',
      'sim.connected': 'MSFS connected',
      'sim.waiting': 'Waiting for MSFS',
      'sim.unavailable': 'MSFS unavailable',
      'tab.flight': 'Flight',
      'tab.job': 'Job',
      'tab.simbrief': 'SimBrief',
      'tab.cabin': 'Cabin',
      'tabs.label': 'EFB sections',
      'status.preflight': 'Preflight',
      'status.taxiOut': 'Taxi out',
      'status.airborne': 'Airborne',
      'status.landed': 'Landed',
      'status.parked': 'Parked',
      'status.stand': 'stand {stand}',
      'status.cruise': 'Cruise {level}',
      'fact.eta': 'Estimated arrival',
      'fact.fuelArrival': 'Fuel on arrival',
      'fact.pay': 'Estimated pay',
      'result.landing': 'Landing rate',
      'result.gForce': 'Load factor',
      'result.fuel': 'Fuel remaining',
      'landing.smooth': 'Smooth landing',
      'landing.firm': 'Firm landing',
      'landing.hard': 'Hard landing',
      'fuel.vsSimbrief': '{delta} vs SimBrief',
      'verdict.ok.title': 'Flight verified by the SimConnect bridge',
      'verdict.ok.clean': 'No anomaly: no slew, no time acceleration, no pause, no position jump.',
      'verdict.ok.flags': 'Accepted with {summary}: {list}.',
      'verdict.bad.title': 'Flight rejected by the verification',
      'verdict.bad.flags': 'Flags: {list}.',
      'verdict.bad.unpaid': 'The flight is not paid and does not count for the season.',
      'verdict.gain': 'Net pay',
      'title.finished': 'Flight finished',
      'title.rejected': 'Flight rejected',
      'title.idle': 'No active flight',
      'title.closed': 'Flight closed',
      'idle.text': 'Accept a job in the web app, then start the bridge with "fly" and the flight number.',
      'closed.text': 'Closed in this panel only. The bridge keeps running and reports to the server by itself.',
      'footer.pending': 'Verification in progress',
      'footer.notStarted': 'Verification not started',
      'footer.nothing': 'Nothing to verify',
      'footer.noAnomaly': 'no anomaly',
      'footer.availableParked': 'Available once parked',
      'footer.noFlight': 'No active flight',
      'footer.close': 'Close flight',
      'footer.closeKey': 'Enter',
      'footer.report': 'View the full report',
      'footer.reportRejected': 'View flight details',
      'row.from': 'Departure',
      'row.to': 'Arrival',
      'row.aircraft': 'Aircraft',
      'row.registration': 'Registration',
      'row.callsign': 'Callsign',
      'row.flightId': 'Flight number',
      'row.payload': 'Payload',
      'row.server': 'Career server',
      'row.page': 'Flight page',
      'row.verification': 'Verification',
      'row.reason': 'Reason',
      'row.flags': 'Flags',
      'row.blockFuel': 'Block fuel',
      'row.tripFuel': 'Trip fuel',
      'row.reserveFuel': 'Reserve fuel',
      'row.cruise': 'Cruise level',
      'row.passengers': 'Passengers',
      'row.cargo': 'Cargo',
      'sec.mission': 'Mission',
      'sec.verification': 'Verification',
      'sec.server': 'Server',
      'sec.plan': 'SimBrief flight plan',
      'sec.cabin': 'Cabin and load',
      'note.noPlan': 'The bridge sent no SimBrief plan.',
      'note.noCabin': 'The bridge sent no cabin data.',
      'unit.kg': 'kg',
      'unit.min': 'min',
      'a11y.progress': 'Route progress {pct} percent',
      'a11y.progressUnknown': 'Route progress unknown',
      'a11y.stepDone': 'completed',
      'a11y.stepCurrent': 'current',
      'a11y.stepTodo': 'not reached',
      'a11y.bridgeOk': 'Bridge connected',
      'a11y.bridgeWait': 'Bridge connected, waiting for the simulator'
    },
    fr: {
      'conn.online': 'Pont connect\u00E9',
      'conn.offline': 'Pont non d\u00E9marr\u00E9',
      'conn.offline.notice': 'D\u00E9marrez le pont ' + BRAND + ' sur ce PC. Ce panneau r\u00E9essaie toutes les 2 secondes.',
      'conn.connecting': 'Connexion au pont',
      'conn.connecting.notice': 'En attente de la premi\u00E8re mise \u00E0 jour.',
      'conn.error': 'Statut du pont illisible',
      'problem.object': 'Le statut n\u2019est pas un objet JSON.',
      'problem.phase': 'Le champ \u00AB phase \u00BB est absent ou inconnu.',
      'problem.flight': 'Le champ \u00AB flight \u00BB est invalide.',
      'problem.verification': 'Le champ \u00AB verification \u00BB est absent ou inconnu.',
      'problem.reason': 'Le champ \u00AB reason \u00BB est invalide.',
      'problem.flags': 'Le champ \u00AB flags \u00BB est absent ou n\u2019est pas une liste.',
      'problem.flagsEntry': 'Le champ \u00AB flags \u00BB contient une entr\u00E9e qui n\u2019est pas du texte.',
      'problem.serverUrl': 'Le champ \u00AB serverUrl \u00BB est absent ou n\u2019est pas du texte.',
      'problem.http': 'Le pont a r\u00E9pondu HTTP {code}.',
      'problem.body': 'Le pont a envoy\u00E9 une r\u00E9ponse vide ou trop volumineuse.',
      'problem.json': 'Le pont a envoy\u00E9 du texte qui n\u2019est pas du JSON valide.',
      'problem.read': 'Le panneau n\u2019a pas pu lire la r\u00E9ponse.',
      'problem.send': 'Le panneau n\u2019a pas pu envoyer la requ\u00EAte.',
      'phase.preflight': 'Pr\u00E9paration',
      'phase.taxiOut': 'Roulage',
      'phase.airborne': 'En vol',
      'phase.landed': 'Atterri',
      'phase.parked': 'Parqu\u00E9',
      'phase.summary': '{label} (\u00E9tape {n} sur {total})',
      'verif.pending': 'En cours',
      'verif.verified': 'V\u00E9rifi\u00E9',
      'verif.rejected': 'Rejet\u00E9',
      'verif.notStarted': 'Pas commenc\u00E9e',
      'verif.nothing': 'Rien \u00E0 v\u00E9rifier',
      'verif.noReason': 'Aucune raison donn\u00E9e.',
      'flags.none': 'Aucune anomalie signal\u00E9e',
      'flags.one': '1 anomalie signal\u00E9e',
      'flags.many': '{n} anomalies signal\u00E9es',
      'flag.slew_detected': 'Slew utilis\u00E9',
      'flag.time_acceleration_above_1x': 'Acc\u00E9l\u00E9ration du temps au-dessus de \u00D71',
      'flag.teleport_jump_over_50nm': 'Saut de position de plus de 50 NM',
      'flag.long_pause': 'Pause prolong\u00E9e',
      'job.none': 'Aucun job actif',
      'ann.job': 'Job {from} vers {to}, avion {aircraft}',
      'ann.phase': 'Phase {summary}',
      'ann.verification': 'V\u00E9rification {label}',
      'sim.connected': 'MSFS connect\u00E9',
      'sim.waiting': 'En attente de MSFS',
      'sim.unavailable': 'MSFS indisponible',
      'tab.flight': 'Vol',
      'tab.job': 'Job',
      'tab.simbrief': 'SimBrief',
      'tab.cabin': 'Cabine',
      'tabs.label': 'Sections de l\u2019EFB',
      'status.preflight': 'Pr\u00E9paration',
      'status.taxiOut': 'Roulage',
      'status.airborne': 'En vol',
      'status.landed': 'Atterri',
      'status.parked': 'Parqu\u00E9',
      'status.stand': 'poste {stand}',
      'status.cruise': 'croisi\u00E8re {level}',
      'fact.eta': 'Arriv\u00E9e pr\u00E9vue',
      'fact.fuelArrival': 'Carburant \u00E0 l\u2019arriv\u00E9e',
      'fact.pay': 'Gain estim\u00E9',
      'result.landing': 'Taux d\u2019atterrissage',
      'result.gForce': 'Facteur de charge',
      'result.fuel': 'Carburant restant',
      'landing.smooth': 'Atterrissage en douceur',
      'landing.firm': 'Atterrissage ferme',
      'landing.hard': 'Atterrissage dur',
      'fuel.vsSimbrief': '{delta} vs SimBrief',
      'verdict.ok.title': 'Vol v\u00E9rifi\u00E9 par le pont SimConnect',
      'verdict.ok.clean': 'Aucune anomalie : ni slew, ni acc\u00E9l\u00E9ration du temps, ni pause, ni saut de position.',
      'verdict.ok.flags': 'Accept\u00E9 avec {summary} : {list}.',
      'verdict.bad.title': 'Vol rejet\u00E9 par la v\u00E9rification',
      'verdict.bad.flags': 'Anomalies : {list}.',
      'verdict.bad.unpaid': 'Le vol n\u2019est pas pay\u00E9 et ne compte pas pour la saison.',
      'verdict.gain': 'Gain net',
      'title.finished': 'Vol termin\u00E9',
      'title.rejected': 'Vol rejet\u00E9',
      'title.idle': 'Aucun vol actif',
      'title.closed': 'Vol cl\u00F4tur\u00E9',
      'idle.text': 'Acceptez un job dans l\u2019application web, puis lancez le pont avec \u00AB fly \u00BB et le num\u00E9ro du vol.',
      'closed.text': 'Cl\u00F4tur\u00E9 dans ce panneau seulement. Le pont continue de tourner et envoie le r\u00E9sultat au serveur de lui-m\u00EAme.',
      'footer.pending': 'V\u00E9rification en cours',
      'footer.notStarted': 'V\u00E9rification pas commenc\u00E9e',
      'footer.nothing': 'Rien \u00E0 v\u00E9rifier',
      'footer.noAnomaly': 'aucune anomalie',
      'footer.availableParked': 'Disponible une fois parqu\u00E9',
      'footer.noFlight': 'Aucun vol actif',
      'footer.close': 'Cl\u00F4turer le vol',
      'footer.closeKey': 'Entr\u00E9e',
      'footer.report': 'Voir le rapport complet',
      'footer.reportRejected': 'Voir le d\u00E9tail du vol',
      'row.from': 'D\u00E9part',
      'row.to': 'Arriv\u00E9e',
      'row.aircraft': 'Avion',
      'row.registration': 'Immatriculation',
      'row.callsign': 'Indicatif',
      'row.flightId': 'Num\u00E9ro du vol',
      'row.payload': 'Charge utile',
      'row.server': 'Serveur de carri\u00E8re',
      'row.page': 'Page du vol',
      'row.verification': 'V\u00E9rification',
      'row.reason': 'Raison',
      'row.flags': 'Anomalies',
      'row.blockFuel': 'Carburant bloc',
      'row.tripFuel': 'Carburant trajet',
      'row.reserveFuel': 'Carburant r\u00E9serve',
      'row.cruise': 'Niveau de croisi\u00E8re',
      'row.passengers': 'Passagers',
      'row.cargo': 'Fret',
      'sec.mission': 'Mission',
      'sec.verification': 'V\u00E9rification',
      'sec.server': 'Serveur',
      'sec.plan': 'Plan de vol SimBrief',
      'sec.cabin': 'Cabine et chargement',
      'note.noPlan': 'Le pont n\u2019a envoy\u00E9 aucun plan SimBrief.',
      'note.noCabin': 'Le pont n\u2019a envoy\u00E9 aucune donn\u00E9e de cabine.',
      'unit.kg': 'kg',
      'unit.min': 'min',
      'a11y.progress': 'Progression du trajet : {pct} pour cent',
      'a11y.progressUnknown': 'Progression du trajet inconnue',
      'a11y.stepDone': 'termin\u00E9e',
      'a11y.stepCurrent': 'en cours',
      'a11y.stepTodo': 'pas atteinte',
      'a11y.bridgeOk': 'Pont connect\u00E9',
      'a11y.bridgeWait': 'Pont connect\u00E9, en attente du simulateur'
    }
  };

  function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }
  function isString(v) {
    return typeof v === 'string';
  }
  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function phaseIndex(key) {
    for (var i = 0; i < PHASES.length; i++) if (PHASES[i].key === key) return i;
    return -1;
  }

  /* Callers pass the language as { lang: 'fr' } (or a bare 'fr'); anything else is English. */
  function langOf(x) {
    var l = isObject(x) ? x.lang : x;
    return l === 'fr' ? 'fr' : 'en';
  }
  function tr(lang, key, vars) {
    var s = STR[lang][key];
    if (s === undefined) s = STR.en[key];
    if (s === undefined) return key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return has(vars, name) ? String(vars[name]) : m;
      });
    }
    return s;
  }
  /* 'fr', 'fr-FR', 'FR_ca' -> 'fr'; anything else -> 'en'. */
  function pickLang(tag) {
    return isString(tag) && /^fr([-_]|$)/i.test(tag) ? 'fr' : 'en';
  }

  /* ---- formatting. Hand-rolled (no Intl): the sim's JS engine is undocumented. ---- */
  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }
  function group(n, lang) {
    var s = String(Math.abs(Math.round(n)));
    var sep = lang === 'fr' ? NBSP : ',';
    var out = '';
    while (s.length > 3) {
      out = sep + s.slice(-3) + out;
      s = s.slice(0, -3);
    }
    return s + out;
  }
  function fmtKg(v, lang) {
    return isNum(v) ? (v < 0 ? MINUS : '') + group(v, lang) + NBSP + tr(lang, 'unit.kg') : DASH;
  }
  /* opts.sign: show "+" on positive values. opts.approx: prefix with an approximately-equal sign. */
  function fmtMoney(v, lang, opts) {
    if (!isNum(v)) return DASH;
    var rounded = Math.round(v);
    var sign = rounded < 0 ? MINUS : opts && opts.sign && rounded > 0 ? '+' : '';
    var body = lang === 'fr' ? group(rounded, lang) + NBSP + '\u20AC' : '\u20AC' + group(rounded, lang);
    return (opts && opts.approx ? '\u2248' + NBSP : '') + sign + body;
  }
  function fmtTimeZ(ms) {
    if (!isNum(ms) || ms <= 0) return DASH;
    var d = new Date(ms);
    if (isNaN(d.getTime())) return DASH;
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + 'Z';
  }
  function fmtFpm(v, lang) {
    if (!isNum(v)) return DASH;
    return (v < 0 ? MINUS : '') + group(v, lang) + NBSP + 'ft/min';
  }
  function fmtG(v, lang) {
    if (!isNum(v)) return DASH;
    var s = v.toFixed(2);
    return (lang === 'fr' ? s.replace('.', ',') : s) + NBSP + 'g';
  }
  function fmtDuration(min, lang) {
    if (!isNum(min) || min < 0) return null;
    var m = Math.round(min);
    var h = Math.floor(m / 60);
    return h > 0 ? h + ' h ' + pad2(m % 60) : m + ' ' + tr(lang, 'unit.min');
  }
  /* Altitude as a flight level from 18 000 ft up, plain feet below. */
  function fmtLevel(altFt) {
    if (!isNum(altFt) || altFt <= 0) return null;
    if (altFt < 18000) return group(altFt, 'fr') + NBSP + 'ft';
    var fl = String(Math.round(altFt / 100));
    while (fl.length < 3) fl = '0' + fl;
    return 'FL' + fl;
  }
  function fmtCount(v, lang) {
    return isNum(v) ? group(v, lang) : DASH;
  }
  function clip(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
  }
  /* Optional text from the bridge: a non-blank string, clipped, or null. */
  function optText(v, max) {
    return isString(v) && v.replace(/\s+/g, '') !== '' ? clip(v, max || MAX_NAME_CHARS) : null;
  }
  function optNum(v) {
    return isNum(v) ? v : null;
  }
  function orDash(v) {
    return v === null || v === undefined ? DASH : v;
  }

  /* ---- connection states (no tablet content, just the status bar and a notice) ---- */
  function disconnected(connection, lang, label, notice) {
    return {
      connection: connection,
      connectionLabel: label,
      notice: notice,
      announcement: label + '. ' + notice,
      lang: lang,
      mode: connection,
      brand: BRAND,
      header: { brand: BRAND, bridgeLabel: label, bridgeSr: label, bridgeTone: connection === 'connecting' ? 'wait' : connection === 'offline' ? 'off' : 'bad', clock: null },
      job: null,
      phase: null,
      verification: null,
      flags: null,
      serverUrl: null,
      view: null,
      footer: null,
      tabs: null,
      pages: null,
      canClose: false,
      closeKey: null
    };
  }

  function offline(lang) {
    var l = langOf(lang);
    return disconnected('offline', l, tr(l, 'conn.offline'), tr(l, 'conn.offline.notice'));
  }

  function connecting(lang) {
    var l = langOf(lang);
    return disconnected('connecting', l, tr(l, 'conn.connecting'), tr(l, 'conn.connecting.notice'));
  }

  function error(detail, lang) {
    var l = langOf(lang);
    return disconnected('error', l, tr(l, 'conn.error'), detail);
  }

  /* Localised text of one of the panel's own failure messages ('read', 'send'); panel.js uses it. */
  function problem(key, lang) {
    return tr(langOf(lang), 'problem.' + key);
  }

  /* Returns the key of the first contract violation (see the problem.* strings), or null. Never echoes received values. */
  function contractProblem(s) {
    if (!isObject(s)) return 'object';
    if (phaseIndex(s.phase) < 0) return 'phase';
    var f = s.flight;
    if (f !== null) {
      if (!isObject(f)) return 'flight';
      var idOk = isString(f.id) || (isNum(f.id) && Math.floor(f.id) === f.id);
      if (!idOk || !isString(f.from) || !isString(f.to) || !isString(f.aircraftIcao)) return 'flight';
    }
    if (s.verification !== null && !(isString(s.verification) && has(VERIFICATIONS, s.verification))) return 'verification';
    if (s.reason !== undefined && s.reason !== null && !isString(s.reason)) return 'reason';
    if (!Array.isArray(s.flags)) return 'flags';
    for (var i = 0; i < s.flags.length; i++) if (!isString(s.flags[i])) return 'flagsEntry';
    if (!isString(s.serverUrl)) return 'serverUrl';
    return null;
  }

  /* ---- online state, piece by piece ---- */
  function jobOf(flight, lang) {
    if (!flight) return { active: false, route: tr(lang, 'job.none'), from: null, to: null, aircraft: null, id: null };
    return { active: true, route: flight.from + ' ' + ARROW + ' ' + flight.to, from: flight.from, to: flight.to, aircraft: flight.aircraftIcao, id: flight.id };
  }

  function phaseOf(key, lang) {
    var at = phaseIndex(key);
    var steps = PHASES.map(function (p, i) {
      return { key: p.key, label: tr(lang, 'phase.' + p.key), state: i < at ? 'done' : i === at ? 'current' : 'todo' };
    });
    var label = tr(lang, 'phase.' + key);
    return {
      key: key,
      label: label,
      position: at + 1,
      total: PHASES.length,
      summary: tr(lang, 'phase.summary', { label: label, n: at + 1, total: PHASES.length }),
      steps: steps
    };
  }

  function verificationOf(s, lang) {
    var reason = s.reason ? s.reason : null;
    if (s.verification === null) {
      return { key: 'none', label: tr(lang, s.flight ? 'verif.notStarted' : 'verif.nothing'), reason: reason };
    }
    if (s.verification === 'rejected' && !reason) reason = tr(lang, 'verif.noReason');
    return { key: s.verification, label: tr(lang, 'verif.' + s.verification), reason: reason };
  }

  function flagsOf(list, lang) {
    var n = list.length;
    var items = list.slice(0, MAX_FLAGS_SHOWN);
    return {
      count: n,
      summary: n === 0 ? tr(lang, 'flags.none') : n === 1 ? tr(lang, 'flags.one') : tr(lang, 'flags.many', { n: n }),
      items: items,
      labels: items.map(function (f) {
        return has(STR.en, 'flag.' + f) ? tr(lang, 'flag.' + f) : f;
      }),
      hiddenCount: Math.max(0, n - MAX_FLAGS_SHOWN)
    };
  }

  function announce(vm, lang) {
    var v = vm.verification;
    var parts = [
      vm.connectionLabel,
      vm.job.active ? tr(lang, 'ann.job', { from: vm.job.from, to: vm.job.to, aircraft: vm.job.aircraft }) : vm.job.route,
      tr(lang, 'ann.phase', { summary: vm.phase.summary }),
      tr(lang, 'ann.verification', { label: v.label }) + (v.reason ? ': ' + v.reason : ''),
      vm.flags.summary
    ];
    return parts.map(function (t) { return t.replace(/[.\s]+$/, ''); }).join('. ') + '.';
  }

  function landingCategory(fpm) {
    var a = Math.abs(fpm);
    return a >= HARD_LANDING_FPM ? 'hard' : a > FIRM_LANDING_FPM ? 'firm' : 'smooth';
  }

  /* Position along the route, 0..1, or null when the bridge does not say and the phase does not imply it. */
  function progressOf(phaseKey, live) {
    if (isNum(live.progress)) return Math.max(0, Math.min(1, live.progress));
    if (phaseKey === 'preflight' || phaseKey === 'taxiOut') return 0;
    if (phaseKey === 'landed' || phaseKey === 'parked') return 1;
    return null;
  }

  /* Link to the flight's page on the career server. Only http(s) bridge URLs become a link. */
  function reportUrlOf(s) {
    if (!s.flight || !/^https?:\/\/[^\s]+$/i.test(s.serverUrl)) return null;
    return clip(s.serverUrl.replace(/\/+$/, ''), MAX_URL_CHARS) + '/#flight/' + encodeURIComponent(String(s.flight.id));
  }

  function statusLineOf(s, lang, ext) {
    var result = ext.result;
    var live = ext.live;
    var plan = ext.plan;
    var key = s.phase;
    var text = tr(lang, 'status.' + key);
    if (key === 'airborne' && live.altFt !== null) {
      var level = fmtLevel(live.altFt);
      /* "cruise" only when the plan's cruise level is known and the aircraft is within 1 000 ft of it */
      var cruising = plan.cruiseAltFt !== null && Math.abs(live.altFt - plan.cruiseAltFt) <= 1000;
      if (level) text += DOT + (cruising ? tr(lang, 'status.cruise', { level: level }) : level);
    }
    if (key === 'parked') {
      if (result.stand) text += DOT + tr(lang, 'status.stand', { stand: result.stand });
      var at = fmtTimeZ(result.parkedAt);
      if (at !== DASH) text += DOT + at;
    }
    return { text: text, icon: key === 'parked' ? 'parking' : 'dot', tone: key === 'preflight' || key === 'parked' ? 'muted' : 'live' };
  }

  function joinParts(parts) {
    var kept = parts.filter(function (p) { return p; });
    return kept.length ? kept.join(DOT) : DASH;
  }

  function footerOf(s, lang, mode, flags, canClose) {
    var f = {
      verifIcon: 'scan-line', verifText: '', verifTone: 'muted', hint: null, link: null,
      closeLabel: tr(lang, 'footer.close'), closeKey: tr(lang, 'footer.closeKey'), canClose: canClose
    };
    if (mode === 'finished' || mode === 'rejected') {
      f.link = { label: tr(lang, mode === 'finished' ? 'footer.report' : 'footer.reportRejected'), tab: 'job' };
    } else if (s.verification === 'pending') {
      f.verifText = tr(lang, 'footer.pending') + DOT + (flags.count === 0 ? tr(lang, 'footer.noAnomaly') : flags.summary);
      if (flags.count > 0) {
        f.verifIcon = 'triangle-alert';
        f.verifTone = 'warn';
      }
    } else if (s.flight && mode !== 'closed') {
      f.verifText = tr(lang, 'footer.notStarted');
    } else {
      f.verifText = tr(lang, 'footer.nothing');
    }
    if (!canClose) f.hint = tr(lang, s.flight && mode !== 'closed' ? 'footer.availableParked' : 'footer.noFlight');
    return f;
  }

  function row(label, value, mono) {
    return { label: label, value: value, mono: !!mono };
  }
  /* "Nice (LFMN)" when the bridge sends the name, plain "LFMN" when it does not. */
  function placeOf(name, code) {
    var n = optText(name);
    return n ? n + ' (' + code + ')' : code;
  }

  function pagesOf(s, lang, vm, reportUrl, ext) {
    var f = s.flight;
    var mission = [
      row(tr(lang, 'row.from'), f ? placeOf(f.fromName, f.from) : DASH),
      row(tr(lang, 'row.to'), f ? placeOf(f.toName, f.to) : DASH),
      row(tr(lang, 'row.aircraft'), f ? placeOf(f.aircraftName, f.aircraftIcao) : DASH),
      row(tr(lang, 'row.registration'), f ? orDash(optText(f.registration)) : DASH, true),
      row(tr(lang, 'row.callsign'), f ? orDash(optText(f.callsign)) : DASH, true),
      row(tr(lang, 'row.flightId'), f ? String(f.id) : DASH, true)
    ];
    var verification = [row(tr(lang, 'row.verification'), vm.verification.label)];
    if (vm.verification.reason) verification.push(row(tr(lang, 'row.reason'), clip(vm.verification.reason, MAX_REASON_CHARS)));
    var server = [row(tr(lang, 'row.server'), clip(s.serverUrl, MAX_URL_CHARS) || DASH, true), row(tr(lang, 'row.page'), orDash(reportUrl), true)];
    return {
      job: {
        sections: [
          { title: tr(lang, 'sec.mission'), rows: mission, note: null, list: null },
          { title: tr(lang, 'sec.verification'), rows: verification, note: null, list: vm.flags.count ? vm.flags.labels : null },
          { title: tr(lang, 'sec.server'), rows: server, note: null, list: null }
        ]
      },
      simbrief: {
        sections: [{
          title: tr(lang, 'sec.plan'),
          rows: [
            row(tr(lang, 'row.blockFuel'), fmtKg(ext.plan.blockFuelKg, lang)),
            row(tr(lang, 'row.tripFuel'), fmtKg(ext.plan.tripFuelKg, lang)),
            row(tr(lang, 'row.reserveFuel'), fmtKg(ext.plan.reserveFuelKg, lang)),
            row(tr(lang, 'row.cruise'), orDash(fmtLevel(ext.plan.cruiseAltFt)))
          ],
          note: ext.plan.present ? null : tr(lang, 'note.noPlan'),
          list: null
        }]
      },
      cabin: {
        sections: [{
          title: tr(lang, 'sec.cabin'),
          rows: [
            row(tr(lang, 'row.passengers'), fmtCount(ext.cabin.passengers, lang)),
            row(tr(lang, 'row.cargo'), fmtKg(ext.cabin.cargoKg, lang)),
            row(tr(lang, 'row.payload'), fmtKg(f ? optNum(f.payloadKg) : null, lang))
          ],
          note: ext.cabin.present ? null : tr(lang, 'note.noCabin'),
          list: null
        }]
      }
    };
  }

  /* Optional blocks, read leniently: a wrong type becomes null (shown as a dash); a missing block is fine. */
  function extOf(s) {
    var live = isObject(s.live) ? s.live : {};
    var result = isObject(s.result) ? s.result : {};
    var plan = isObject(s.plan) ? s.plan : {};
    var cabin = isObject(s.cabin) ? s.cabin : {};
    return {
      live: { altFt: optNum(live.altFt), progress: optNum(live.progress), etaAt: optNum(live.etaAt), fuelArrivalKg: optNum(live.fuelArrivalKg) },
      result: {
        landingFpm: optNum(result.landingFpm), gForce: optNum(result.gForce), fuelRemainingKg: optNum(result.fuelRemainingKg),
        fuelVsSimbriefKg: optNum(result.fuelVsSimbriefKg), netPay: optNum(result.netPay), blockMinutes: optNum(result.blockMinutes),
        stand: optText(result.stand), parkedAt: optNum(result.parkedAt)
      },
      plan: {
        present: isObject(s.plan), blockFuelKg: optNum(plan.blockFuelKg), tripFuelKg: optNum(plan.tripFuelKg),
        reserveFuelKg: optNum(plan.reserveFuelKg), cruiseAltFt: optNum(plan.cruiseAltFt)
      },
      cabin: { present: isObject(s.cabin), passengers: optNum(cabin.passengers), cargoKg: optNum(cabin.cargoKg) },
      estimatedPay: optNum(s.estimatedPay),
      simTime: optNum(s.simTime),
      sim: s.sim === 'connected' || s.sim === 'waiting' || s.sim === 'unavailable' ? s.sim : null
    };
  }

  function flightTitleOf(s, lang, ext, mode) {
    var f = s.flight;
    var callsign = optText(f.callsign);
    if (mode === 'finished' || mode === 'rejected') {
      return {
        title: tr(lang, mode === 'finished' ? 'title.finished' : 'title.rejected'),
        meta: joinParts([callsign, f.from + ' ' + ARROW + ' ' + f.to, fmtDuration(ext.result.blockMinutes, lang)])
      };
    }
    return {
      title: (optText(f.fromName) || f.from) + ' ' + ARROW + ' ' + (optText(f.toName) || f.to),
      meta: joinParts([callsign, optText(f.aircraftName) || f.aircraftIcao, optText(f.registration)])
    };
  }

  /* True when the bridge's reason text already names one of the raised flags (it usually quotes the code). */
  function reasonNamesFlag(reason, list) {
    if (!reason) return false;
    for (var i = 0; i < list.length; i++) if (reason.indexOf(list[i]) !== -1) return true;
    return false;
  }

  function verdictOf(s, lang, flags, ext, mode) {
    if (mode === 'finished') {
      return {
        tone: 'ok',
        icon: 'shield-check',
        title: tr(lang, 'verdict.ok.title'),
        text: flags.count === 0
          ? tr(lang, 'verdict.ok.clean')
          : tr(lang, 'verdict.ok.flags', { summary: flags.summary.toLowerCase(), list: flags.labels.join(', ') }),
        gainLabel: tr(lang, 'verdict.gain'),
        gainValue: fmtMoney(ext.result.netPay, lang, { sign: true }),
        gainTone: ext.result.netPay === null ? 'muted' : 'ok'
      };
    }
    /* The bridge's reason is machine text when the flags caused the rejection ("... flagged this flight: time_acceleration_above_1x"):
     * say it in the pilot's language instead; the raw reason stays in the Job tab. Any other reason is shown as sent. */
    var raised = flags.count ? tr(lang, 'verdict.bad.flags', { list: flags.labels.join(', ') }) : null;
    var why = s.reason && !reasonNamesFlag(s.reason, s.flags) ? clip(s.reason, MAX_REASON_CHARS) : null;
    var lead = why ? (raised ? why + ' ' + raised : why) : raised || tr(lang, 'verif.noReason');
    return {
      tone: 'bad',
      icon: 'shield-x',
      title: tr(lang, 'verdict.bad.title'),
      text: lead + ' ' + tr(lang, 'verdict.bad.unpaid'),
      gainLabel: tr(lang, 'verdict.gain'),
      gainValue: fmtMoney(0, lang),
      gainTone: 'muted'
    };
  }

  function resultsOf(lang, ext) {
    var r = ext.result;
    var fuelSub = null;
    if (r.fuelVsSimbriefKg !== null) {
      var d = r.fuelVsSimbriefKg;
      fuelSub = tr(lang, 'fuel.vsSimbrief', { delta: (d < 0 ? MINUS : d > 0 ? '+' : '') + group(d, lang) + NBSP + tr(lang, 'unit.kg') });
    }
    return [
      { key: 'landing', label: tr(lang, 'result.landing'), value: fmtFpm(r.landingFpm, lang), sub: r.landingFpm === null ? null : tr(lang, 'landing.' + landingCategory(r.landingFpm)) },
      { key: 'gForce', label: tr(lang, 'result.gForce'), value: fmtG(r.gForce, lang), sub: null },
      { key: 'fuel', label: tr(lang, 'result.fuel'), value: fmtKg(r.fuelRemainingKg, lang), sub: fuelSub }
    ];
  }

  function factsOf(lang, ext) {
    return [
      { key: 'eta', label: tr(lang, 'fact.eta'), value: fmtTimeZ(ext.live.etaAt) },
      { key: 'fuelArrival', label: tr(lang, 'fact.fuelArrival'), value: fmtKg(ext.live.fuelArrivalKg, lang) },
      { key: 'pay', label: tr(lang, 'fact.pay'), value: ext.estimatedPay === null ? DASH : fmtMoney(ext.estimatedPay, lang, { approx: true }) }
    ];
  }

  function modeOf(s, closed) {
    if (!s.flight) return 'idle';
    if (closed) return 'closed';
    if (s.verification === 'verified') return 'finished';
    if (s.verification === 'rejected') return 'rejected';
    return 'flight';
  }

  /* opts: { lang: 'en'|'fr', closed: <closeKey the pilot dismissed> }.
   * closeKey = "<flight id>:<verification>": it changes when the verdict arrives, so a dismissed
   * pending flight shows its result again instead of staying hidden. */
  function fromStatus(s, opts) {
    var lang = langOf(opts);
    var violation = contractProblem(s);
    if (violation) return error(tr(lang, 'problem.' + violation), lang);

    var ext = extOf(s);
    var closeKey = s.flight ? String(s.flight.id) + ':' + (s.verification === null ? 'none' : s.verification) : null;
    var closed = closeKey !== null && isObject(opts) && opts.closed === closeKey && s.phase === 'parked';
    var mode = modeOf(s, closed);
    var flags = flagsOf(s.flags, lang);
    var canClose = !!s.flight && s.phase === 'parked' && mode !== 'closed';
    var reportUrl = reportUrlOf(s);
    var simWait = ext.sim === 'waiting' || ext.sim === 'unavailable';

    var vm = {
      connection: 'online',
      connectionLabel: tr(lang, 'conn.online'),
      notice: null,
      announcement: null,
      lang: lang,
      mode: mode,
      brand: BRAND,
      job: jobOf(s.flight, lang),
      phase: phaseOf(s.phase, lang),
      verification: verificationOf(s, lang),
      flags: flags,
      serverUrl: s.serverUrl,
      canClose: canClose,
      closeKey: closeKey,
      reportUrl: reportUrl,
      tabs: TAB_KEYS.map(function (k) { return { key: k, label: tr(lang, 'tab.' + k) }; }),
      tabsLabel: tr(lang, 'tabs.label'),
      header: {
        brand: BRAND,
        bridgeLabel: simWait ? tr(lang, 'sim.' + ext.sim) : tr(lang, 'conn.online'),
        bridgeSr: tr(lang, simWait ? 'a11y.bridgeWait' : 'a11y.bridgeOk'),
        bridgeTone: simWait ? 'wait' : 'ok',
        clock: fmtTimeZ(ext.simTime)
      },
      view: null,
      footer: footerOf(s, lang, mode, flags, canClose),
      pages: null
    };

    if (mode === 'idle' || mode === 'closed') {
      vm.view = {
        kind: mode,
        title: tr(lang, mode === 'idle' ? 'title.idle' : 'title.closed'),
        text: tr(lang, mode === 'idle' ? 'idle.text' : 'closed.text'),
        meta: s.flight ? joinParts([optText(s.flight.callsign), s.flight.from + ' ' + ARROW + ' ' + s.flight.to]) : null
      };
    } else {
      var view = flightTitleOf(s, lang, ext, mode);
      view.status = statusLineOf(s, lang, ext);
      if (mode === 'flight') {
        var progress = progressOf(s.phase, ext.live);
        view.kind = 'flight';
        view.route = {
          from: s.flight.from,
          to: s.flight.to,
          progress: progress,
          label: progress === null ? tr(lang, 'a11y.progressUnknown') : tr(lang, 'a11y.progress', { pct: Math.round(progress * 100) })
        };
        view.steps = vm.phase.steps.map(function (st) {
          var sr = st.state === 'done' ? 'a11y.stepDone' : st.state === 'current' ? 'a11y.stepCurrent' : 'a11y.stepTodo';
          return { key: st.key, label: st.label, state: st.state, srText: tr(lang, sr) };
        });
        view.facts = factsOf(lang, ext);
      } else {
        view.kind = 'result';
        view.results = resultsOf(lang, ext);
        view.verdict = verdictOf(s, lang, flags, ext, mode);
      }
      vm.view = view;
    }
    vm.pages = pagesOf(s, lang, vm, reportUrl, ext);
    vm.announcement = announce(vm, lang);
    return vm;
  }

  /* httpStatus/text come straight from the transport; any shape of them is tolerated.
   Status 0 is what XMLHttpRequest reports when nothing answered. */
  function fromResponse(httpStatus, text, opts) {
    var lang = langOf(opts);
    if (httpStatus === 0) return offline(lang);
    if (httpStatus !== 200) return error(tr(lang, 'problem.http', { code: typeof httpStatus === 'number' ? httpStatus : '?' }), lang);
    if (!isString(text) || text.length > MAX_BODY_CHARS) return error(tr(lang, 'problem.body'), lang);
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return error(tr(lang, 'problem.json'), lang);
    }
    return fromStatus(parsed, opts);
  }

  var api = {
    BRAND: BRAND,
    LANGS: LANGS,
    TAB_KEYS: TAB_KEYS,
    PHASES: PHASES,
    offline: offline,
    connecting: connecting,
    error: error,
    problem: problem,
    pickLang: pickLang,
    fromStatus: fromStatus,
    fromResponse: fromResponse,
    format: { kg: fmtKg, money: fmtMoney, timeZ: fmtTimeZ, fpm: fmtFpm, g: fmtG, duration: fmtDuration, level: fmtLevel },
    strings: STR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OPCViewModel = api;
})(this);
