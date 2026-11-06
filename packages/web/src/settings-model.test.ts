import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFileName, IDLE_AFTER_DAYS, LIVE_WINDOW_MS, MAX_API_KEYS, formatBytes, isJustCreated, keyUsage, keysLeft, listOf, numericDate, pageAll, readLastExport, recordExport, spanOf } from './settings-model.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

test('an API key is described by its last use: never, right now, a date, or idle for months', () => {
  assert.deepEqual(keyUsage(null, NOW), { kind: 'never' });
  assert.deepEqual(keyUsage(NOW - 30_000, NOW), { kind: 'live' });
  assert.deepEqual(keyUsage(NOW - LIVE_WINDOW_MS, NOW), { kind: 'live' });
  const lastWeek = NOW - 7 * DAY;
  assert.deepEqual(keyUsage(lastWeek, NOW), { kind: 'on', at: lastWeek });
  assert.deepEqual(keyUsage(NOW - (IDLE_AFTER_DAYS - 1) * DAY, NOW), { kind: 'on', at: NOW - (IDLE_AFTER_DAYS - 1) * DAY });
  assert.deepEqual(keyUsage(NOW - 7 * 30 * DAY, NOW), { kind: 'idle', months: 7 });
  assert.deepEqual(keyUsage(NOW - IDLE_AFTER_DAYS * DAY, NOW), { kind: 'idle', months: 2 });
});

test('the quota counts keys left out of ten and never goes negative', () => {
  assert.equal(MAX_API_KEYS, 10);
  assert.equal(keysLeft(4), 6);
  assert.equal(keysLeft(10), 0);
  assert.equal(keysLeft(12), 0);
});

test('a key is "just created" for its first minute', () => {
  assert.equal(isJustCreated(NOW - 5_000, NOW), true);
  assert.equal(isJustCreated(NOW - 61_000, NOW), false);
});

test('dates are numeric, in UTC, per language', () => {
  const at = Date.UTC(2026, 9, 21, 23, 30);
  assert.equal(numericDate(at, 'fr'), '21/10/2026');
  assert.equal(numericDate(at, 'en'), '21/10/2026');
});

test('file sizes use decimal units and the language\'s own symbols and decimal mark', () => {
  assert.equal(formatBytes(512, 'fr'), '512\u00a0o');
  assert.equal(formatBytes(86_000, 'fr'), '86\u00a0Ko');
  assert.equal(formatBytes(4_200_000, 'fr'), '4,2\u00a0Mo');
  assert.equal(formatBytes(4_200_000, 'en'), '4.2\u00a0MB');
  assert.equal(formatBytes(212_000, 'en'), '212\u00a0kB');
  assert.equal(formatBytes(0, 'en'), '0\u00a0B');
});

test('the span of a list gives its count and its first and last instants, in any order', () => {
  assert.equal(spanOf([], false), null);
  assert.deepEqual(spanOf([300, 100, 200], false), { count: 3, from: 100, to: 300, capped: false });
  assert.deepEqual(spanOf([5], true), { count: 1, from: 5, to: 5, capped: true });
  assert.deepEqual(spanOf([10, 20, 30, 40], false, 2), { count: 2, from: 10, to: 40, capped: false });
});

test('downloads get their extension last so the operating system can open them', () => {
  assert.equal(exportFileName('attachment; filename="opc-export.json-2026-11-06"', 'json'), 'opc-export-2026-11-06.json');
  assert.equal(exportFileName('attachment; filename="opc-flights.csv-2026-11-06"', 'flights.csv'), 'opc-flights-2026-11-06.csv');
  assert.equal(exportFileName('attachment; filename="opc-transactions.csv-2026-11-06"', 'transactions.csv'), 'opc-transactions-2026-11-06.csv');
  assert.equal(exportFileName('attachment; filename="mine.csv"', 'flights.csv'), 'mine.csv');
  assert.equal(exportFileName(null, 'json'), 'opc-json');
});

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
};

test('the last export is remembered per server, and a new size replaces only its own format', () => {
  const s = memory();
  assert.equal(readLastExport(s, 'https://a.example'), null);
  recordExport(s, 'https://a.example', 'json', 4_200_000, 1000);
  recordExport(s, 'https://a.example', 'flights.csv', 86_000, 2000);
  recordExport(s, 'https://b.example', 'json', 9, 3000);
  assert.deepEqual(readLastExport(s, 'https://a.example'), { at: 2000, bytes: { json: 4_200_000, 'flights.csv': 86_000 } });
  recordExport(s, 'https://a.example', 'json', 4_300_000, 4000);
  assert.deepEqual(readLastExport(s, 'https://a.example'), { at: 4000, bytes: { json: 4_300_000, 'flights.csv': 86_000 } });
  assert.equal(readLastExport(s, 'https://b.example')?.at, 3000);
});

test('corrupt or foreign storage content is ignored, not trusted', () => {
  const s = memory();
  for (const bad of ['not json', '[]', '{"https://a.example":{"at":"x","bytes":{}}}', '{"https://a.example":{"at":1,"bytes":{"json":-5,"flights.csv":"big"}}}']) {
    s.raw.set('opc.lastExport', bad);
    const got = readLastExport(s, 'https://a.example');
    assert.ok(got === null || (got.at === 1 && Object.keys(got.bytes).length === 0), bad);
  }
});

test('a list of names reads naturally in each language', () => {
  assert.equal(listOf(['Azur'], 'fr'), 'Azur');
  assert.equal(listOf(['Azur', 'Nord'], 'fr'), 'Azur et Nord');
  assert.equal(listOf(['Azur', 'Nord', 'Sud'], 'en'), 'Azur, Nord and Sud');
});

test('pageAll walks pages newest to oldest and stops at a short page', async () => {
  const all = Array.from({ length: 5 }, (_, i) => ({ id: 5 - i }));
  const calls: (number | undefined)[] = [];
  const fetchPage = async (before: number | undefined) => { calls.push(before); return all.filter((x) => before === undefined || x.id < before).slice(0, 2); };
  const got = await pageAll(fetchPage, 2, 10);
  assert.deepEqual(got.items.map((x) => x.id), [5, 4, 3, 2, 1]);
  assert.equal(got.capped, false);
  assert.deepEqual(calls, [undefined, 4, 2]);
});

test('pageAll stops at the page limit and says the list may be longer', async () => {
  let id = 100;
  const got = await pageAll(async () => [{ id: id-- }, { id: id-- }], 2, 3);
  assert.equal(got.items.length, 6);
  assert.equal(got.capped, true);
});

test('pageAll on an empty list is empty and not capped', async () => {
  assert.deepEqual(await pageAll(async () => [], 200, 10), { items: [], capped: false });
});
