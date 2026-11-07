import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanyImpact } from '@opc/shared';
import { losses, passwordOpen, readiness, type Confirmation } from './company-actions-model.ts';
import { createSession } from './session-store.ts';

const impact: CompanyImpact = { aircraft: 3, lines: 0, staff: 12, balance: 1_250_000, flights: 40, flightActive: false };
const base: Confirmation = { name: 'Azur Régional', typedName: '', password: '', impact, busy: false };

test('the destructive button opens only after the exact name, then a password, and never while loading, busy or flying', () => {
  assert.equal(readiness({ ...base, impact: null }), 'loading');
  assert.equal(readiness(base), 'name_mismatch');
  assert.equal(readiness({ ...base, typedName: 'azur régional', password: 'x' }), 'name_mismatch', 'the name must match exactly');
  assert.equal(readiness({ ...base, typedName: 'Azur', password: 'x' }), 'name_mismatch');
  assert.equal(readiness({ ...base, typedName: 'Azur Régional' }), 'password_missing');
  assert.equal(readiness({ ...base, typedName: '  Azur Régional ', password: 'x' }), 'ready', 'surrounding spaces are not part of a name');
  assert.equal(readiness({ ...base, typedName: 'Azur Régional', password: 'x', busy: true }), 'busy');
  assert.equal(readiness({ ...base, typedName: 'Azur Régional', password: 'x', impact: { ...impact, flightActive: true } }), 'flight_active');
});

test('the password field stays shut until the name matches', () => {
  assert.equal(passwordOpen(base), false);
  assert.equal(passwordOpen({ ...base, typedName: 'Azur Régional' }), true);
  assert.equal(passwordOpen({ ...base, typedName: 'Azur Régional', impact: { ...impact, flightActive: true } }), false);
  assert.equal(passwordOpen({ ...base, typedName: 'Azur Régional', impact: null }), false);
});

test('the dialog counts what exists and leaves out what does not', () => {
  assert.deepEqual(losses(impact), [{ kind: 'aircraft', n: 3 }, { kind: 'staff', n: 12 }, { kind: 'flights', n: 40 }]);
  assert.deepEqual(losses({ ...impact, aircraft: 0, staff: 0, flights: 0 }), []);
});

test('session.forget clears the remembered company of the signed-in account, for that company only', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const s = createSession(storage, 'https://opc.example');
  s.signIn('https://opc.example', 'tok', 'Amy');
  s.company = 7;
  s.forget(8);
  assert.equal(s.company, 7);
  s.forget(7);
  assert.equal(s.company, null);
  assert.equal(createSession(storage, 'https://opc.example').company, null, 'and a reload does not bring it back');
});
