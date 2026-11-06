import { MAX_COMPANIES_PER_USER, STARTER_AIRCRAFT, STARTING_BALANCE, type Me } from '@opc/shared';
import { act } from '../actions.ts';
import { api, session } from '../api.ts';
import { airportField } from '../airport-field.ts';
import { button, inputField, line, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

export function newCompany(ctx: Ctx): Screen {
  const { snap, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const full = me.companies.length >= MAX_COMPANIES_PER_USER;
  const name = inputField({ label: t('nc.name'), icon: 'plane' }, { type: 'text', name: 'new-company-name', required: true, minlength: 2, maxlength: 40, autocomplete: 'off' });
  const hub = airportField(t('nc.hub'), { name: 'new-company-hub' });
  const form = h('form', { class: 'col', onsubmit: (e: Event) => {
    e.preventDefault();
    void act(t('nc.created'), async () => {
      const created = await api<Me>('/me/companies', { method: 'POST', body: { name: name.control.value.trim(), hub: hub.input.value.trim().toUpperCase() } });
      session.company = created.company.id;
    }, ctx.refresh).then((ok) => { if (ok) go('#fleet'); });
  } }, name.root, hub.root, h('div', { class: 'row' }, button(t('nc.create'), { variant: 'primary', type: 'submit', disabled: full, key: full ? undefined : t('key.enter') })));
  const view = h('div', { class: 'briefing-column' },
    h('div', { class: 'col' }, titleBlock(t('nc.status', { user: me.username }), t('nc.title')), h('p', { class: 'muted intro' }, t('nc.intro')), h('p', { class: 'dim' }, tp('nc.count', me.companies.length, { max: MAX_COMPANIES_PER_USER }))),
    full ? h('p', { class: 'error-text', role: 'alert' }, t('nc.limit', { max: MAX_COMPANIES_PER_USER })) : panel({ title: t('nc.title') }, form),
    panel({ title: t('nc.start') }, line(t('nc.capital'), fm.money(STARTING_BALANCE)), line(t('nc.aircraft'), t('nc.aircraftV', { icao: STARTER_AIRCRAFT })), h('p', { class: 'dim small' }, t('nc.firstHub')), h('p', { class: 'dim small' }, t('fin.nc.lease'))));
  return { title: t('nc.title'), scene: 'fleet', tab: 'fleet', view, back: '#fleet', hints: [{ key: t('key.esc'), label: t('hint.fleet') }, { key: t('key.enter'), label: t('hint.create') }] };
}
