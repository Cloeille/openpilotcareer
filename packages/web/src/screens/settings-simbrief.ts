// Settings › SimBrief / Navigraph: connect, change and disconnect the SimBrief identifier saved on the account.
import { simbriefIdentifier } from '@opc/shared';
import { act } from '../actions.ts';
import { connectLink, disconnectLink, getLink } from '../api-simbrief.ts';
import { PRODUCT_NAME } from '../brand.ts';
import { button, inputField, panel } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { isConnected } from '../simbrief-view.ts';
import { h, notify } from '../ui.ts';

const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };
const detail = (label: string, value: string): HTMLElement => h('div', { class: 'detail-row' }, h('span', { class: 'dim' }, label), h('span', { class: 'detail-value mono' }, value));

export async function simbriefSection(): Promise<{ panel: HTMLElement; connected: boolean }> {
  const link = await getLink();
  const on = isConnected(link);

  const field = inputField({ label: t('sb.set.field'), icon: 'user', id: 'simbrief-id' },
    { type: 'text', name: 'simbrief', autocomplete: 'off', maxlength: 64, required: true, spellcheck: 'false', value: link.username ?? (link.pilotId === null ? '' : String(link.pilotId)) });
  field.control.setAttribute('aria-describedby', 'simbrief-id-hint');
  const form = h('form', { class: 'key-create', onsubmit: (e: Event) => {
    e.preventDefault();
    const who = simbriefIdentifier(field.control.value);
    if (who === null) { notify(t('sb.set.invalid'), 'error'); field.control.focus(); return; }
    void act(t('sb.set.saved'), () => connectLink(who), async () => redraw());
  } }, field.root, button(on ? t('sb.set.change') : t('sb.set.connect'), { variant: 'primary', type: 'submit', icon: 'link', key: t('key.enter') }));

  const status = h('div', { class: 'row tight', role: 'status' },
    h('span', { class: on ? 'dot' : 'dot idle', 'aria-hidden': 'true' }), h('span', { class: 'server-name' }, on ? t('sb.set.connected') : t('sb.set.notConnected')));
  const facts = on ? h('div', { class: 'detail-list' },
    detail(t('sb.set.username'), link.username ?? '–'),
    detail(t('sb.set.pilotId'), link.pilotId === null ? '–' : String(link.pilotId)),
    link.verifiedAt === null ? null : detail(t('sb.set.verified'), fmt().date(link.verifiedAt))) : null;
  const disconnect = on ? button(t('sb.set.disconnect'), {
    variant: 'danger', icon: 'unplug',
    onclick: () => { if (confirm(t('sb.set.disconnectConfirm'))) void act(t('sb.set.removed'), disconnectLink, async () => redraw()); },
  }) : null;

  return { connected: on, panel: panel({ title: t('sb.set.title'), id: 'simbrief-panel', class: 'settings-simbrief' },
    h('p', { class: 'muted intro-text' }, t('sb.set.intro', { product: PRODUCT_NAME })),
    status, facts, form, h('small', { id: 'simbrief-id-hint', class: 'dim' }, t('sb.set.fieldHint')), disconnect ? h('div', { class: 'row' }, disconnect) : null,
    h('div', { class: 'privacy-note' }, h('p', { class: 'strong' }, t('sb.set.publicTitle')), h('p', { class: 'muted small' }, t('sb.set.public', { product: PRODUCT_NAME })), h('p', { class: 'muted small' }, t('sb.set.privacy')))) };
}
