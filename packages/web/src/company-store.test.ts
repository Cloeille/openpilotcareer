import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCompany, writeCompany } from './company-store.ts';

const memory = (initial?: string) => {
  const m = new Map<string, string>(initial === undefined ? [] : [['opc.company', initial]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('the active company is remembered per server and can be forgotten', () => {
  const s = memory();
  assert.equal(readCompany(s, 'https://a.example'), null);
  writeCompany(s, 'https://a.example', 7);
  writeCompany(s, 'https://b.example', 9);
  assert.equal(readCompany(s, 'https://a.example'), 7);
  assert.equal(readCompany(s, 'https://b.example'), 9);
  writeCompany(s, 'https://a.example', null);
  assert.equal(readCompany(s, 'https://a.example'), null);
  assert.equal(readCompany(s, 'https://b.example'), 9, 'other servers keep theirs');
});

test('corrupt or tampered storage is ignored, never sent as a header', () => {
  for (const bad of ['not json', '[1]', '"x"', '{"https://a.example":"7"}', '{"https://a.example":-1}', '{"https://a.example":1.5}']) {
    assert.equal(readCompany(memory(bad), 'https://a.example'), null, bad);
  }
  assert.equal(readCompany(memory('{"https://a.example":7,"https://b.example":"x"}'), 'https://a.example'), 7);
});
