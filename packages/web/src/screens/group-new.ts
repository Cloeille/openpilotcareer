import { act } from '../actions.ts';
import { createSubsidiary, fetchGroup } from '../api-group.ts';
import { airportField } from '../airport-field.ts';
import { button, icon, inputField, panel, segments, titleBlock } from '../components.ts';
import { fmt } from '../format.ts';
import { ACTIVITY_KEY, CREATE_REFUSAL_KEY, FUNDING_STEP, GROUP_ACTIVITIES, emptyDraft, parentOf, requestOf, stepCash, toggleId, type NewDraft } from '../group-view.ts';
import { aircraftPicker, companyTag, groupOff } from '../group-ui.ts';
import { t } from '../i18n.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';

/** The form survives a redraw (a language change), not a new visit. */
let draft: NewDraft | null = null;
const redraw = (): void => { window.dispatchEvent(new Event('opc:redraw')); };

/** `#group/new`: identity, base, activity and label, what the parent wires and which aircraft it cedes. Founding is one transaction on the server: any refusal founds nothing. */
export async function groupNew(ctx: Ctx): Promise<Screen> {
  const { go } = ctx;
  const back = '#group';
  const data = await fetchGroup();
  if (!data) return { title: t('gr.new.title'), scene: 'hubs', tab: 'hubs', back, hints: [{ key: t('key.esc'), label: t('gr.title') }], view: groupOff() };
  const parent = parentOf(data);
  const fm = fmt();
  const d: NewDraft = (draft ??= emptyDraft(ctx.snap.me.hubs[0] ?? ''));
  const request = requestOf(d);
  const refused = data.createRefusal;
  const canCreate = request !== null && refused === null;

  const create = (): void => {
    if (!request || !canCreate) return;
    void act(t('gr.new.done', { name: request.name }), () => createSubsidiary(request), ctx.refresh).then((ok) => { if (ok) { draft = null; go('#group'); } });
  };
  const bind = (set: (v: string) => void) => (e: Event): void => { set((e.target as HTMLInputElement).value); };
  const keep = (e: Event): void => { (e.target as HTMLInputElement).value = (e.target as HTMLInputElement).value.toUpperCase(); };

  const name = inputField({ label: t('gr.new.name'), icon: 'building-2' }, { type: 'text', name: 'sub-name', required: true, minlength: 2, maxlength: 40, autocomplete: 'off', value: d.name, oninput: bind((v) => { d.name = v; }) });
  const code = inputField({ label: t('gr.new.code'), hint: t('gr.new.codeHint') }, { type: 'text', name: 'sub-code', required: true, maxlength: 3, pattern: '[A-Za-z]{3}', autocomplete: 'off', spellcheck: 'false', value: d.code, oninput: (e: Event) => { keep(e); d.code = (e.target as HTMLInputElement).value; } });
  const iata = inputField({ label: t('gr.new.iata'), hint: t('gr.new.iataHint') }, { type: 'text', name: 'sub-iata', maxlength: 2, pattern: '[A-Za-z0-9]{2}', autocomplete: 'off', spellcheck: 'false', value: d.iata, oninput: (e: Event) => { keep(e); d.iata = (e.target as HTMLInputElement).value; } });
  const hub = airportField(t('gr.new.hub'), { name: 'sub-hub' });
  hub.input.addEventListener('input', () => { d.hub = hub.input.value; });
  hub.input.value = d.hub;
  const activity = segments(t('gr.new.activity'), GROUP_ACTIVITIES.map((value) => ({ value, label: t(ACTIVITY_KEY[value]) })), d.activity, (v) => { d.activity = v; redraw(); });
  const identity = panel({ title: t('gr.new.identity'), id: 'gr-identity', class: 'rp-main' },
    h('div', { class: 'col' }, name.root, h('div', { class: 'gp-pair' }, code.root, iata.root), hub.root,
      h('div', { class: 'col tight' }, h('span', { class: 'dim small' }, t('gr.new.activity')), activity, h('p', { class: 'dim small' }, t('gr.new.activityNote')))));

  const cash = inputField({ label: t('gr.new.funding'), hint: t('gr.new.fundingHint', { balance: fm.money(parent.balance) }) },
    { type: 'number', name: 'sub-funding', min: 0, step: FUNDING_STEP, inputmode: 'numeric', value: String(d.funding), oninput: bind((v) => { d.funding = Math.max(0, Math.round(Number(v) || 0)); }), onchange: () => redraw() });
  const funding = panel({ title: t('gr.new.fundingTitle'), id: 'gr-funding' }, cash.root, h('p', { class: 'dim small' }, t('gr.new.fundingNote')));

  const fleet = parent.fleet;
  const aircraft = panel({ title: t('gr.new.aircraft'), action: t('gr.new.aircraftSub', { n: d.aircraft.length }), id: 'gr-aircraft' },
    fleet.length === 0 ? h('p', { class: 'dim' }, t('gr.new.noAircraft')) : aircraftPicker(t('gr.new.aircraft'), fleet, d.aircraft, (id) => { d.aircraft = toggleId(d.aircraft, id); redraw(); }), h('p', { class: 'dim small' }, t('gr.new.aircraftNote')));

  const summary = panel({ title: t('gr.new.effect'), id: 'gr-effect' },
    h('p', { class: 'muted' }, t('gr.new.effectBody', { parent: companyTag(parent) })),
    request ? h('p', { class: 'dim small' }, t('gr.new.effectFunding', { amount: fm.money(request.funding), n: request.aircraftIds.length })) : h('p', { class: 'dim small' }, t('gr.new.incomplete')),
    refused ? h('p', { class: 'cr-refusal', role: 'alert' }, icon('triangle-alert', 14), ' ', t(CREATE_REFUSAL_KEY[refused])) : null,
    h('div', { class: 'row' },
      button(t('gr.new.create'), { variant: 'primary', icon: 'building-2', key: t('key.enter'), disabled: !canCreate, onclick: create }),
      button(t('gr.new.cancel'), { variant: 'ghost', icon: 'chevron-right', onclick: () => { draft = null; go(back); } })));

  const header = h('div', { class: 'ln-header rp-header' }, titleBlock(h('span', { class: 'row tight' }, h('span', { class: 'dot' }), h('span', null, `${t('gr.crumb')} · ${t('gr.new.crumb', { parent: parent.name })}`)), t('gr.new.title'), h('p', { class: 'muted', style: 'font-size:14px' }, t('gr.new.sub'))));
  const step = (dir: 1 | -1) => (): void => { d.funding = stepCash(d.funding, dir); redraw(); };
  return {
    title: t('gr.new.title'), scene: 'hubs', tab: 'hubs', back, wide: false,
    view: h('div', { class: 'rp-screen gp-screen' }, header, h('div', { class: 'rp-body' }, identity, h('div', { class: 'rp-side' }, funding, aircraft, summary))),
    hints: [{ key: t('key.esc'), label: t('gr.title') }, { key: '← →', label: t('gr.new.hint.funding') }, { key: t('key.enter'), label: t('gr.new.hint.create') }],
    keys: { left: step(-1), right: step(1) },
  };
}
