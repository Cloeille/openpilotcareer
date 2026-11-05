'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../build-layout.js');

function tmpPackage(files) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'opc-layout-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('filetime converts the Unix epoch and a known date', () => {
  assert.equal(L.filetimeOf(0n), 116444736000000000n);
  // 2020-01-01T00:00:00Z = 1577836800 s -> 132223104000000000 FILETIME ticks
  assert.equal(L.filetimeOf(1577836800n * 1000000000n), 132223104000000000n);
});

test('buildLayout lists real files with exact byte sizes, sorted, excluding layout.json and manifest.json', () => {
  const dir = tmpPackage({ 'manifest.json': '{}', 'layout.json': '{}', 'html_ui/b.js': 'héllo', 'html_ui/a.css': 'abc', 'InGamePanels/x.spb': '12' });
  const content = L.buildLayout(dir);
  assert.deepEqual(content.map((c) => [c.path, c.size]), [['InGamePanels/x.spb', 2], ['html_ui/a.css', 3], ['html_ui/b.js', 6]]);
  assert.ok(content.every((c) => typeof c.date === 'bigint' && c.date > 116444736000000000n));
});

test('serialize keeps 18-digit dates exact (no float rounding) and is valid JSON-shaped', () => {
  const text = L.serialize([{ path: 'a/b.js', size: 3, date: 134383687373490986n }]);
  assert.match(text, /"date": 134383687373490986\n/);
  assert.equal(JSON.parse(text).content[0].path, 'a/b.js');
});

test('differences reports missing, extra and resized files, and bad input', () => {
  const content = [{ path: 'a', size: 1 }, { path: 'b', size: 2 }];
  assert.deepEqual(L.differences(content, JSON.stringify({ content: [{ path: 'a', size: 1 }, { path: 'b', size: 2 }] })), []);
  const problems = L.differences(content, JSON.stringify({ content: [{ path: 'a', size: 9 }, { path: 'gone', size: 1 }] }));
  assert.equal(problems.length, 3);
  assert.ok(L.differences(content, 'nope').length === 1);
  assert.ok(L.differences(content, '{}').length === 1);
});

test('hasSpb detects the compiled panel definition', () => {
  assert.equal(L.hasSpb([{ path: 'InGamePanels/a.spb' }]), true);
  assert.equal(L.hasSpb([{ path: 'html_ui/a.js' }]), false);
});

test('the committed layout.json matches the package files on disk', () => {
  const committed = fs.readFileSync(path.join(L.PACKAGE_DIR, 'layout.json'), 'utf8');
  assert.deepEqual(L.differences(L.buildLayout(L.PACKAGE_DIR), committed), []);
});
