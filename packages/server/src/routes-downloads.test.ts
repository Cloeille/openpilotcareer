import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { harness } from './harness.ts';

function files(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opc-dl-'));
  writeFileSync(join(dir, 'opc-bridge-win-x64.exe'), 'MZ-fake-exe');
  writeFileSync(join(dir, 'openpilotcareer-panel.zip'), 'PK-fake-zip');
  writeFileSync(join(dir, 'secret.txt'), 'nope');
  return dir;
}

test('downloads: the two files are served with their content type; everything else is 404', async (t) => {
  const dir = files();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { call } = await harness({ downloads: dir });
  const exe = await call('GET', '/downloads/opc-bridge-win-x64.exe');
  assert.equal(exe.status, 200);
  assert.equal(exe.headers['content-type'], 'application/vnd.microsoft.portable-executable');
  assert.equal(exe.text, 'MZ-fake-exe');
  assert.match(String(exe.headers['content-disposition']), /attachment; filename="opc-bridge-win-x64.exe"/);
  const zip = await call('GET', '/downloads/openpilotcareer-panel.zip');
  assert.equal(zip.status, 200);
  assert.equal(zip.headers['content-type'], 'application/zip');
  for (const bad of ['secret.txt', '..%2Fsecret.txt', '%2e%2e%2fsecret.txt', 'constructor', '__proto__', 'opc-bridge-win-x64.exe.bak']) {
    assert.equal((await call('GET', `/downloads/${bad}`)).status, 404, bad);
  }
});

test('downloads: 404 when OPC_DOWNLOADS is unset or the file is not built', async () => {
  assert.equal((await (await harness()).call('GET', '/downloads/opc-bridge-win-x64.exe')).status, 404);
  const dir = mkdtempSync(join(tmpdir(), 'opc-dl-'));
  try {
    assert.equal((await (await harness({ downloads: dir })).call('GET', '/downloads/openpilotcareer-panel.zip')).status, 404);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
