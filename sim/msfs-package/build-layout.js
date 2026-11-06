#!/usr/bin/env node
/* Generates openpilotcareer-panel/layout.json: every file in the package (except layout.json and
 * manifest.json) with its byte size and mtime as a Windows FILETIME (100 ns ticks since 1601-01-01 UTC),
 * the magnitude/format seen in the community toolbar-panel template's layout.json; the SDK pages we read do not define it.
 *
 *   node build-layout.js           write layout.json
 *   node build-layout.js --check   fail if layout.json paths/sizes differ from the files on disk
 * No dependencies. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_DIR = path.join(__dirname, 'openpilotcareer-panel');
const EXCLUDED = new Set(['layout.json', 'manifest.json']);
const FILETIME_EPOCH_OFFSET_TICKS = 116444736000000000n; // 1601-01-01 -> 1970-01-01 in 100 ns ticks

function filetimeOf(mtimeNs) {
  return mtimeNs / 100n + FILETIME_EPOCH_OFFSET_TICKS;
}

function listFiles(dir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'Thumbs.db') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile() && !(prefix === '' && EXCLUDED.has(entry.name))) found.push(rel);
  }
  return found;
}

function buildLayout(packageDir) {
  const content = listFiles(packageDir)
    .sort()
    .map((rel) => {
      const st = fs.statSync(path.join(packageDir, ...rel.split('/')), { bigint: true });
      // The date goes out as a JSON number: FILETIME values (~1.3e17) exceed 2^53, so it is spliced in as text.
      return { path: rel, size: Number(st.size), date: filetimeOf(st.mtimeNs) };
    });
  return content;
}

function serialize(content) {
  const rows = content.map(
    (c) => `    {\n      "path": ${JSON.stringify(c.path)},\n      "size": ${c.size},\n      "date": ${c.date}\n    }`,
  );
  return `{\n  "content": [\n${rows.join(',\n')}\n  ]\n}\n`;
}

/* Paths and sizes only: dates change on every git checkout, sizes do not. */
function differences(content, committedText) {
  let committed;
  try {
    committed = JSON.parse(committedText);
  } catch {
    return ['layout.json is missing or not valid JSON'];
  }
  if (!committed || !Array.isArray(committed.content)) return ['layout.json has no "content" array'];
  const problems = [];
  const have = new Map(committed.content.map((c) => [c.path, c.size]));
  for (const c of content) {
    if (!have.has(c.path)) problems.push(`not listed in layout.json: ${c.path}`);
    else if (have.get(c.path) !== c.size) problems.push(`size differs for ${c.path}: layout ${have.get(c.path)}, disk ${c.size}`);
  }
  const onDisk = new Set(content.map((c) => c.path));
  for (const p of have.keys()) if (!onDisk.has(p)) problems.push(`listed but missing on disk: ${p}`);
  return problems;
}

function hasSpb(content) {
  return content.some((c) => /^InGamePanels\/[^/]+\.spb$/i.test(c.path));
}

function main(argv) {
  const layoutPath = path.join(PACKAGE_DIR, 'layout.json');
  const content = buildLayout(PACKAGE_DIR);
  if (!hasSpb(content)) {
    console.warn('WARNING: no InGamePanels/*.spb in the package. The toolbar button will not appear until you compile spb-project/ (see README.md).');
  }
  if (argv.includes('--check')) {
    const problems = differences(content, fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : '');
    if (problems.length) {
      console.error(problems.join('\n'));
      return 1;
    }
    console.log(`layout.json matches ${content.length} files`);
    return 0;
  }
  fs.writeFileSync(layoutPath, serialize(content));
  console.log(`wrote layout.json with ${content.length} files`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { buildLayout, serialize, differences, hasSpb, filetimeOf, listFiles, PACKAGE_DIR };
