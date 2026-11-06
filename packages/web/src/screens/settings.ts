import { session, GLOBAL_URL } from '../api.ts';
import { titleBlock } from '../components.ts';
import { t } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';
import { accountSection, runExport } from './settings-account.ts';
import { copyRevealedKey, focusSoon, hasRevealedKey, keysSection } from './settings-keys.ts';

const SECTIONS = ['keys', 'account'] as const;
type Section = (typeof SECTIONS)[number];
const sectionOf = (arg: string | null): Section => (arg === 'account' ? 'account' : 'keys');
const hashOf = (s: Section): string => (s === 'keys' ? '#settings' : hashFor('settings', 'account'));

/** Réglages: the bridge API keys, and the account and its data. The section is the route argument (`#settings`, `#settings/account`). */
export async function settings(ctx: Ctx): Promise<Screen> {
  const { me } = ctx.snap;
  const section = sectionOf(ctx.arg);
  const server = session.server === GLOBAL_URL ? t('set.serverGlobal') : new URL(session.server).host;

  const nav = h('nav', { class: 'settings-nav-list', 'aria-label': t('set.nav.label') }, SECTIONS.map((s) =>
    h('a', { href: hashOf(s), 'aria-current': s === section ? 'page' : null }, t(s === 'keys' ? 'set.nav.keys' : 'set.nav.account'))));
  const head = h('div', { class: 'settings-nav' }, titleBlock(t('set.status', { user: me.username, server }), t('set.title')), nav);

  const step = (): void => ctx.go(hashOf(section === 'keys' ? 'account' : 'keys'));
  const common = { back: '#dashboard', keys: { left: step, right: step } };

  if (section === 'keys') {
    const { panel, focusName } = await keysSection(ctx);
    const revealed = hasRevealedKey();
    return {
      title: t('set.title'), scene: 'settings', tab: 'settings',
      view: h('div', { class: 'settings-layout' }, head, h('div', { class: 'settings-keys-col' }, panel)),
      hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: '← →', label: t('hint.section') }, { key: 'N', label: t('hint.newKey') }, ...(revealed ? [{ key: 'C', label: t('hint.copyKey') }] : [])],
      back: common.back,
      keys: { ...common.keys, n: focusName, c: () => void copyRevealedKey() },
    };
  }
  const body = await accountSection(ctx);
  return {
    title: t('set.title'), scene: 'settings', tab: 'settings',
    view: h('div', { class: 'settings-layout' }, head, body),
    hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: '← →', label: t('hint.section') }, { key: t('key.enter'), label: t('hint.select') }, { key: 'E', label: t('hint.exportAll') }],
    back: common.back,
    keys: { ...common.keys, e: () => void runExport('json') },
  };
}
