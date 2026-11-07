import { h } from '../ui.ts';
import { svg } from '../svg.ts';
import { icon } from '../components.ts';
import { fmt } from '../format.ts';
import { t, tp } from '../i18n.ts';
import { DIAL_MAX, DIAL_REDLINE, arcDash, fuelVm, ringDash, wearLevel, type Body, type CheckId, type EngineVm, type LiveCtx, type LiveFacts } from '../live-view.ts';

const DIAL_R = 76;
const RING_R = 35;
const TANK_H = 160;

const group = (title: string, sub: string, ...body: (Node | null)[]): HTMLElement => h('div', { class: 'sys-group' }, h('div', { class: 'sys-group-head' }, h('h2', { class: 'sys-group-title' }, title), h('span', { class: 'dim small' }, sub)), ...body);
const readout = (label: string, value: string): HTMLElement => h('div', { class: 'readout' }, h('span', { class: 'readout-label' }, label), h('span', { class: 'readout-value' }, value));
const CHECK_ICON = { ok: 'circle-check', flagged: 'circle-alert', unknown: 'circle-dashed' } as const;

function dial(e: EngineVm): HTMLElement {
  const fm = fmt();
  const value = e.dial?.value ?? null;
  const arc = (from: number, to: number, cls: string): SVGElement => {
    const d = arcDash(DIAL_R, from, to);
    return svg('circle', { cx: 80, cy: 80, r: DIAL_R, fill: 'none', 'stroke-width': 6, 'stroke-linecap': 'round', class: cls, 'stroke-dasharray': d.dasharray, 'stroke-dashoffset': d.dashoffset, transform: 'rotate(135 80 80)' });
  };
  const gauge = svg('svg', { viewBox: '0 0 160 160', width: 160, height: 160, 'aria-hidden': 'true' },
    arc(0, DIAL_MAX, 'dial-track'), arc(DIAL_REDLINE, DIAL_MAX, 'dial-redline'), value === null ? null : arc(0, Math.min(value, DIAL_REDLINE), 'dial-value'));
  return h('div', { class: 'engine' },
    h('div', { class: 'dial', role: 'img', 'aria-label': `${t('live.sys.engine', { n: e.index + 1 })}: ${value === null ? '–' : fm.num(value, 1)} ${e.dial?.unit === 'n1' ? t('live.sys.unitN1') : t('live.sys.unitTorque')}` },
      gauge, h('div', { class: 'dial-center' }, h('span', { class: 'dial-num' }, value === null ? '–' : fm.num(value, 1)), h('span', { class: 'dial-unit' }, e.dial?.unit === 'n1' ? t('live.sys.unitN1') : t('live.sys.unitTorque')))),
    h('span', { class: 'engine-name' }, t('live.sys.engine', { n: e.index + 1 })),
    h('div', { class: 'readouts' },
      e.dial?.unit === 'torque' ? readout(t('live.sys.n1'), e.n1Pct === null ? '–' : fm.percent(e.n1Pct / 100)) : null,
      readout(t('live.sys.itt'), e.ittC === null ? '–' : `${fm.num(e.ittC)} °C`),
      readout(t('live.sys.oil'), e.oilPsi === null ? '–' : `${fm.num(e.oilPsi)} psi`)));
}

function ring(label: string, pct: number): HTMLElement {
  const level = wearLevel(pct);
  const draw = (cls: string, dash?: string): SVGElement => svg('circle', { cx: 39, cy: 39, r: RING_R, fill: 'none', 'stroke-width': 4, class: cls, 'stroke-dasharray': dash ?? null, transform: 'rotate(-90 39 39)' });
  return h('div', { class: `wear wear-${level}`, role: 'img', 'aria-label': `${label} ${fmt().num(pct)} %` },
    h('div', { class: 'ring' }, svg('svg', { viewBox: '0 0 78 78', width: 78, height: 78, 'aria-hidden': 'true' }, draw('ring-track'), draw('ring-value', ringDash(RING_R, pct))), h('span', { class: 'ring-num' }, `${fmt().num(pct)} %`)),
    h('span', { class: 'wear-part' }, label));
}

/** Systèmes: engines from the live samples, fuel (a single total: the stream has no tank split), the simulator's own state, wear from the fleet record, and the anti-cheat checks. */
export function systemsBody(c: LiveCtx): Body {
  const fm = fmt();
  const enginesBox = h('div', { class: 'engine-dials' });
  const fuelBox = h('div', { class: 'fuel-gauges' });
  const simBox = h('div', { class: 'sim-values' });
  const checksBox = h('div', { class: 'checks' });

  const update = (f: LiveFacts): void => {
    enginesBox.replaceChildren(...(f.engines.length > 0 ? f.engines.map(dial) : [h('p', { class: 'dim small' }, t('live.sys.noEngine'))]));

    if (f.fuelKg === null) fuelBox.replaceChildren(h('p', { class: 'dim small' }, '–'));
    else {
      const v = fuelVm(c.type, f.fuelKg, f.gsKts, f.remainingNm);
      fuelBox.replaceChildren(
        h('div', { class: 'tank' }, h('div', { class: 'tank-body', style: `height:${TANK_H}px`, role: 'img', 'aria-label': `${t('live.sys.tank')} ${fm.kg(v.onBoardKg)}` }, h('div', { class: 'tank-level', style: `height:${Math.max(2, Math.round(v.fraction * (TANK_H - 8)))}px` })), h('span', { class: 'dim small' }, t('live.sys.tank'))),
        h('div', { class: 'fuel-total' },
          h('span', { class: 'live-fact-label' }, t('live.sys.onBoard')), h('span', { class: 'fuel-big' }, fm.kg(v.onBoardKg)),
          v.enduranceH === null ? null : h('span', { class: 'muted' }, t('live.sys.endurance', { time: fm.duration(v.enduranceH) })),
          v.arrivalKg === null ? null : h('span', { class: 'dim small' }, t('live.sys.arrival', { kg: fm.kg(v.arrivalKg) }))));
    }

    const s = f.sample;
    const row = (label: string, value: string): HTMLElement => h('div', { class: 'sim-row' }, h('span', { class: 'dim small' }, label), h('span', { class: 'sim-val' }, value));
    simBox.replaceChildren(s === null ? h('p', { class: 'dim small' }, t('live.verif.waiting')) : h('div', { class: 'sim-grid' },
      row(t('live.sys.heading'), `${Math.round(s.headingDeg)}°`), row(t('live.sys.vs'), t('live.sys.fpm', { n: fm.num(Math.round(s.vsFpm)) })),
      row(t('live.sys.rate'), `${fm.num(s.simRate, 2)}×`), row(t('live.sys.state'), s.paused ? t('live.sys.paused') : t('live.sys.running'))));

    checksBox.replaceChildren(h('span', { class: 'checks-label' }, t('live.sys.checks')), ...f.checks.map((k) => {
      const name = k.id === 'other' ? k.raw ?? '' : t(`live.check.${k.id satisfies CheckId}`);
      return h('span', { class: `check ${k.state}` }, icon(CHECK_ICON[k.state], 15), name, h('span', { class: 'sr' }, ` (${t(`live.check.${k.state}`)})`));
    }));
  };

  const wear = c.wearPct;
  const wearBox = wear === null
    ? h('p', { class: 'dim small' }, t('live.sys.wearNone'))
    : h('div', { class: 'wear-rings' }, ring(t('live.sys.wearAircraft'), wear));

  const el = h('div', { class: 'systems-view' },
    h('div', { class: 'sys-body panel' },
      h('div', { class: 'sys-row' },
        group(t('live.sys.engines'), tp('live.sys.enginesSub', c.type.engines, { type: c.type.name }), enginesBox),
        group(t('live.sys.fuel'), t('live.sys.fuelSub'), fuelBox)),
      h('div', { class: 'sys-row condition' },
        group(t('live.sys.sim'), t('live.sys.simSub'), simBox),
        group(t('live.sys.wear'), t('live.sys.wearSub'), wearBox))),
    checksBox);
  return { el, update };
}
