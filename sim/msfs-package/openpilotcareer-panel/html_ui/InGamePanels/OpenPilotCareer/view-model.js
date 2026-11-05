/* Pure mapping: bridge /status response -> display state. No DOM, no network.
 * Loaded as a classic script in the sim (window.OPCViewModel) and via require() in node:test.
 * ES5 on purpose: the sim's UI engine version is not documented. */
(function (root) {
  'use strict';

  var PHASES = [
    { key: 'preflight', label: 'Preflight' },
    { key: 'taxiOut', label: 'Taxi out' },
    { key: 'airborne', label: 'Airborne' },
    { key: 'landed', label: 'Landed' },
    { key: 'parked', label: 'Parked' }
  ];
  var MAX_BODY_CHARS = 65536;
  var MAX_FLAGS_SHOWN = 20;
  var VERIFICATION_LABELS = { pending: 'Pending', verified: 'Verified', rejected: 'Rejected' };

  function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }
  function isString(v) {
    return typeof v === 'string';
  }
  function phaseIndex(key) {
    for (var i = 0; i < PHASES.length; i++) if (PHASES[i].key === key) return i;
    return -1;
  }

  function disconnected(connection, label, notice) {
    return {
      connection: connection,
      connectionLabel: label,
      notice: notice,
      announcement: label + '. ' + notice,
      job: null,
      phase: null,
      verification: null,
      flags: null,
      serverUrl: null
    };
  }

  function offline() {
    return disconnected('offline', 'Bridge not running', 'Start the OpenPilotCareer bridge on this PC. This panel retries every 2 seconds.');
  }

  function connecting() {
    return disconnected('connecting', 'Connecting to bridge', 'Waiting for the first status update.');
  }

  function error(detail) {
    return disconnected('error', 'Bridge status unreadable', detail);
  }

  /* Returns a description of the first contract violation, or null. Never echoes received values. */
  function contractProblem(s) {
    if (!isObject(s)) return 'The status is not a JSON object.';
    if (phaseIndex(s.phase) < 0) return 'Field "phase" is missing or unknown.';
    var f = s.flight;
    if (f !== null) {
      if (!isObject(f) || !isString(f.id) || !isString(f.from) || !isString(f.to) || !isString(f.aircraftIcao)) {
        return 'Field "flight" is invalid.';
      }
    }
    if (s.verification !== null && !Object.prototype.hasOwnProperty.call(VERIFICATION_LABELS, s.verification)) {
      return 'Field "verification" is missing or unknown.';
    }
    if (s.reason !== undefined && s.reason !== null && !isString(s.reason)) return 'Field "reason" is invalid.';
    if (!Array.isArray(s.flags)) return 'Field "flags" is missing or not a list.';
    for (var i = 0; i < s.flags.length; i++) if (!isString(s.flags[i])) return 'Field "flags" has a non-text entry.';
    if (!isString(s.serverUrl)) return 'Field "serverUrl" is missing or not text.';
    return null;
  }

  function jobOf(flight) {
    if (!flight) return { active: false, route: 'No active job', from: null, to: null, aircraft: null, id: null };
    return { active: true, route: flight.from + ' \u2192 ' + flight.to, from: flight.from, to: flight.to, aircraft: flight.aircraftIcao, id: flight.id };
  }

  function phaseOf(key) {
    var at = phaseIndex(key);
    var steps = PHASES.map(function (p, i) {
      return { key: p.key, label: p.label, state: i < at ? 'done' : i === at ? 'current' : 'todo' };
    });
    return {
      key: key,
      label: PHASES[at].label,
      position: at + 1,
      total: PHASES.length,
      summary: PHASES[at].label + ' (step ' + (at + 1) + ' of ' + PHASES.length + ')',
      steps: steps
    };
  }

  function verificationOf(s) {
    var reason = s.reason ? s.reason : null;
    if (s.verification === null) {
      return { key: 'none', label: s.flight ? 'Not started' : 'Nothing to verify', reason: reason };
    }
    if (s.verification === 'rejected' && !reason) reason = 'No reason given.';
    return { key: s.verification, label: VERIFICATION_LABELS[s.verification], reason: reason };
  }

  function flagsOf(list) {
    var n = list.length;
    return {
      count: n,
      summary: n === 0 ? 'No flags raised' : n + (n === 1 ? ' flag raised' : ' flags raised'),
      items: list.slice(0, MAX_FLAGS_SHOWN),
      hiddenCount: Math.max(0, n - MAX_FLAGS_SHOWN)
    };
  }

  function announce(vm) {
    var v = vm.verification;
    var parts = [
      vm.connectionLabel,
      vm.job.active ? 'Job ' + vm.job.from + ' to ' + vm.job.to + ', aircraft ' + vm.job.aircraft : vm.job.route,
      'Phase ' + vm.phase.summary,
      'Verification ' + v.label + (v.reason ? ': ' + v.reason : ''),
      vm.flags.summary
    ];
    return parts.join('. ') + '.';
  }

  function fromStatus(s) {
    var problem = contractProblem(s);
    if (problem) return error(problem);
    var vm = {
      connection: 'online',
      connectionLabel: 'Bridge connected',
      notice: null,
      announcement: null,
      job: jobOf(s.flight),
      phase: phaseOf(s.phase),
      verification: verificationOf(s),
      flags: flagsOf(s.flags),
      serverUrl: s.serverUrl
    };
    vm.announcement = announce(vm);
    return vm;
  }

  /* httpStatus/text come straight from the transport; any shape of them is tolerated.
   Status 0 is what XMLHttpRequest reports when nothing answered. */
  function fromResponse(httpStatus, text) {
    if (httpStatus === 0) return offline();
    if (httpStatus !== 200) return error('The bridge answered with HTTP ' + (typeof httpStatus === 'number' ? httpStatus : '?') + '.');
    if (!isString(text) || text.length > MAX_BODY_CHARS) return error('The bridge sent an empty or oversized answer.');
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return error('The bridge sent text that is not valid JSON.');
    }
    return fromStatus(parsed);
  }

  var api = { offline: offline, connecting: connecting, error: error, fromStatus: fromStatus, fromResponse: fromResponse, PHASES: PHASES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OPCViewModel = api;
})(this);
