import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCompany, writeCompany } from './company-store.ts';

const memory = (initial?: string) => {
  const m = new Map<string, string>(initial === undefined ? [] : [['opc.company', initial]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('the active company is remembered per server and account and can be forgotten', () => {
  const s = memory();
  assert.equal(readCompany(s, 'https://a.example', 'alice'), null);
  writeCompany(s, 'https://a.example', 'alice', 7);
  writeCompany(s, 'https://a.example', 'bob', 8);
  writeCompany(s, 'https://b.example', 'alice', 9);
  assert.equal(readCompany(s, 'https://a.example', 'alice'), 7);
  assert.equal(readCompany(s, 'https://a.example', 'bob'), 8, 'another account on the same server has its own');
  assert.equal(readCompany(s, 'https://b.example', 'alice'), 9);
  writeCompany(s, 'https://a.example', 'alice', null);
  assert.equal(readCompany(s, 'https://a.example', 'alice'), null);
  assert.equal(readCompany(s, 'https://a.example', 'bob'), 8, 'other accounts keep theirs');
  assert.equal(readCompany(s, 'https://b.example', 'alice'), 9, 'other servers keep theirs');
});

test('usernames are matched the way the server matches them, case-insensitively', () => {
  const s = memory();
  writeCompany(s, 'https://a.example', 'Alice', 7);
  assert.equal(readCompany(s, 'https://a.example', 'ALICE'), 7);
});

test('the old {server: id} shape belongs to no known account: it is ignored, then dropped on the next write', () => {
  const old = memory('{"https://a.example":9}');
  assert.equal(readCompany(old, 'https://a.example', 'alice'), null);
  writeCompany(old, 'https://b.example', 'alice', 3);
  assert.equal(old.getItem('opc.company'), '{"https://b.example":{"alice":3}}');
});

test('corrupt or tampered storage is ignored, never sent as a header', () => {
  for (const bad of ['not json', '[1]', '"x"', '{"https://a.example":[7]}', '{"https://a.example":{"alice":"7"}}', '{"https://a.example":{"alice":-1}}', '{"https://a.example":{"alice":1.5}}']) {
    assert.equal(readCompany(memory(bad), 'https://a.example', 'alice'), null, bad);
  }
  assert.equal(readCompany(memory('{"https://a.example":{"alice":7,"bob":"x"},"https://b.example":4}'), 'https://a.example', 'alice'), 7);
});
