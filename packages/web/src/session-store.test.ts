import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from './session-store.ts';

const GLOBAL = 'https://opc.example';
const memory = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
/** The page is reloaded: a new session over the same storage. */
const reload = (storage: ReturnType<typeof memory>) => createSession(storage, GLOBAL);

test('B signing in after A on the same browser acts as no company of A', () => {
  const storage = memory();
  const a = createSession(storage, GLOBAL);
  a.signIn(GLOBAL, 'tok-a', 'toto');
  a.company = 9; // A picks company 9
  a.signOut();
  assert.equal(a.company, null, 'signing out forgets the company at once');
  a.signIn(GLOBAL, 'tok-b', 'toto2'); // B signs in
  assert.equal(a.company, null, 'B starts on the server default: no X-OPC-Company is sent');
  assert.equal(reload(storage).company, null, 'also after a reload');
});

test('a reloaded page keeps the signed-in account\'s choice, and the next account still starts clean', () => {
  const storage = memory();
  const a = createSession(storage, GLOBAL);
  a.signIn(GLOBAL, 'tok-a', 'toto');
  a.company = 9;
  const reloaded = reload(storage);
  assert.equal(reloaded.company, 9);
  reloaded.signOut();
  reloaded.signIn(GLOBAL, 'tok-b', 'toto2');
  assert.equal(reloaded.company, null);
});

test('A signing back in gets A\'s choice back, B keeps its own', () => {
  const storage = memory();
  const s = createSession(storage, GLOBAL);
  s.signIn(GLOBAL, 'tok-a', 'toto');
  s.company = 9;
  s.signOut();
  s.signIn(GLOBAL, 'tok-b', 'toto2');
  s.company = 10;
  s.signOut();
  s.signIn(GLOBAL, 'tok-a2', 'toto');
  assert.equal(s.company, 9);
  s.signOut();
  s.signIn(GLOBAL, 'tok-b2', 'TOTO2');
  assert.equal(s.company, 10);
});

test('the same username on another server is another account', () => {
  const s = createSession(memory(), GLOBAL);
  s.signIn(GLOBAL, 't1', 'toto');
  s.company = 9;
  s.signOut();
  s.signIn('https://other.example', 't2', 'toto');
  assert.equal(s.company, null);
  assert.equal(s.server, 'https://other.example');
});

test('signing out keeps the server and drops the token and the account', () => {
  const storage = memory();
  const s = createSession(storage, GLOBAL);
  s.signIn('https://other.example', 'tok', 'toto');
  s.signOut();
  assert.equal(s.token, null);
  assert.equal(s.server, 'https://other.example');
  assert.deepEqual(JSON.parse(storage.getItem('opc.session')!), { server: 'https://other.example', token: null, username: null });
});

test('while signed out, picking a company remembers nothing', () => {
  const storage = memory();
  const s = createSession(storage, GLOBAL);
  s.company = 4;
  assert.equal(storage.getItem('opc.company'), null);
});

test('storage from before accounts were recorded is handled', () => {
  // old company shape {server: id} is never read for an account
  const legacy = memory({ 'opc.session': JSON.stringify({ server: GLOBAL, token: 'tok' }), 'opc.company': JSON.stringify({ [GLOBAL]: 9 }) });
  const s = reload(legacy);
  assert.equal(s.token, 'tok', 'the session still works');
  assert.equal(s.company, null, 'but acts as the server default');
  s.company = 5;
  assert.equal(JSON.parse(legacy.getItem('opc.company')!)[GLOBAL], 9, 'and writes nothing under an unknown account');
  assert.equal(reload(memory({ 'opc.session': 'not json' })).server, GLOBAL);
});
