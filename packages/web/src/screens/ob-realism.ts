import { icon, button, panel, switchControl, titleBlock } from '../components.ts';
import { t } from '../i18n.ts';
import {
  PRESETS, PRESET_TOGGLES, activeToggles, modifiersOf, presetRealism, signedPct, withToggle, START_FACTS, ENFORCED_DEFAULT, TOGGLE_FX,
} from '../onboarding-model.ts';
import { REALISM_TOGGLES, type Realism, type RealismPreset, type RealismToggle, type StartMode } from '../onboarding-types.ts';
import { getMe, setRealism } from '../api-onboarding.ts';
import { arrows, guarded, hintsOf, obError, titleArea, tk, type StepResult, type Wizard } from '../onboarding-shell.ts';
import type { Ctx, Screen } from '../screen.ts';
import { h } from '../ui.ts';
import type { Key } from '../messages.ts';

type RealismEditor = {
  body: HTMLElement;
  /** The realism as shown now (kept in sync with what the server confirmed). */
  current: () => Realism;
  error: HTMLElement;
};

const presetName = (p: Realism['preset']): string => t(`ob.s4.${p}` as Key);

/** The shared part of step 4 and the `#realism` screen: three presets, six switches, modifiers that follow. Every change is sent to the server and the answer is what is shown. */
function realismEditor(companyId: number, initial: Realism, o: { suggested: RealismPreset | null; startOnCustom: boolean; onChange: (r: Realism) => void; compactTitle?: boolean }): RealismEditor {
  let cur: Realism = { ...initial, enforced: { ...ENFORCED_DEFAULT, ...initial.enforced } };
  const error = h('p', { class: 'ob-error', role: 'alert' });
  const settingsPanel = h('div');
  const cards = h('div', { class: 'ob-presets', role: 'radiogroup', 'aria-label': t('ob.s4.group') });
  let seq = 0;

  const send = async (body: Parameters<typeof setRealism>[1], optimistic: Realism): Promise<void> => {
    const before = cur;
    const id = ++seq;
    cur = optimistic; paint();
    try {
      const real = await setRealism(companyId, body);
      if (id === seq) { cur = { ...real, enforced: { ...ENFORCED_DEFAULT, ...real.enforced } }; error.textContent = ''; }
    } catch (e) {
      if (id === seq) { cur = before; error.textContent = `${t('ob.s4.saveFailed')} ${obError(e)}`; }
    }
    paint();
    o.onChange(cur);
  };

  const presetCard = (p: RealismPreset): HTMLElement => {
    const m = modifiersOf(PRESET_TOGGLES[p]);
    const input = h('input', { type: 'radio', name: 'preset', class: 'ob-radio', value: p, checked: cur.preset === p, 'aria-describedby': `preset-${p}-d` });
    input.addEventListener('change', () => void send({ preset: p }, presetRealism(p, cur.enforced)));
    return h('label', { class: 'ob-card ob-preset' }, input,
      h('div', { class: 'ob-preset-text' },
        h('div', { class: 'ob-preset-name' }, h('b', null, presetName(p)),
          h('span', { class: 'ob-sel' }, icon('check', 13), t('ob.selected')),
          o.suggested === p ? h('span', { class: 'ob-tag' }, t('ob.s4.suggested')) : null),
        h('p', { class: 'ob-preset-desc', id: `preset-${p}-d` }, t(`ob.s4.${p}Desc` as Key))),
      h('div', { class: 'ob-impact' }, h('div', null, t('ob.s4.pay'), h('b', null, signedPct(m.pay))), h('div', null, t('ob.s4.rep'), h('b', null, signedPct(m.rep)))));
  };

  const settingRow = (k: RealismToggle): HTMLElement => {
    const on = cur.toggles[k];
    const fx = TOGGLE_FX[k];
    const lines = [fx.pay !== 0 ? t('ob.s4.pctPay', { pct: signedPct(fx.pay) }) : null, fx.rep !== 0 ? t('ob.s4.pctRep', { pct: signedPct(fx.rep) }) : null].filter((x): x is string => x !== null);
    const sw = switchControl({ checked: on, labelledBy: `rz-${k}-t`, describedBy: `rz-${k}-d`, id: `rz-${k}`, onchange: (v) => void send({ toggles: { [k]: v } }, withToggle(cur, k, v)) });
    return h('div', { class: `ob-setting${on ? '' : ' off'}` },
      h('div', { class: 'ob-setting-text' }, h('b', { id: `rz-${k}-t` }, tk(`ob.s4.t.${k}`)), h('small', { id: `rz-${k}-d` }, tk(`ob.s4.d.${k}`)),
        cur.enforced[k] ? null : h('span', { class: 'pending' }, icon('circle-dashed', 12), t('ob.s4.notApplied'))),
      h('div', { class: 'ob-setting-fx' }, lines.map((l) => h('span', null, l))), sw);
  };

  const paint = (): void => {
    cards.replaceChildren(...PRESETS.map(presetCard));
    const custom = cur.preset === 'custom';
    settingsPanel.replaceChildren(panel({
      title: custom ? t('ob.s4.panelCustom') : t('ob.s4.panel', { preset: presetName(cur.preset) }),
      action: t('ob.s4.count', { n: activeToggles(cur) }), class: 'ob-settings', id: 'ob-settings',
    }, REALISM_TOGGLES.map(settingRow)));
  };
  paint();
  const body = h('div', { class: 'ob-main' },
    h('div', { class: 'ob-left-col' }, o.compactTitle ? null : h('div', { id: 'ob-title-slot' }), cards,
      h('div', { class: 'ob-bonus' }, icon('trending-up', 16), h('p', null, t('ob.s4.bonus')))),
    settingsPanel);
  return {
    body, current: () => cur, error,
  };
}

// ------------------------------------------------------------------ step 4

export async function step4(w: Wizard): Promise<StepResult> {
  const me = await w.loadMe(true);
  const mode: StartMode = w.startMode();
  const suggested = START_FACTS[mode].preset;
  const initial = me.company.realism ?? presetRealism(suggested);
  const err = h('p', { class: 'ob-error', role: 'alert' });
  const ed = realismEditor(me.company.id, initial, { suggested, startOnCustom: w.wantsCustom, onChange: () => paintBtn() });
  const btnHost = h('div');
  const paintBtn = (): void => {
    const r = ed.current();
    btnHost.replaceChildren(button(r.preset === 'custom' ? t('ob.s4.continueCustom') : t('ob.s4.continue', { preset: presetName(r.preset) }), { variant: 'primary', key: t('key.enter'), onclick: () => w.next() }));
  };
  paintBtn();
  const view = h('div', { class: 'ob-page' },
    h('div', { class: 'ob-main', style: 'flex:1' }, ed.body),
    h('div', { class: 'ob-foot' }, h('div', { class: 'ob-foot-left' }, h('span', { class: 'ob-note' }, t('ob.s4.note')), ed.error, err), btnHost));
  // The title block belongs to the left column (frame 4): move it into place.
  const slot = view.querySelector('#ob-title-slot')!;
  slot.replaceWith(titleArea(t(mode === 'airliner' ? 'ob.s4.startAirliner' : 'ob.s4.startHardcore'), t('ob.s4.title'), t('ob.s4.sub')));
  view.querySelector<HTMLElement>('.ob-main')!.style.alignItems = 'flex-start';
  if (w.wantsCustom) queueMicrotask(() => document.getElementById('rz-wearAndFailures')?.focus());
  return {
    scene: 'settings', view, back: () => w.prev(), keys: { },
    hints: hintsOf([t('key.esc'), t('ob.hint.prevStep')], [arrows('ud'), t('ob.hint.changePreset')], [t('key.space'), t('ob.hint.toggle')], [t('key.enter'), t('ob.hint.continue')]),
  };
}

// ------------------------------------------------------------------ #realism: the same panel, for later changes

export async function realism(ctx: Ctx): Promise<Screen> {
  const me = await getMe().catch(() => null);
  const company = me?.company ?? ctx.snap.me.company;
  const initial = (me?.company.realism) ?? presetRealism('balanced');
  const ed = realismEditor(company.id, initial, { suggested: null, startOnCustom: false, onChange: () => undefined, compactTitle: true });
  const view = h('div', { class: 'ob-page', style: 'justify-content:flex-start;gap:28px' },
    titleBlock(t('ob.rz.status', { company: company.name }), t('ob.rz.title')),
    ed.body,
    h('div', { class: 'ob-foot' }, h('div', { class: 'ob-foot-left' }, h('span', { class: 'ob-note' }, `${t('ob.rz.note')} ${t('ob.s4.note')}`), ed.error)));
  view.querySelector<HTMLElement>('.ob-main')!.style.alignItems = 'flex-start';
  return {
    title: t('ob.rz.title'), scene: 'settings', tab: 'settings', back: '#settings', wide: true, view,
    hints: [{ key: t('key.esc'), label: t('hint.back') }, { key: t('key.space'), label: t('ob.hint.toggle') }],
  };
}

