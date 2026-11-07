'use strict';
/* Keeps the mock bridge honest: every scenario it serves must map to the state its name promises
 * when run through the same view-model the panel uses. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, SCENARIOS } = require('../mock/mock-status-server.js');
const VM = require('../openpilotcareer-panel/html_ui/InGamePanels/OpenPilotCareer/view-model.js');

const EXPECTED = {
  preflight: 'online',
  'taxi-pending': 'online',
  'airborne-pending': 'online',
  verified: 'online',
  rejected: 'online',
  'efb-flight': 'online',
  'efb-finished': 'online',
  'efb-rejected': 'online',
  'efb-sim-waiting': 'online',
  flags: 'online',
  'no-job': 'online',
  offline: 'offline',
  malformed: 'error',
  'bad-contract': 'error',
  'bad-http': 'error',
};

async function listen(t) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('the mock covers exactly the scenarios this test knows', () => {
  assert.deepEqual(Object.keys(SCENARIOS).sort(), Object.keys(EXPECTED).sort());
});

test('each mock scenario maps to the expected panel state', async (t) => {
  const base = await listen(t);
  for (const [name, expected] of Object.entries(EXPECTED)) {
    await fetch(`${base}/scenario?name=${name}`);
    let vm;
    try {
      const res = await fetch(`${base}/status`);
      vm = VM.fromResponse(res.status, await res.text());
    } catch {
      vm = VM.offline();
    }
    assert.equal(vm.connection, expected, name);
  }
});

test('the EFB scenarios land in the design frame they are named after', async (t) => {
  const base = await listen(t);
  const MODE = { 'efb-flight': 'flight', 'efb-finished': 'finished', 'efb-rejected': 'rejected', 'efb-sim-waiting': 'flight', preflight: 'flight', verified: 'finished', rejected: 'rejected', 'no-job': 'idle' };
  for (const [name, mode] of Object.entries(MODE)) {
    await fetch(`${base}/scenario?name=${name}`);
    const res = await fetch(`${base}/status`);
    const vm = VM.fromResponse(res.status, await res.text(), { lang: 'fr' });
    assert.equal(vm.mode, mode, name);
  }
});

test('fonts are served with the right type and nothing else leaks out of the fonts folder', async (t) => {
  const base = await listen(t);
  const ok = await fetch(`${base}/panel/fonts/barlow-latin-400-normal.woff2`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'font/woff2');
  assert.equal((await fetch(`${base}/panel/fonts/..%2fview-model.js`)).status, 404);
});

test('unknown scenario is refused and path traversal is not served', async (t) => {
  const base = await listen(t);
  assert.equal((await fetch(`${base}/scenario?name=__proto__`)).status, 400);
  assert.equal((await fetch(`${base}/panel/..%2f..%2fmanifest.json`)).status, 404);
});
