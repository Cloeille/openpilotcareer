import type { Me } from '@opc/shared';
import { brandBlock, icon, keycap } from './components.ts';
import { fmt } from './format.ts';
import { t, tp } from './i18n.ts';
import { PRODUCT_NAME } from './brand.ts';
import { rankProgress } from './pilot.ts';
import { TABS, type Hint, type Tab } from './screen.ts';
import { h } from './ui.ts';
import { session, GLOBAL_URL } from './api.ts';

export type HudData = { me: Me; tab: Tab | 'settings' | null; antiCheat: boolean; offline?: boolean; jobCount: number; onCompany: (id: number) => void; onChangeServer: () => void };

const RING_R = 18;
function rankRing(fraction: number, label: string): HTMLElement {
  const c = 2 * Math.PI * RING_R;
  const circle = (cls: string, extra: Record<string, string>): SVGElement => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [k, v] of Object.entries({ cx: '20', cy: '20', r: String(RING_R), fill: 'none', 'stroke-width': '3', class: cls, ...extra })) el.setAttribute(k, v);
    return el;
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('aria-hidden', 'true');
  svg.append(circle('track', {}), circle('progress', { 'stroke-dasharray': `${c * fraction} ${c}`, 'stroke-linecap': 'round' }));
  return h('div', { class: 'rank-ring' }, svg, h('span', null, label));
}

const resource = (label: string, value: Node | string, iconEl?: Node): HTMLElement =>
  h('div', { class: 'resource' }, h('span', { class: 'resource-label' }, label), h('span', { class: 'resource-value' }, iconEl ?? null, value));

function serverName(): string {
  return session.server === GLOBAL_URL ? t('hud.globalServer') : new URL(session.server).host;
}

export function hudTop(d: HudData): HTMLElement {
  const { me } = d;
  const f = fmt();
  const prog = rankProgress(me.pilot);
  const switcher = h('select', {
    id: 'company-switch', class: 'company-switch', name: 'company', disabled: d.offline,
    onchange: (e: Event) => d.onCompany(Number((e.target as HTMLSelectElement).value)),
  }, me.companies.map((c) => h('option', { value: c.id, selected: c.id === me.company.id }, c.name)));
  const tabLink = (tab: Tab): HTMLElement => h('a', { href: `#${tab}`, 'aria-current': tab === d.tab ? 'page' : null }, t(`tab.${tab}`), tab === 'jobs' ? h('span', { class: 'tab-count' }, d.jobCount) : null);
  return h('header', { class: 'hud-top' },
    brandBlock(PRODUCT_NAME, h('div', { class: 'server-line' + (d.offline ? ' off' : '') },
      h('span', { class: d.offline ? 'dot off' : 'dot' }), d.offline ? t('offline.server', { server: serverName() }) : serverName(), h('span', { class: 'dim', 'aria-hidden': 'true' }, '·'),
      h('button', { type: 'button', class: 'link-btn', title: t('hud.changeHint'), onclick: d.onChangeServer }, t('hud.change')))),
    h('nav', { class: 'hud-tabs', 'aria-label': t('nav.main') },
      h('span', { title: t('hud.prevTab') }, keycap('Q')), TABS.map(tabLink), h('span', { title: t('hud.nextTab') }, keycap('E'))),
    h('div', { class: 'resources' },
      h('div', { class: 'resource' }, h('label', { class: 'resource-label', for: 'company-switch' }, t('hud.company')), switcher),
      resource(t('hud.balance'), f.money(me.company.balance), icon('wallet', 13)),
      resource(t('hud.reputation'), `${f.num(me.company.reputation, 1)} / 100`, icon('star', 13)),
      h('span', { class: 'res-divider' }),
      h('div', { class: 'pilot' },
        rankRing(prog.fraction, `R${prog.index + 1}`),
        h('div', { class: 'pilot-stack' },
          h('span', { class: 'pilot-name' }, me.username),
          h('span', { class: 'pilot-sub' }, t('hud.rank', { n: prog.index + 1, pct: f.percent(prog.fraction) })))),
      h('a', { class: 'icon-btn', href: '#settings', 'aria-label': t('hud.settings'), 'aria-current': d.tab === 'settings' ? 'page' : null }, icon('settings', 18))));
}

export function hudBottom(hints: Hint[], antiCheat: boolean, now = Date.now()): HTMLElement {
  const { month, daysLeft } = fmt().season(now);
  return h('footer', { class: 'hud-bottom' },
    h('div', { class: 'hud-status' },
      antiCheat ? null : h('span', { title: t('hud.antiCheatOffHint') }, icon('shield-x', 14), t('hud.antiCheatOff')),
      h('span', null, icon('calendar-clock', 14), t('hud.season', { month }), h('span', { class: 'dim' }, daysLeft === 0 ? t('hud.lastDay') : tp('hud.daysLeft', daysLeft)))),
    h('div', { class: 'hints' }, hints.map((x) => h('span', { class: 'hint' }, keycap(x.key), x.label))));
}
