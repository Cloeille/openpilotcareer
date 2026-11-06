import type { ApiKeyInfo } from '@opc/shared';
import { act } from '../actions.ts';
import { api, session } from '../api.ts';
import { button, inputField, panel } from '../components.ts';
import { PRODUCT_NAME } from '../brand.ts';
import { getLang, t, tp } from '../i18n.ts';
import type { Ctx } from '../screen.ts';
import { MAX_API_KEYS, isJustCreated, keyUsage, keysLeft, numericDate } from '../settings-model.ts';
import { h, notify } from '../ui.ts';

/** The key just created: held in memory only (never stored), and only for the account and server it was made on. Cleared on "I copied it", on revoke, and when another account looks. */
type Revealed = { user: string; server: string; id: number; name: string; key: string };
let revealed: Revealed | null = null;

const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

/** Focus an element that does not exist yet (the screen is being redrawn): retry for about a second. */
export function focusSoon(id: string, tries = 20): void {
  const el = document.getElementById(id);
  if (el) el.focus();
  else if (tries > 0) setTimeout(() => focusSoon(id, tries - 1), 50);
}

export async function copyRevealedKey(): Promise<void> {
  if (!revealed) return;
  try {
    await navigator.clipboard.writeText(revealed.key);
    notify(t('set.keys.copied'));
  } catch {
    notify(t('set.keys.copyFailed'), 'error');
  }
}

export const hasRevealedKey = (): boolean => revealed !== null;

function revealBox(r: Revealed): HTMLElement {
  const copy = button(t('set.keys.copy'), { variant: 'primary', key: 'C', onclick: () => void copyRevealedKey() });
  copy.id = 'key-copy';
  return h('section', { class: 'key-reveal', 'aria-label': t('set.keys.created', { name: r.name }) },
    h('div', { class: 'row' }, h('span', { class: 'key-reveal-status' }, t('set.keys.created', { name: r.name })), h('span', { class: 'key-reveal-once' }, t('set.keys.once'))),
    h('div', { class: 'row tight' },
      h('code', { class: 'key-box', tabindex: 0, 'aria-label': t('set.keys.once') }, r.key),
      copy),
    h('div', { class: 'row' },
      h('p', { class: 'hint-text key-reveal-help' }, t('set.keys.paste', { product: PRODUCT_NAME })),
      button(t('set.keys.iCopied'), { variant: 'ghost', icon: 'check', onclick: () => { revealed = null; redraw(); } })));
}

function keyRow(k: ApiKeyInfo, now: number): HTMLElement {
  const lang = getLang();
  const usage = keyUsage(k.lastUsedAt, now);
  const usageText = usage.kind === 'never' ? t('set.keys.usage.never')
    : usage.kind === 'live' ? t('set.keys.usage.live')
      : usage.kind === 'on' ? t('set.keys.usage.on', { date: numericDate(usage.at, lang) })
        : tp('set.keys.usage.idle', usage.months);
  const revoke = h('button', {
    type: 'button', class: 'btn ghost', 'aria-label': t('set.keys.revokeLabel', { name: k.label }),
    onclick: () => {
      if (!confirm(t('set.keys.revokeConfirm', { name: k.label }))) return;
      void act(t('set.keys.revoked'), () => api(`/me/api-keys/${k.id}`, { method: 'DELETE' }), async () => { if (revealed?.id === k.id) revealed = null; redraw(); });
    },
  }, h('span', null, t('set.keys.revoke')));
  const li = h('li', {
    class: 'key-row', 'data-row': '', tabindex: 0, 'aria-label': `${k.label}. ${usageText}`,
    // Enter on a focused row (a synthetic click) moves to its Revoke button; a mouse click on the row does nothing.
    onclick: (e: MouseEvent) => { if (e.detail === 0 && e.target === li) revoke.focus(); },
  },
  h('div', { class: 'key-name' }, h('span', { class: 'key-label' }, k.label),
    h('span', { class: 'dim small' }, isJustCreated(k.createdAt, now) ? t('set.keys.createdNow') : t('set.keys.createdOn', { date: numericDate(k.createdAt, lang) }))),
  h('div', { class: 'key-used' }, usage.kind === 'live' ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null, h('span', null, usageText)),
  h('div', { class: 'key-action' }, revoke));
  return li;
}

/** Section 1: the bridge API keys. */
export async function keysSection(ctx: Ctx): Promise<{ panel: HTMLElement; focusName: () => void }> {
  const { me } = ctx.snap;
  const keys = await api<ApiKeyInfo[]>('/me/api-keys');
  if (revealed && (revealed.user !== me.username || revealed.server !== session.server)) revealed = null;
  const now = Date.now();
  const full = keys.length >= MAX_API_KEYS;

  const name = inputField({ label: t('set.keys.nameLabel'), icon: 'tag', id: 'key-name' }, { type: 'text', name: 'key-name', maxlength: 40, autocomplete: 'off', placeholder: t('set.keys.namePlaceholder'), disabled: full });
  const create = button(t('set.keys.create'), { variant: 'secondary', icon: 'plus', type: 'submit', disabled: full });
  const form = h('form', { class: 'key-create', onsubmit: (e: Event) => {
    e.preventDefault();
    const label = name.control.value.trim();
    if (label === '') { name.control.focus(); return; }
    void act(t('set.keys.createdToast'), async () => {
      const k = await api<ApiKeyInfo & { key: string }>('/me/api-keys', { method: 'POST', body: { label } });
      revealed = { user: me.username, server: session.server, id: k.id, name: k.label, key: k.key };
    }, async () => { redraw(); focusSoon('key-copy'); });
  } }, name.root, create);

  const list = keys.length === 0
    ? h('p', { class: 'dim small key-empty' }, t('set.keys.empty'))
    : h('ul', { class: 'plain key-list', 'aria-label': t('set.keys.list') }, keys.map((k) => keyRow(k, now)));

  return {
    focusName: () => name.control.focus(),
    panel: panel({ title: t('set.keys.title'), id: 'keys-panel', action: h('span', { class: 'dim' }, t('set.keys.count', { n: keys.length, max: MAX_API_KEYS })), class: 'settings-keys' },
      h('p', { class: 'muted intro-text' }, t('set.keys.intro', { product: PRODUCT_NAME })),
      form,
      revealed ? revealBox(revealed) : null,
      list,
      h('p', { class: 'dim small' }, full ? t('set.keys.quotaFull', { max: MAX_API_KEYS }) : t('set.keys.quota', { max: MAX_API_KEYS, n: keysLeft(keys.length) }))),
  };
}
