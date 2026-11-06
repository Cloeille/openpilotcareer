import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleTab, hashFor, keyAction, parseHash, shortcutOf, stepRow } from './keys.ts';

const press = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });
const TABS = ['dashboard', 'jobs', 'fleet', 'history', 'leaderboard'];

test('Q / E step through the tabs and wrap around', () => {
  assert.equal(cycleTab(TABS, 'dashboard', 1), 'jobs');
  assert.equal(cycleTab(TABS, 'leaderboard', 1), 'dashboard');
  assert.equal(cycleTab(TABS, 'dashboard', -1), 'leaderboard');
  assert.equal(cycleTab(TABS, 'fleet', -1), 'jobs');
});

test('from outside the cycle (settings, a detail screen) E enters at the first tab and Q at the last', () => {
  assert.equal(cycleTab(TABS, null, 1), 'dashboard');
  assert.equal(cycleTab(TABS, null, -1), 'leaderboard');
  assert.equal(cycleTab(TABS, 'nope', 1), 'dashboard');
});

test('keys map to actions, in either case', () => {
  assert.equal(keyAction(press('q'), false), 'prev');
  assert.equal(keyAction(press('Q'), false), 'prev');
  assert.equal(keyAction(press('e'), false), 'next');
  assert.equal(keyAction(press('Escape'), false), 'back');
  assert.equal(keyAction(press('Enter'), false), 'confirm');
  assert.equal(keyAction(press('ArrowDown'), false), 'down');
  assert.equal(keyAction(press('ArrowUp'), false), 'up');
  assert.equal(keyAction(press('x'), false), null);
});

test('while typing, letters and arrows belong to the field and Esc only leaves it', () => {
  for (const k of ['q', 'e', 'Enter', 'ArrowDown', 'ArrowUp']) assert.equal(keyAction(press(k), true), null, k);
  assert.equal(keyAction(press('Escape'), true), 'blur');
});

test('browser shortcuts are never hijacked', () => {
  assert.equal(keyAction(press('q', { ctrlKey: true }), false), null);
  assert.equal(keyAction(press('e', { metaKey: true }), false), null);
  assert.equal(keyAction(press('Escape', { altKey: true }), false), null);
});

test('arrow navigation clamps at both ends and starts at the first row', () => {
  assert.equal(stepRow(5, -1, 1), 0);
  assert.equal(stepRow(5, -1, -1), 0);
  assert.equal(stepRow(5, 2, 1), 3);
  assert.equal(stepRow(5, 4, 1), 4);
  assert.equal(stepRow(5, 0, -1), 0);
  assert.equal(stepRow(0, -1, 1), -1);
});

test('hash routes round-trip their argument', () => {
  assert.deepEqual(parseHash('#jobs'), { name: 'jobs', arg: null });
  assert.deepEqual(parseHash('#job/LFMN-12-3'), { name: 'job', arg: 'LFMN-12-3' });
  assert.deepEqual(parseHash(hashFor('job', 'a/b c')), { name: 'job', arg: 'a/b c' });
  assert.deepEqual(parseHash(''), { name: '', arg: null });
  assert.equal(parseHash('#job/%E0%A4%A').arg, null);
});

test('shortcuts are single letters or digits outside fields, lower-cased, never with modifiers', () => {
  assert.equal(shortcutOf(press('A'), false), 'a');
  assert.equal(shortcutOf(press('1'), false), '1');
  assert.equal(shortcutOf(press('ArrowLeft'), false), 'left');
  assert.equal(shortcutOf(press('ArrowRight'), false), 'right');
  assert.equal(shortcutOf(press('ArrowLeft'), true), null);
  assert.equal(shortcutOf(press('ArrowUp'), false), null);
  assert.equal(shortcutOf(press('a'), true), null);
  assert.equal(shortcutOf(press('a', { ctrlKey: true }), false), null);
  assert.equal(shortcutOf(press('Enter'), false), null);
  assert.equal(shortcutOf(press(' '), false), null);
});
