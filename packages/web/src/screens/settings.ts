import { session, GLOBAL_URL } from '../api.ts';
import { titleBlock } from '../components.ts';
import { t } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';
import { accountSection, runExport } from './settings-account.ts';
import { simairSection } from './settings-aircraft.ts';
import { simbriefSection } from './settings-simbrief.ts';
import { copyRevealedKey, focusSoon, hasRevealedKey, keysSection } from './settings-keys.ts';

const SECTIONS = ['keys', 'aircraft', 'simbrief', 'account'] as const;
type Section = (typeof SECTIONS)[number];
const sectionOf = (arg: string | null): Section => (arg === 'account' || arg === 'simbrief' || arg === 'aircraft' ? arg : 'keys');
const hashOf = (s: Section): string => (s === 'keys' ? '#settings' : hashFor('settings', s));

/** Réglages: the bridge API keys, and the account and its data. The section is the route argument (`#settings`, `#settings/account`). */
export async function settings(ctx: Ctx): Promise<Screen> {
  const { me } = ctx.snap;
  const section = sectionOf(ctx.arg);
  const server = session.server === GLOBAL_URL ? t('set.serverGlobal') : new URL(session.server).host;

  const nav = h('nav', { class: 'settings-nav-list', 'aria-label': t('set.nav.label') }, SECTIONS.map((s) =>
    h('a', { href: hashOf(s), 'aria-current': s === section ? 'page' : null }, t(`set.nav.${s}`))));
  const head = h('div', { class: 'settings-nav' }, titleBlock(t('set.status', { user: me.username, server }), t('set.title')), nav);

  const step = (by: number): (() => void) => () => ctx.go(hashOf(SECTIONS[(SECTIONS.indexOf(section) + by + SECTIONS.length) % SECTIONS.length]!));
  const common = { back: '#dashboard', keys: { left: step(-1), right: step(1) } };

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
  if (section === 'aircraft') {
    const body = await simairSection(ctx);
    return {
      title: t('set.title'), scene: 'settings', tab: 'settings',
      view: h('div', { class: 'settings-layout' }, head, h('div', { class: 'settings-aircraft-col' }, body.panel)),
      hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: '← →', label: t('hint.section') }, { key: t('key.enter'), label: t('hint.select') }],
      back: common.back, keys: common.keys,
    };
  }
  if (section === 'simbrief') {
    const body = await simbriefSection();
    return {
      title: t('set.title'), scene: 'settings', tab: 'settings',
      view: h('div', { class: 'settings-layout' }, head, h('div', { class: 'settings-keys-col' }, body.panel)),
      hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: '← →', label: t('hint.section') }, { key: t('key.enter'), label: body.connected ? t('sb.set.change') : t('sb.hint.connect') }],
      back: common.back, keys: common.keys,
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
