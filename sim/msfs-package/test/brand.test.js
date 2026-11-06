'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const VM = require('../openpilotcareer-panel/html_ui/InGamePanels/OpenPilotCareer/view-model.js');

test('the panel shows the same product name as the web app (packages/web/src/brand.ts)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'web', 'src', 'brand.ts'), 'utf8');
  const name = /PRODUCT_NAME\s*=\s*'([^']+)'/.exec(src)[1];
  assert.equal(VM.BRAND, name);
});

test('panel.js builds the DOM without innerHTML, outerHTML, insertAdjacentHTML or document.write', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'openpilotcareer-panel', 'html_ui', 'InGamePanels', 'OpenPilotCareer', 'panel.js'), 'utf8');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(']) assert.ok(!src.includes(bad), bad);
});
