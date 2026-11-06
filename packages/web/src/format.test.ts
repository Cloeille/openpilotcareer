import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFormat } from './format.ts';

const fr = makeFormat('fr');
const en = makeFormat('en');
const NBSP = '\u00a0';

test('fr: the mockup formats, with no-break spaces', () => {
  assert.equal(fr.money(1284560), `1${NBSP}284${NBSP}560${NBSP}€`);
  assert.equal(fr.kg(1070), `1${NBSP}070${NBSP}kg`);
  assert.equal(fr.kt(412), `412${NBSP}kt`);
  assert.equal(fr.nm(312), `312${NBSP}NM`);
  assert.equal(fr.num(4.6, 1), '4,6');
  assert.equal(fr.percent(0.72), `72${NBSP}%`);
});

test('en: same shape, English separators', () => {
  assert.equal(en.money(1284560), '€1,284,560');
  assert.equal(en.kg(1070), `1,070${NBSP}kg`);
  assert.equal(en.num(4.6, 1), '4.6');
});

test('signed money shows + for gains and the minus sign for losses', () => {
  assert.equal(fr.signedMoney(12480), `+12${NBSP}480${NBSP}€`);
  assert.equal(fr.signedMoney(-50), `-50${NBSP}€`);
  assert.equal(fr.signedMoney(0), `0${NBSP}€`);
});

test('zulu time is UTC, 24 h, zero padded', () => {
  assert.equal(fr.zulu(Date.UTC(2026, 10, 4, 18, 42)), '18:42Z');
  assert.equal(en.zulu(Date.UTC(2026, 10, 4, 7, 5)), '07:05Z');
});

test('duration is hours and zero-padded minutes', () => {
  assert.equal(fr.duration(1.5), `1${NBSP}h 30`);
  assert.equal(fr.duration(64 / 60), `1${NBSP}h 04`);
  assert.equal(fr.duration(0), `0${NBSP}h 00`);
});

test('season: month name and whole days left in the UTC month', () => {
  const s = fr.season(Date.UTC(2026, 10, 5, 12));
  assert.equal(s.month, 'novembre');
  assert.equal(s.daysLeft, 25);
  assert.equal(fr.season(Date.UTC(2026, 10, 30, 23)).daysLeft, 0);
  assert.equal(en.season(Date.UTC(2026, 11, 30, 12)).daysLeft, 1);
});

test('ago: calendar days in words', () => {
  const now = Date.UTC(2026, 10, 5, 9);
  assert.equal(fr.ago(Date.UTC(2026, 10, 5, 1), now), "aujourd’hui");
  assert.equal(fr.ago(Date.UTC(2026, 10, 4, 23), now), 'hier');
  assert.equal(en.ago(Date.UTC(2026, 10, 4, 23), now), 'yesterday');
  assert.equal(en.ago(Date.UTC(2026, 10, 2, 8), now), '3 days ago');
});

test('elapsed: seconds, minutes, hours', () => {
  assert.equal(fr.elapsed(12_400), `12${NBSP}s`);
  assert.equal(fr.elapsed(59_000), `59${NBSP}s`);
  assert.equal(fr.elapsed(3 * 60_000 + 5000), `3${NBSP}min`);
  assert.equal(fr.elapsed(2 * 3_600_000), `2${NBSP}h`);
  assert.equal(fr.elapsed(-5), `0${NBSP}s`);
});
