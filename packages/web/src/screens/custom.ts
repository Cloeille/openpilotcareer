import { AIRCRAFT_CATEGORIES, WTCS, type AircraftCategory, type Wtc } from '@opc/shared';
import { act } from '../actions.ts';
import { api } from '../api.ts';
import { isIcaoType } from '../catalogue.ts';
import { button, dataTable, inputField, panel, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import type { Key } from '../messages.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

export function custom(ctx: Ctx): Screen {
  const { me } = ctx.snap;
  const fm = fmt();
  const text = (label: string, props: Record<string, unknown>) => inputField({ label }, { type: 'text', required: true, autocomplete: 'off', ...props });
  const num = (label: string, props: Record<string, unknown>) => inputField({ label }, { type: 'number', required: true, ...props });
  const icao = text(t('custom.icao'), { name: 'c-icao', maxlength: 4, pattern: '[A-Za-z0-9]{2,4}', class: 'upper', spellcheck: 'false' });
  const name = text(t('custom.name'), { name: 'c-name', maxlength: 80 });
  const category = inputField({ label: t('custom.category'), control: h('select', { name: 'c-cat' }, AIRCRAFT_CATEGORIES.map((c) => h('option', { value: c }, t(`cat.${c}` as Key)))) });
  const wtc = inputField({ label: t('custom.wtc'), control: h('select', { name: 'c-wtc' }, WTCS.map((w) => h('option', { value: w }, t(`wtc.${w}` as Key)))) });
  const engines = num(t('custom.engines'), { name: 'c-eng', min: 1, max: 8, value: 1 });
  const seats = num(t('custom.seats'), { name: 'c-seats', min: 0, max: 1000, value: 2 });
  const cargo = num(t('custom.cargo'), { name: 'c-cargo', min: 0, max: 500000, value: 0 });
  const cruise = num(t('custom.cruise'), { name: 'c-cruise', min: 20, max: 700, value: 100 });
  const range = num(t('custom.range'), { name: 'c-range', min: 20, max: 9000, value: 400 });
  const n = (f: { control: HTMLInputElement }): number => Number(f.control.value);
  const form = h('form', { class: 'custom-form', onsubmit: (e: Event) => {
    e.preventDefault();
    const code = icao.control.value.trim().toUpperCase();
    if (!isIcaoType(code)) { icao.control.setCustomValidity('2-4 A-Z 0-9'); icao.control.reportValidity(); return; }
    void act(t('custom.defined', { icao: code }), () => api('/me/custom-aircraft', { method: 'POST', body: {
      icao: code, name: name.control.value.trim(), category: (category.control as unknown as HTMLSelectElement).value as AircraftCategory, engines: n(engines),
      wtc: (wtc.control as unknown as HTMLSelectElement).value as Wtc, seats: n(seats), cargoKg: n(cargo), cruiseKts: n(cruise), rangeNm: n(range) } }), ctx.refresh);
  } }, icao.root, name.root, category.root, wtc.root, engines.root, seats.root, cargo.root, cruise.root, range.root, h('div', { class: 'row end' }, button(t('custom.submit'), { variant: 'primary', type: 'submit' })));
  icao.control.addEventListener('input', () => icao.control.setCustomValidity(''));

  const list = me.customAircraft.length === 0 ? h('p', { class: 'dim' }, t('custom.none'))
    : dataTable(t('custom.list'), [{ label: t('custom.icao') }, { label: t('custom.name') }, { label: t('custom.seats') }, { label: t('custom.cargo') }, { label: t('custom.cruise') }, { label: '' }],
      me.customAircraft.map((a) => ({ cells: [h('span', { class: 'mono strong' }, a.icao), a.name, String(a.seats), fm.num(a.cargoKg), fm.kt(a.cruiseKts),
        button(t('custom.remove'), { variant: 'secondary', label: t('custom.removeLabel', { icao: a.icao }), onclick: () => void act(t('custom.removed'), () => api(`/me/custom-aircraft/${a.icao}`, { method: 'DELETE' }), ctx.refresh) })] })));
  const view = h('div', { class: 'custom-column' },
    h('div', { class: 'col' }, titleBlock(t('custom.status', { company: me.company.name }), t('custom.title')), h('p', { class: 'muted intro' }, t('custom.intro'))),
    panel({ title: t('custom.define') }, form),
    panel({ title: t('custom.list') }, list));
  return { title: t('custom.title'), scene: 'fleet', tab: 'fleet', view, back: '#fleet', hints: [{ key: t('key.esc'), label: t('hint.fleet') }, { key: t('key.tab'), label: t('hint.nextField') }] };
}
