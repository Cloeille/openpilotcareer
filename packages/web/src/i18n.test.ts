import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elide, pickLang, translate, translatePlural } from './i18n.ts';
import { en, fr } from './messages.ts';

test('a stored choice wins over the browser language', () => {
  assert.equal(pickLang('fr', ['en-US']), 'fr');
  assert.equal(pickLang('en', ['fr-FR']), 'en');
});

test('without a stored choice the first supported browser language is used, else English', () => {
  assert.equal(pickLang(null, ['fr-CA', 'en']), 'fr');
  assert.equal(pickLang(null, ['de', 'en-GB']), 'en');
  assert.equal(pickLang(null, ['de', 'ja']), 'en');
  assert.equal(pickLang(null, []), 'en');
  assert.equal(pickLang('klingon', ['fr']), 'fr');
});

test('translate fills placeholders and leaves unknown ones visible', () => {
  assert.equal(translate('en', 'hud.rank', { n: 4, pct: '72 %' }), 'Rank 4 · 72 %');
  assert.equal(translate('fr', 'hud.rank', { n: 4, pct: '72 %' }), 'Rang 4 · 72 %');
  assert.equal(translate('en', 'hud.rank', { n: 4 }), 'Rank 4 · {pct}');
});

test('a key missing from a language falls back to English, then to the key itself', () => {
  const key = 'hud.balance';
  const saved = fr[key];
  delete (fr as Partial<typeof fr>)[key];
  try {
    assert.equal(translate('fr', key), en[key]);
  } finally {
    (fr as Record<string, string>)[key] = saved;
  }
  assert.equal(translate('fr', 'not.a.key' as never), 'not.a.key');
});

test('plural forms follow the language rules', () => {
  assert.equal(translatePlural('en', 'hud.daysLeft', 1), '1 day left');
  assert.equal(translatePlural('en', 'hud.daysLeft', 25), '25 days left');
  assert.equal(translatePlural('fr', 'hud.daysLeft', 1), 'encore 1 jour');
  assert.equal(translatePlural('fr', 'hud.daysLeft', 0), 'encore 0 jour');
  assert.equal(translatePlural('fr', 'hud.daysLeft', 25), 'encore 25 jours');
});

test('a job load of one passenger is singular in both languages (French counts 0 and 1 as singular)', () => {
  assert.equal(translatePlural('en', 'job.pax', 1), '1 passenger');
  assert.equal(translatePlural('fr', 'job.pax', 1), '1 passager');
  assert.equal(translatePlural('fr', 'job.pax', 0), '0 passager');
  assert.equal(translatePlural('fr', 'job.pax', 2), '2 passagers');
  assert.equal(translatePlural('en', 'job.pax', 2), '2 passengers');
});

test('both dictionaries have exactly the same keys and the same placeholders', () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
  for (const k of Object.keys(en) as (keyof typeof en)[]) assert.deepEqual(vars(fr[k]), vars(en[k]), k);
});

test('French elides "de" before the vowel months only', () => {
  assert.equal(elide('Saison de octobre'), 'Saison d’octobre');
  assert.equal(elide('Fin de la saison de avril'), 'Fin de la saison d’avril');
  assert.equal(elide('Podium de août'), 'Podium d’août');
  assert.equal(elide('Saison de novembre'), 'Saison de novembre');
  assert.equal(elide('décembre'), 'décembre');
  assert.equal(translate('fr', 'hud.season', { month: 'octobre' }), 'Saison d’octobre');
  assert.equal(translate('en', 'hud.season', { month: 'October' }), 'October season');
});
