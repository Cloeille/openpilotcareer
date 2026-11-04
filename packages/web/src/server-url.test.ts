import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from './errors.ts';
import { normalizeServer } from './server-url.ts';
import { fmtMoney, fmtNum } from './ui.ts';

test('normalizeServer keeps the origin and path, drops query, hash and trailing slashes', () => {
  assert.equal(normalizeServer('https://opc.example.org'), 'https://opc.example.org');
  assert.equal(normalizeServer('  https://opc.example.org/  '), 'https://opc.example.org');
  assert.equal(normalizeServer('http://localhost:8080/'), 'http://localhost:8080');
  assert.equal(normalizeServer('https://example.org/opc///?x=1#top'), 'https://example.org/opc');
});

test('normalizeServer rejects anything that is not an http(s) URL with a readable message', () => {
  for (const bad of ['', 'opc.example.org', 'ftp://example.org', 'javascript:alert(1)', 'file:///etc/passwd']) {
    assert.throws(() => normalizeServer(bad), (e: unknown) => e instanceof ApiError && e.code === 'bad_url' && e.message.length > 10, bad);
  }
});

test('number formatting', () => {
  assert.equal(fmtMoney(1234567), '$1,234,567');
  assert.equal(fmtMoney(-50), '-$50');
  assert.equal(fmtNum(1234.56, 1), '1,234.6');
});
