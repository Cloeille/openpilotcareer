'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('../openpilotcareer-panel/html_ui/InGamePanels/OpenPilotCareer/view-model.js');

const FLIGHT = { id: 'fl_1', from: 'LFPG', to: 'LFMN', aircraftIcao: 'A20N' };
const status = (over = {}) => ({ phase: 'airborne', flight: FLIGHT, verification: 'pending', flags: [], serverUrl: 'https://x.example', ...over });

test('valid status maps job, phase, verification and flags', () => {
  const vm = VM.fromStatus(status());
  assert.equal(vm.connection, 'online');
  assert.deepEqual(vm.job, { active: true, route: 'LFPG \u2192 LFMN', from: 'LFPG', to: 'LFMN', aircraft: 'A20N', id: 'fl_1' });
  assert.equal(vm.phase.label, 'Airborne');
  assert.equal(vm.phase.summary, 'Airborne (step 3 of 5)');
  assert.deepEqual(vm.verification, { key: 'pending', label: 'Pending', reason: null });
  assert.equal(vm.flags.summary, 'No flags raised');
  assert.equal(vm.serverUrl, 'https://x.example');
});

test('every phase maps to a label and marks earlier steps done, later steps todo', () => {
  const labels = { preflight: 'Preflight', taxiOut: 'Taxi out', airborne: 'Airborne', landed: 'Landed', parked: 'Parked' };
  Object.keys(labels).forEach((key, at) => {
    const vm = VM.fromStatus(status({ phase: key }));
    assert.equal(vm.phase.label, labels[key]);
    assert.deepEqual(
      vm.phase.steps.map((s) => s.state),
      Object.keys(labels).map((_, i) => (i < at ? 'done' : i === at ? 'current' : 'todo')),
    );
  });
});

test('no job: flight null shows an explicit empty job and "Nothing to verify"', () => {
  const vm = VM.fromStatus(status({ flight: null, verification: null, phase: 'parked' }));
  assert.equal(vm.job.active, false);
  assert.equal(vm.job.route, 'No active job');
  assert.equal(vm.verification.key, 'none');
  assert.equal(vm.verification.label, 'Nothing to verify');
});

test('job without verification yet reads "Not started", not an error', () => {
  const vm = VM.fromStatus(status({ verification: null, phase: 'preflight' }));
  assert.equal(vm.connection, 'online');
  assert.equal(vm.verification.label, 'Not started');
});

test('verified and rejected carry labels; rejected keeps the bridge reason', () => {
  assert.equal(VM.fromStatus(status({ verification: 'verified' })).verification.label, 'Verified');
  const rejected = VM.fromStatus(status({ verification: 'rejected', reason: 'Landed at LFMD.' })).verification;
  assert.deepEqual(rejected, { key: 'rejected', label: 'Rejected', reason: 'Landed at LFMD.' });
});

test('rejected without a reason still tells the pilot something', () => {
  assert.equal(VM.fromStatus(status({ verification: 'rejected' })).verification.reason, 'No reason given.');
});

test('flags: count, singular/plural summary, cap with hidden count, copy not alias', () => {
  assert.equal(VM.fromStatus(status({ flags: ['slew'] })).flags.summary, '1 flag raised');
  const two = VM.fromStatus(status({ flags: ['a', 'b'] })).flags;
  assert.equal(two.summary, '2 flags raised');
  assert.deepEqual(two.items, ['a', 'b']);
  const many = VM.fromStatus(status({ flags: Array.from({ length: 25 }, (_, i) => `f${i}`) })).flags;
  assert.equal(many.count, 25);
  assert.equal(many.items.length, 20);
  assert.equal(many.hiddenCount, 5);
});

test('announcement summarises the whole state for screen readers', () => {
  const text = VM.fromStatus(status({ verification: 'rejected', reason: 'Too fast.', flags: ['slew'] })).announcement;
  for (const part of ['LFPG to LFMN', 'A20N', 'Airborne (step 3 of 5)', 'Rejected: Too fast', '1 flag raised']) {
    assert.ok(text.includes(part), `missing "${part}" in: ${text}`);
  }
  assert.ok(!text.includes('..'), text);
});

test('offline and connecting are distinct, labelled states with no data', () => {
  const off = VM.offline();
  assert.equal(off.connection, 'offline');
  assert.equal(off.connectionLabel, 'Bridge not running');
  assert.equal(off.job, null);
  assert.match(off.announcement, /Bridge not running/);
  assert.equal(VM.connecting().connection, 'connecting');
});

test('transport failure (status 0) is offline, never an error', () => {
  assert.equal(VM.fromResponse(0, '').connection, 'offline');
  assert.equal(VM.fromResponse(0, null).connection, 'offline');
});

test('fromResponse: 200 + valid JSON is online', () => {
  assert.equal(VM.fromResponse(200, JSON.stringify(status())).connection, 'online');
});

test('malformed answers become an error state and never throw', () => {
  const cases = [
    [200, 'not json'],
    [200, ''],
    [200, 'null'],
    [200, '[]'],
    [200, '42'],
    [200, '"phase"'],
    [200, '{}'],
    [200, undefined],
    [200, null],
    [200, { phase: 'airborne' }],
    [200, 'x'.repeat(70000)],
    [500, 'boom'],
    [404, ''],
    [undefined, '{}'],
    ['200', '{}'],
  ];
  for (const [code, body] of cases) {
    const vm = VM.fromResponse(code, body);
    assert.equal(vm.connection, 'error', `${code} ${String(body).slice(0, 20)}`);
    assert.equal(vm.job, null);
    assert.ok(vm.notice.length > 0);
  }
});

test('contract violations are each rejected', () => {
  const bad = [
    { phase: 'sideways' },
    { phase: undefined },
    { flight: 'LFPG' },
    { flight: { id: 'x', from: 'A', to: 'B' } },
    { flight: { id: 1, from: 'A', to: 'B', aircraftIcao: 'A20N' } },
    { verification: 'maybe' },
    { verification: undefined },
    { reason: 5 },
    { flags: 'none' },
    { flags: undefined },
    { flags: ['ok', 7] },
    { serverUrl: undefined },
    { serverUrl: 5 },
  ];
  for (const over of bad) {
    const vm = VM.fromStatus(status(over));
    assert.equal(vm.connection, 'error', JSON.stringify(over));
  }
  for (const nonObject of [null, undefined, 5, 'x', [], true]) assert.equal(VM.fromStatus(nonObject).connection, 'error');
});

test('error text never echoes bridge-supplied values', () => {
  const vm = VM.fromStatus(status({ phase: '<script>alert(1)</script>' }));
  assert.equal(vm.connection, 'error');
  assert.ok(!vm.notice.includes('script'));
});

test('hostile strings are passed through untouched (escaping is the renderer\u2019s job via textContent)', () => {
  const vm = VM.fromStatus(status({ flags: ['<img src=x onerror=1>'] }));
  assert.equal(vm.flags.items[0], '<img src=x onerror=1>');
});

test('prototype-key verification values are rejected', () => {
  for (const v of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
    assert.equal(VM.fromStatus(status({ verification: v })).connection, 'error', v);
  }
});
