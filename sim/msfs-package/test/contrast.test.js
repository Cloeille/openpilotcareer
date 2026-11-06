'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'openpilotcareer-panel', 'html_ui', 'InGamePanels', 'OpenPilotCareer', 'OpenPilotCareer.css'), 'utf8');

const BG = '#0e141b';
const CARD = '#17202b';
const TEXT = ['#f1f5f9', '#b4c1cf', '#7cc4ff', '#86e8b0', '#ffd166', '#ff9b9b'];
const BORDERS = ['#7f93a8', '#7cc4ff', '#86e8b0', '#ffd166', '#ff9b9b'];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the palette in the CSS is exactly the palette checked here', () => {
  const used = new Set(CSS.match(/#[0-9a-f]{6}\b/gi).map((c) => c.toLowerCase()));
  const checked = new Set([BG, CARD, ...TEXT, ...BORDERS]);
  assert.deepEqual([...used].sort(), [...checked].sort());
});

test('text colours reach WCAG AA (4.5:1) on both backgrounds', () => {
  for (const fg of TEXT) for (const bg of [BG, CARD]) assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
});

test('state borders reach 3:1 against the surfaces they sit on', () => {
  for (const fg of BORDERS) for (const bg of [BG, CARD]) assert.ok(ratio(fg, bg) >= 3, `${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
});
