'use strict';
/* The bridge's /status gained `sim` and `version` for the web app (v2 contract, lot LIVE). The in-sim panel does not show
 * them: it must accept the richer body and map it exactly as it mapped the old one. */
const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('../openpilotcareer-panel/html_ui/InGamePanels/OpenPilotCareer/view-model.js');

const OLD = { phase: 'airborne', flight: { id: '42', from: 'LFPG', to: 'LFMN', aircraftIcao: 'A20N' }, verification: 'pending', flags: ['slew_detected'], serverUrl: 'https://x.example' };

test('extra bridge fields (sim, version, anything new) are ignored: same display state as without them', () => {
  const base = VM.fromStatus(OLD);
  assert.equal(base.connection, 'online');
  for (const extra of [{ sim: 'connected', version: '0.1.0' }, { sim: 'waiting', version: '0.2.0' }, { sim: 'unavailable', version: '1.0.0' }, { sim: 42, version: null }, { sim: 'connected', version: '0.1.0', somethingNew: { a: 1 } }]) {
    assert.deepEqual(VM.fromStatus({ ...OLD, ...extra }), base, JSON.stringify(extra));
    assert.deepEqual(VM.fromResponse(200, JSON.stringify({ ...OLD, ...extra })), base);
  }
});

test('the new fields never make an otherwise invalid status valid', () => {
  assert.equal(VM.fromStatus({ sim: 'connected', version: '0.1.0' }).connection, 'error');
});
