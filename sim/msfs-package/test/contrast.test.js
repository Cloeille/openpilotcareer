'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'openpilotcareer-panel', 'html_ui', 'InGamePanels', 'OpenPilotCareer', 'OpenPilotCareer.css'), 'utf8');

// Design tokens (packages/web/src/design/tokens.css) flattened onto the tablet's screen colour.
const SCREEN = '#07090c';
const SIGN_FROM_BG = '#0a0a0a'; // airport sign, departure
const SIGN_TO_BG = '#e6be4c'; // airport sign, destination (fill)
const BTN_BG = '#eceae5'; // primary button
const KEY_BG = '#dedcd7'; // "Enter" keycap inside the primary button

const TEXT_ON_SCREEN = ['#eceae5', '#a6a8ab', '#7c7f83', '#e6be4c', '#e9a046', '#5cc98a'];
const TEXT_PAIRS = [
  ['#e6be4c', SIGN_FROM_BG],
  ['#121314', SIGN_TO_BG],
  ['#111214', BTN_BG],
  ['#5a5a5a', KEY_BG],
  ['#111214', '#eceae5'], // logo mark glyph on its tile
];
// Borders and icons that carry state (rejected box, focus ring, connection notices, selected tab underline).
const STATE_ON_SCREEN = ['#e5625b', '#6fb4d4', '#e9a046', '#5cc98a', '#eceae5', '#d27ae4'];
// Decoration only (dividers, bezel, unreached stepper bars, shadow, hover tint): the design uses them and no information depends on them.
const DECORATION = ['#1a1c1f', '#313235', '#25272a', '#2a2e35', '#101215', '#000000', '#f2f0ec', '#bdbbb6'];

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
  const checked = new Set([SCREEN, SIGN_FROM_BG, SIGN_TO_BG, BTN_BG, KEY_BG, ...TEXT_ON_SCREEN, ...TEXT_PAIRS.flat(), ...STATE_ON_SCREEN, ...DECORATION]);
  assert.deepEqual([...used].sort(), [...checked].sort());
});

test('text colours reach WCAG AA (4.5:1) on the tablet screen', () => {
  for (const fg of TEXT_ON_SCREEN) assert.ok(ratio(fg, SCREEN) >= 4.5, `${fg} on ${SCREEN} = ${ratio(fg, SCREEN).toFixed(2)}`);
});

test('text on filled parts (signs, primary button, keycap) reaches WCAG AA', () => {
  for (const [fg, bg] of TEXT_PAIRS) assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
});

test('state borders and icons reach 3:1 against the tablet screen', () => {
  for (const fg of STATE_ON_SCREEN) assert.ok(ratio(fg, SCREEN) >= 3, `${fg} on ${SCREEN} = ${ratio(fg, SCREEN).toFixed(2)}`);
});

test('the disabled close button is the only dimmed control, and it says why in a visible hint', () => {
  assert.equal((CSS.match(/opacity:\s*0\.35/g) || []).length, 1);
  assert.match(CSS, /\.opc-btn:disabled\s*\{[^}]*opacity: 0\.35/);
});

test('no web-only CSS the sim may not support: no custom properties, no flex gap', () => {
  assert.ok(!/var\(--/.test(CSS) && !/--[a-z-]+\s*:/.test(CSS), 'custom properties');
  assert.ok(!/\bgap\s*:/.test(CSS), 'gap');
});
