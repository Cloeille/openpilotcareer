import { icon, button, inputField, panel } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import {
  LIVERY_COLORS, START_FACTS, isValidCallsign, isValidCode, isValidName, liveryIdOf, normalizeCallsign, normalizeCode, otherMode, suggestCallsign, suggestCode,
} from '../onboarding-model.ts';
import { codeAvailable, createOnboardingCompany, hubSuggestions, putOnboarding } from '../api-onboarding.ts';
import type { HubSuggestion, StartMode } from '../onboarding-types.ts';
import { session } from '../api.ts';
import { PRODUCT_NAME } from '../brand.ts';
import { arrows, guarded, hintsOf, obError, titleArea, tk, type StepResult, type Wizard } from '../onboarding-shell.ts';
import { debounce, h } from '../ui.ts';
import type { Key } from '../messages.ts';

// ------------------------------------------------------------------ step 1: choix du départ

const meter = (n: number): HTMLElement => h('div', { class: 'ob-meter', role: 'img', 'aria-label': t('ob.s1.demandOf', { n }) }, [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= n ? 'on' : '' })));

function pathCard(mode: StartMode, checked: boolean, disabled: boolean): HTMLElement {
  const f = START_FACTS[mode];
  const a = mode === 'airliner';
  const input = h('input', { type: 'radio', name: 'start', class: 'ob-radio', value: mode, checked, disabled, id: `start-${mode}`, 'aria-describedby': `start-${mode}-desc` });
  const fact = (label: Key, value: string): HTMLElement => h('div', { class: 'ob-fact' }, h('span', { class: 'ob-fact-label' }, t(label)), h('span', { class: 'ob-fact-value' }, value));
  return h('label', { class: 'ob-card ob-path', for: `start-${mode}` },
    input,
    h('div', { class: 'ob-path-head' },
      h('div', { class: 'ob-path-icon' }, icon(a ? 'plane' : 'fan', 22)),
      h('div', { class: 'ob-tags' }, h('span', { class: 'ob-sel' }, icon('check', 13), t('ob.selected')), h('span', { class: 'ob-tag' }, t(a ? 'ob.s1.fastest' : 'ob.s1.hardest')))),
    h('div', null,
      h('div', { class: 'ob-path-title' }, t(a ? 'ob.s1.airliner' : 'ob.s1.hardcore')),
      h('p', { class: 'ob-path-desc', id: `start-${mode}-desc` }, t(a ? 'ob.s1.airlinerDesc' : 'ob.s1.hardcoreDesc'))),
    h('div', { class: 'ob-facts' },
      fact('ob.s1.capital', fmt().money(f.capital)),
      fact('ob.s1.first', t(a ? 'ob.s1.airlinerFirst' : 'ob.s1.hardcoreFirst')),
      fact('ob.s1.hub', t(a ? 'ob.s1.airlinerHub' : 'ob.s1.hardcoreHub')),
      fact('ob.s1.realism', t(a ? 'ob.s1.airlinerRealism' : 'ob.s1.hardcoreRealism')),
      h('div', { class: 'ob-fact' }, h('span', { class: 'ob-fact-label' }, t('ob.s1.demand')), meter(f.demand))));
}

export function step1(w: Wizard): StepResult {
  const saved = w.ob.startMode;
  let mode: StartMode = saved ?? 'airliner';
  const cards = h('div', { class: 'ob-paths', role: 'radiogroup', 'aria-label': t('ob.s1.group') }, pathCard('airliner', mode === 'airliner', false), pathCard('hardcore', mode === 'hardcore', false));
  const warn = h('span', { class: 'ob-note', 'aria-live': 'polite' }, t('ob.s1.change'));
  const replacing = (): boolean => w.ob.companyId !== null && saved !== null && mode !== saved;
  cards.addEventListener('change', (e) => { mode = (e.target as HTMLInputElement).value as StartMode; warn.textContent = replacing() ? t('ob.s1.replace') : t('ob.s1.change'); });
  const error = h('p', { class: 'ob-error', role: 'alert' });
  const go = async (custom: boolean): Promise<void> => {
    w.wantsCustom = custom;
    if (saved === null || mode !== saved || w.additional && w.ob.companyId === null) {
      const hadCompany = w.ob.companyId !== null;
      w.ob = await putOnboarding({ step: 2, startMode: mode });
      if (hadCompany && w.ob.companyId === null) { session.company = null; w.me = null; w.form.hub = null; w.form.hubQuery = ''; }
    }
    w.go(2);
  };
  const cont = button(t('ob.s1.continue'), { variant: 'primary', key: t('key.enter'), onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, () => go(false)) });
  const custom = button(t('ob.s1.custom'), { variant: 'ghost', onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, () => go(true)) });
  const view = h('div', { class: 'ob-page' },
    titleArea(t('ob.s1.over', { product: PRODUCT_NAME }), t('ob.s1.title'), t('ob.s1.sub')),
    cards,
    h('div', { class: 'ob-foot' }, h('div', { class: 'ob-foot-left' }, custom, warn, error), cont));
  return {
    scene: 'fleet', view, back: () => w.prev(),
    hints: hintsOf(...(w.additional ? [[t('key.esc'), t('ob.hint.leave')] as [string, string]] : []), [arrows('lr'), t('ob.hint.changeStart')], [t('key.enter'), t('ob.hint.chooseStart')]),
  };
}

// ------------------------------------------------------------------ step 2: compagnie & hub

const sizeKey = { large: 'ob.s2.sizeLarge', medium: 'ob.s2.sizeMedium', small: 'ob.s2.sizeSmall' } as const;
const NOTE_KEYS: Record<string, Key> = { balanced: 'ob.s2.note.balanced', most_jobs: 'ob.s2.note.most_jobs', cheapest: 'ob.s2.note.cheapest', least_competition: 'ob.s2.note.least_competition' };
const noteOf = (s: HubSuggestion): string => (s.noteKey && NOTE_KEYS[s.noteKey] ? t(NOTE_KEYS[s.noteKey]!) : s.note);

function implications(s: HubSuggestion | null): HTMLElement {
  if (!s) return h('div', { class: 'ob-hub-impl' }, h('p', { class: 'dim' }, t('ob.s2.pickHub')));
  const fact = (l: string, v: string, sub: string): HTMLElement => h('div', { class: 'ob-impl-fact' }, h('span', { class: 'l' }, l), h('span', { class: 'v' }, v), h('span', { class: 's' }, sub));
  return h('div', { class: 'ob-hub-impl', 'aria-live': 'polite' },
    h('div', { class: 'col tight' }, h('h3', null, t('ob.s2.baseAt', { city: s.city.split(',')[0]!.trim() })), h('span', { class: 'dim' }, t('ob.s2.implies'))),
    h('div', { class: 'col', style: 'gap:20px' },
      fact(t('ob.s2.parking'), t('ob.s2.parkingV', { price: fmt().money(s.parkingMonthly) }), t('ob.s2.parkingS')),
      fact(t('ob.s2.jobs'), tp('ob.s2.jobsV', s.jobsNearby), t('ob.s2.jobsS')),
      fact(t('ob.s2.rivals'), tp('ob.s2.rivalsV', s.aiCompaniesBased), t('ob.s2.rivalsS', { icao: s.icao }))));
}

type CodeState = 'idle' | 'checking' | 'free' | 'taken' | 'unknown';

export async function step2(w: Wizard): Promise<StepResult> {
  const mode = w.startMode();
  const f = w.form;
  const me = w.ob.companyId !== null ? await w.loadMe(true) : null;
  const locked = me !== null;
  if (me) {
    f.name = me.company.name; f.code = me.company.code ?? f.code; f.callsign = me.company.callsign ?? f.callsign;
    f.color = me.company.liveryColor ?? f.color; f.hub = me.hubs[0] ?? f.hub;
  }
  const error = h('p', { class: 'ob-error', role: 'alert' });

  // ---- company panel
  const name = inputField({ label: t('ob.s2.name'), icon: 'building-2', hint: t('ob.s2.nameHint') },
    { type: 'text', name: 'company-name', required: true, minlength: 2, maxlength: 40, autocomplete: 'off', value: f.name, disabled: locked });
  const state = h('span', { class: 'ob-field-state' });
  const codeField = inputField({ label: t('ob.s2.code'), icon: 'hash', trailing: state, hint: t('ob.s2.codeHint') },
    { type: 'text', name: 'airline-code', maxlength: 3, autocomplete: 'off', spellcheck: 'false', required: true, value: f.code, disabled: locked, class: 'upper' });
  const codeHint = codeField.root.querySelector('small')!;
  const callField = inputField({ label: t('ob.s2.callsign'), icon: 'radio', hint: t('ob.s2.callsignHintEmpty') },
    { type: 'text', name: 'callsign', maxlength: 12, autocomplete: 'off', spellcheck: 'false', required: true, value: f.callsign, disabled: locked, class: 'upper' });
  const callHint = callField.root.querySelector('small')!;
  let codeState: CodeState = 'idle';
  let checkId = 0;
  const paintCode = (): void => {
    const map: Record<CodeState, [string, string, string]> = {
      idle: [t('ob.s2.codeHint'), '', ''], checking: [t('ob.s2.codeChecking'), '', ''], free: [t('ob.s2.codeFree'), 'ob-hint-ok', 'ok'],
      taken: [t('ob.s2.codeTaken'), 'ob-hint-bad', 'bad'], unknown: [t('ob.s2.codeUnknown'), '', ''],
    };
    const [text, cls, st] = map[codeState];
    codeHint.textContent = text;
    codeHint.className = cls;
    codeHint.setAttribute('aria-live', 'polite');
    state.className = `ob-field-state ${st}`.trim();
    state.replaceChildren(...(st === 'ok' ? [icon('circle-check', 16)] : st === 'bad' ? [icon('circle-x', 16)] : []));
  };
  const check = debounce(async () => {
    const code = f.code;
    if (!isValidCode(code)) { codeState = 'idle'; paintCode(); return; }
    const id = ++checkId;
    codeState = 'checking'; paintCode();
    let next: CodeState;
    try { next = (await codeAvailable(code)) ? 'free' : 'taken'; } catch { next = 'unknown'; }
    if (id === checkId) { codeState = next; paintCode(); }
  }, 300);
  const paintCall = (): void => { callHint.textContent = f.callsign ? t('ob.s2.callsignHint', { call: f.callsign }) : t('ob.s2.callsignHintEmpty'); };
  const sync = (): void => { codeField.control.value = f.code; callField.control.value = f.callsign; };
  name.control.addEventListener('input', () => {
    f.name = name.control.value;
    if (!f.codeEdited) { f.code = suggestCode(f.name); codeField.control.value = f.code; check(); }
    if (!f.callsignEdited) { f.callsign = suggestCallsign(f.name); callField.control.value = f.callsign; paintCall(); }
  });
  codeField.control.addEventListener('input', () => { f.codeEdited = true; f.code = normalizeCode(codeField.control.value); codeField.control.value = f.code; check(); });
  callField.control.addEventListener('input', () => { f.callsignEdited = true; f.callsign = normalizeCallsign(callField.control.value); callField.control.value = f.callsign; paintCall(); });
  sync(); paintCall();
  if (locked) { codeState = 'idle'; codeHint.textContent = ''; } else { check(); paintCode(); }

  const swatchName = h('span', { class: 'ob-swatch-name' });
  const paintSwatch = (): void => {
    const id = liveryIdOf(f.color);
    swatchName.textContent = id ? tk(`ob.s2.color.${id}`) : t('ob.s2.color.none');
  };
  const swatch = (value: string | null, id: string, hex: string | null): HTMLElement => {
    const input = h('input', { type: 'radio', name: 'livery', value: value ?? '', checked: f.color?.toLowerCase() === (value ?? '').toLowerCase() && value !== null || (value === null && f.color === null), disabled: locked, 'aria-label': tk(`ob.s2.color.${id}`) });
    input.addEventListener('change', () => { f.color = value; paintSwatch(); });
    return h('label', { class: `ob-swatch${hex ? '' : ' none'}`, style: hex ? `background:${hex}` : null }, input, icon(hex ? 'check' : 'ban', 14));
  };
  const livery = h('fieldset', { class: 'ob-livery' },
    h('legend', null, t('ob.s2.livery'), ' ', h('span', null, t('ob.s2.optional'))),
    h('div', { class: 'ob-swatches' }, swatch(null, 'none', null), LIVERY_COLORS.map((c) => swatch(c.hex, c.id, c.hex)), swatchName),
    h('small', { class: 'dim' }, t('ob.s2.liveryHint')));
  paintSwatch();
  const companyPanel = panel({ title: t('ob.s2.panel'), id: 'ob-company', class: 'ob-form' },
    name.root,
    h('div', { class: 'ob-codes' }, codeField.root, callField.root),
    h('div', { class: 'ob-final' }, icon('info', 14), t('ob.s2.final')),
    livery);

  // ---- hub panel
  const list = h('div', { class: 'ob-sugg', role: 'radiogroup', 'aria-label': t('ob.s2.hubList') });
  const impl = h('div');
  const search = inputField({ label: t('ob.s2.search'), icon: 'search' }, { type: 'search', name: 'hub-search', placeholder: t('ob.s2.searchPh'), autocomplete: 'off', value: f.hubQuery, disabled: locked });
  const headLeft = h('span');
  const headRight = h('span');
  let results: HubSuggestion[] = [];
  let chosen: HubSuggestion | null = null;
  let hubError = false;
  const row = (s: HubSuggestion): HTMLElement => {
    const input = h('input', { type: 'radio', name: 'hub', value: s.icao, checked: s.icao === f.hub, disabled: locked && s.icao !== f.hub, 'aria-label': `${s.icao} ${s.name}` });
    input.addEventListener('change', () => { f.hub = s.icao; chosen = s; impl.replaceChildren(implications(s)); });
    return h('label', { class: 'ob-airport' }, input,
      h('span', { class: 'sign location' }, s.icao),
      h('span', { class: 'names' }, h('b', null, s.name), h('small', null, `${s.city.split(',')[0]!.trim()} · ${t(sizeKey[s.size])}`)),
      h('span', { class: 'why' }, noteOf(s)), icon('check', 16));
  };
  const paintList = (searching: boolean): void => {
    headLeft.textContent = searching ? t('ob.s2.results') : t(mode === 'airliner' ? 'ob.s2.suggAirliner' : 'ob.s2.suggHardcore');
    headRight.textContent = t(sizeKey[START_FACTS[mode].hubSize]);
    let shown = results;
    if (chosen && !shown.some((s) => s.icao === chosen!.icao)) shown = [chosen, ...shown];
    if (shown.length === 0) list.replaceChildren(h('p', { class: 'dim' }, hubError ? t('ob.s2.hubsFailed') : t(searching ? 'ob.s2.noResults' : 'ob.s2.hubsFailed')));
    else list.replaceChildren(...shown.map(row));
    impl.replaceChildren(implications(chosen));
  };
  const load = async (q: string): Promise<void> => {
    try {
      hubError = false;
      results = locked ? [] : await hubSuggestions(mode, q);
    } catch { results = []; hubError = true; }
    if (f.hub) chosen = results.find((s) => s.icao === f.hub) ?? chosen;
    if (!chosen && f.hub) {
      try { chosen = (await hubSuggestions(mode, f.hub)).find((s) => s.icao === f.hub) ?? null; } catch { /* the hub just stays unexplained */ }
    }
    if (!chosen && !q && !locked && results[0]) { chosen = results[0]; f.hub = results[0].icao; }
    paintList(q.trim() !== '');
  };
  if (locked) {
    // Final: the company's hub, explained as it was suggested.
    void load('');
  } else {
    void load(f.hubQuery);
    search.control.addEventListener('input', debounce(() => { f.hubQuery = search.control.value; void load(f.hubQuery); }, 250));
  }
  const hubPanel = panel({ title: t('ob.s2.hub'), id: 'ob-hub', class: 'ob-hub' },
    h('div', { class: 'ob-hub-search' }, search.root,
      h('div', { class: 'col', style: 'gap:4px;min-height:0;flex:1' }, h('div', { class: 'ob-sugg-head' }, headLeft, headRight), list)),
    h('div', { class: 'ob-hub-divider', 'aria-hidden': 'true' }), impl);
  paintList(false);

  // ---- continue
  const proceed = async (): Promise<void> => {
    if (!locked) {
      if (!isValidName(f.name) || !isValidCode(f.code) || !isValidCallsign(f.callsign) || !f.hub) throw new Error(t('ob.s2.missing'));
      const created = await createOnboardingCompany({ name: f.name.trim(), hub: f.hub, code: f.code, callsign: f.callsign, ...(f.color ? { liveryColor: f.color.toUpperCase() } : {}), startMode: mode });
      session.company = created.company.id;
      w.me = created;
      w.ob.companyId = created.company.id;
    }
    w.go(3);
  };
  const cont = button(t(mode === 'airliner' ? 'ob.s2.continue' : 'ob.s2.continueHardcore'), { variant: 'primary', key: t('key.enter'), onclick: (e) => void guarded(e.currentTarget as HTMLButtonElement, error, proceed).then(() => undefined) });
  const guardMsg = async (b: HTMLButtonElement): Promise<void> => guarded(b, error, proceed);
  cont.onclick = (e) => void guardMsg(e.currentTarget as HTMLButtonElement);
  const form = h('form', { class: 'ob-page', novalidate: true, onsubmit: (e: Event) => { e.preventDefault(); void guardMsg(cont); } },
    titleArea(t(mode === 'airliner' ? 'ob.s2.overAirliner' : 'ob.s2.overHardcore'), t('ob.s2.title'), t('ob.s2.sub')),
    h('div', { class: 'ob-main' }, companyPanel, hubPanel),
    h('div', { class: 'ob-foot' }, h('div', { class: 'ob-foot-left' }, h('span', { class: 'ob-note' }, locked ? t('ob.s2.created') : t('ob.s2.more')), error), cont));
  return {
    scene: 'catalogue', view: form, back: () => w.prev(),
    hints: hintsOf([t('key.esc'), t('ob.hint.prevStep')], [t('key.tab'), t('ob.hint.nextField')], [t('key.enter'), t('ob.hint.continue')]),
  };
}

export { otherMode };
