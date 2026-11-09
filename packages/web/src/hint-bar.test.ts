import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
const { hintItem, keyButton } = await import('./hint-bar.ts');
const { installInput } = await import('./input.ts');
const { t } = await import('./i18n.ts');
type NavState = NonNullable<Parameters<typeof installInput>[0]['state'] extends () => infer S ? S : never>;

const calls: string[] = [];
let state: NavState | null = null;
installInput({ state: () => state, go: (hash) => { calls.push(`go ${hash}`); } });

const bar = (...items: { key: string; label: string }[]): HTMLElement => {
  const el = document.createElement('div');
  el.append(...items.map(hintItem));
  document.body.append(el);
  return el;
};
const button = (root: ParentNode, name: string): HTMLButtonElement => {
  const el = [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name);
  assert.ok(el, `no button named ${name}`);
  return el;
};
const seen: { key: string; code: string; on: string }[] = [];
document.addEventListener('keydown', (e) => seen.push({ key: e.key, code: e.code, on: (e.target as Element).id || (e.target as Element).tagName }));

beforeEach(() => { document.body.replaceChildren(); calls.length = 0; seen.length = 0; state = { tab: 'jobs', back: null, keys: {} }; });

test('clicking the Esc hint goes back, like the Esc key', () => {
  state = { tab: 'jobs', back: () => { calls.push('back'); }, keys: {} };
  button(bar({ key: t('key.esc'), label: 'Company' }), `Company (${t('key.esc')})`).click();
  assert.deepEqual(calls, ['back']);
  assert.deepEqual(seen, [{ key: 'Escape', code: 'Escape', on: 'BODY' }]);
});

test('clicking a letter hint runs the screen shortcut', () => {
  state = { tab: 'jobs', back: null, keys: { t: () => { calls.push('t'); } } };
  button(bar({ key: 'T', label: 'Mode' }), 'Mode (T)').click();
  assert.deepEqual(calls, ['t']);
  assert.deepEqual(seen, [{ key: 't', code: 'KeyT', on: 'BODY' }]);
});

test('a composite hint has one button per key: → sends ArrowRight, ← ArrowLeft', () => {
  state = { tab: 'jobs', back: null, keys: { right: () => { calls.push('right'); }, left: () => { calls.push('left'); } } };
  const el = bar({ key: '← →', label: 'Month' });
  button(el, 'Month (→)').click();
  button(el, 'Month (←)').click();
  assert.deepEqual(calls, ['right', 'left']);
  assert.deepEqual(seen.map((s) => s.key), ['ArrowRight', 'ArrowLeft']);
});

test('a digit range has one button per digit, with Digit codes', () => {
  state = { tab: 'jobs', back: null, keys: { 3: () => { calls.push('3'); } } };
  const el = bar({ key: '1 – 4', label: 'Reports' });
  assert.equal(el.querySelectorAll('button').length, 4);
  button(el, 'Reports (3)').click();
  assert.deepEqual(calls, ['3']);
  assert.deepEqual(seen, [{ key: '3', code: 'Digit3', on: 'BODY' }]);
});

test('the pointer press keeps the focus on the row, so Enter opens it and the arrows step from it', () => {
  const rows = ['a', 'b'].map((id) => Object.assign(document.createElement('tr'), { id, tabIndex: 0 }));
  rows.forEach((r) => { r.dataset.row = ''; r.addEventListener('click', () => { calls.push(`open ${r.id}`); }); });
  document.body.append(...rows);
  const el = bar({ key: t('key.enter'), label: 'Open' }, { key: '↑ ↓', label: 'Browse' });
  rows[0]!.focus();
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  button(el, `Open (${t('key.enter')})`).dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  button(el, `Open (${t('key.enter')})`).click();
  assert.deepEqual(calls, ['open a']);
  assert.equal(document.activeElement, rows[0]);
  assert.equal(seen[0]?.on, 'a');
  button(el, 'Browse (↓)').click();
  assert.equal(document.activeElement, rows[1]);
});

test('Enter on a focused control keeps its native meaning: the hint presses that control', () => {
  const ok = Object.assign(document.createElement('button'), { onclick: () => { calls.push('ok'); } });
  document.body.append(ok);
  ok.focus();
  button(bar({ key: t('key.enter'), label: 'Open' }), `Open (${t('key.enter')})`).click();
  assert.deepEqual(calls, ['ok']);
});

test('activating a focused hint (Tab, then Enter or Space) fires its key once', () => {
  state = { tab: 'jobs', back: null, keys: { t: () => { calls.push('t'); } } };
  const hint = button(bar({ key: 'T', label: 'Mode' }), 'Mode (T)');
  hint.focus();
  hint.click();
  assert.deepEqual(calls, ['t']);
  assert.equal(seen.length, 1);
  assert.equal(hint.type, 'button');
  assert.equal(hint.tabIndex, 0);
});

test('Q and E next to the tabs step the tab cycle', () => {
  document.body.append(keyButton('Q', 'Previous tab'), keyButton('E', 'Next tab'));
  button(document.body, 'Next tab (E)').click();
  button(document.body, 'Previous tab (Q)').click();
  assert.deepEqual(calls, ['go #network', 'go #live']);
});

test('the mouse hint is plain text, not a button', () => {
  const el = bar({ key: t('key.mouse'), label: 'Pan' });
  assert.equal(el.querySelector('button'), null);
  assert.match(el.textContent ?? '', /Pan/);
});
