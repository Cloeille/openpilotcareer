import type { Me } from '@opc/shared';
import { brandBlock, icon, keycap } from './components.ts';
import { fmt } from './format.ts';
import { getLang, t, tp, type Lang } from './i18n.ts';
import { COUNT_MS, countValue, motionOK } from './motion.ts';
import { PRODUCT_NAME } from './brand.ts';
import { rankProgress } from './pilot.ts';
import { TABS, type Hint, type Tab } from './screen.ts';
import { h } from './ui.ts';
import { session, GLOBAL_URL } from './api.ts';

export type HudData = { me: Me; tab: Tab | 'settings' | null; antiCheat: boolean; offline?: boolean; jobCount: number; onCompany: (id: number) => void; onChangeServer: () => void };

/** The two HUD bars. They are built once and then updated in place, so changing screen never rebuilds (and never repaints) them. */
export type Hud = { readonly top: HTMLElement; readonly bottom: HTMLElement; update: (d: HudData, hints: Hint[]) => void; /** Forget the bars (signed out): the next update builds them fresh, so figures never count up from another account's. */ reset: () => void };

const RING_R = 18;
const NEW_COMPANY = 'new';

const svgCircle = (cls: string, extra: Record<string, string>): SVGElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [k, v] of Object.entries({ cx: '20', cy: '20', r: String(RING_R), fill: 'none', 'stroke-width': '3', class: cls, ...extra })) el.setAttribute(k, v);
  return el;
};

const ringDash = (fraction: number): string => {
  const c = 2 * Math.PI * RING_R;
  return `${c * fraction} ${c}`;
};

function serverName(): string {
  return session.server === GLOBAL_URL ? t('hud.globalServer') : new URL(session.server).host;
}

/** A text node whose figure counts up (or down) to each new value instead of jumping; the final text is always exactly the target. */
function counter(format: (n: number) => string): { node: Text; set: (to: number) => void } {
  const node = document.createTextNode('');
  let shown: number | null = null;
  let frame = 0;
  const set = (to: number): void => {
    cancelAnimationFrame(frame);
    const from = shown ?? to;
    if (from === to || !motionOK()) { shown = to; node.data = format(to); return; }
    const start = performance.now();
    const step = (now: number): void => {
      const elapsed = now - start;
      shown = countValue(from, to, elapsed);
      node.data = format(shown);
      if (elapsed < COUNT_MS) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };
  return { node, set };
}

function build(initial: HudData, lang: Lang) {
  let latest = initial;
  const f = fmt();
  const balance = counter((n) => f.money(Math.round(n)));
  const reputation = counter((n) => `${f.num(n, 1)} / 100`);

  const switcher = h('select', {
    id: 'company-switch', class: 'company-switch', name: 'company',
    onchange: (e: Event) => {
      const el = e.target as HTMLSelectElement;
      if (el.value === NEW_COMPANY) { el.value = String(latest.me.company.id); location.hash = '#company'; } else latest.onCompany(Number(el.value));
    },
  });
  const serverDot = h('span', { class: 'dot' });
  const serverText = document.createTextNode('');
  const serverLine = h('div', { class: 'server-line' }, serverDot, serverText, h('span', { class: 'dim', 'aria-hidden': 'true' }, '·'),
    h('button', { type: 'button', class: 'link-btn', title: t('hud.changeHint'), onclick: () => latest.onChangeServer() }, t('hud.change')));

  const jobCount = h('span', { class: 'tab-count' });
  const liveDot = h('span', { class: 'dot route', role: 'img', 'aria-label': t('live.hud.active'), hidden: true });
  const tabExtra = (tab: Tab): Node | null => (tab === 'jobs' ? jobCount : tab === 'live' ? liveDot : null);
  const tabLinks = new Map<Tab, HTMLAnchorElement>(TABS.map((tab) => [tab, h('a', { href: `#${tab}` }, t(`tab.${tab}`), tabExtra(tab))]));
  const underline = h('span', { class: 'tab-underline', 'aria-hidden': 'true' });
  const nav = h('nav', { class: 'hud-tabs', 'aria-label': t('nav.main') },
    h('span', { title: t('hud.prevTab') }, keycap('Q')), [...tabLinks.values()], h('span', { title: t('hud.nextTab') }, keycap('E')), underline);

  const ringProgress = svgCircle('progress', { 'stroke-dasharray': ringDash(0), 'stroke-linecap': 'round' });
  const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ringSvg.setAttribute('viewBox', '0 0 40 40');
  ringSvg.setAttribute('aria-hidden', 'true');
  ringSvg.append(svgCircle('track', {}), ringProgress);
  const ringLabel = h('span');
  const pilotName = h('span', { class: 'pilot-name' });
  const pilotSub = h('span', { class: 'pilot-sub' });
  const settings = h('a', { class: 'icon-btn', href: '#settings', 'aria-label': t('hud.settings') }, icon('settings', 18));
  const resource = (label: string, value: Text, iconEl: Node): HTMLElement =>
    h('div', { class: 'resource' }, h('span', { class: 'resource-label' }, label), h('span', { class: 'resource-value' }, iconEl, value));

  const top = h('header', { class: 'hud-top' },
    brandBlock(PRODUCT_NAME, serverLine),
    nav,
    h('div', { class: 'resources' },
      h('div', { class: 'resource' }, h('label', { class: 'resource-label', for: 'company-switch' }, t('hud.company')), switcher),
      resource(t('hud.balance'), balance.node, icon('wallet', 13)),
      resource(t('hud.reputation'), reputation.node, icon('star', 13)),
      h('span', { class: 'res-divider' }),
      h('div', { class: 'pilot' }, h('div', { class: 'rank-ring' }, ringSvg, ringLabel), h('div', { class: 'pilot-stack' }, pilotName, pilotSub)),
      settings));

  const status = h('div', { class: 'hud-status' });
  const hintsEl = h('div', { class: 'hints' });
  const bottom = h('footer', { class: 'hud-bottom' }, status, hintsEl);

  // The underline is one element that slides to the active tab. It can only be measured once the bar is on screen, so a ResizeObserver also places it after mounting, fonts loading or a language change (without animating those).
  const place = (animate: boolean): void => {
    const active = [...tabLinks.values()].find((a) => a.getAttribute('aria-current') === 'page');
    underline.classList.toggle('off', !active);
    if (!active || active.offsetWidth === 0) return;
    if (!animate) underline.style.transition = 'none';
    underline.style.transform = `translateX(${active.offsetLeft}px) scaleX(${active.offsetWidth})`;
    if (!animate) { void underline.offsetWidth; underline.style.transition = ''; }
  };
  new ResizeObserver(() => place(false)).observe(nav);

  const keys = { companies: '', status: '', hints: '' };
  const update = (d: HudData, hintList: Hint[]): void => {
    latest = d;
    const { me } = d;
    const fm = fmt();

    const companies = `${me.company.id}|${me.companies.map((c) => `${c.id}:${c.name}`).join('|')}`;
    if (companies !== keys.companies) {
      keys.companies = companies;
      switcher.replaceChildren(...me.companies.map((c) => h('option', { value: c.id }, c.name)), h('option', { value: NEW_COMPANY }, t('nc.menu')));
      switcher.value = String(me.company.id);
    }
    switcher.disabled = !!d.offline;

    serverLine.classList.toggle('off', !!d.offline);
    serverDot.className = d.offline ? 'dot off' : 'dot';
    serverText.data = d.offline ? t('offline.server', { server: serverName() }) : serverName();

    for (const [tab, a] of tabLinks) { if (tab === d.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    if (d.tab === 'settings') settings.setAttribute('aria-current', 'page'); else settings.removeAttribute('aria-current');
    jobCount.textContent = String(d.jobCount);
    liveDot.hidden = !me.fleet.some((a) => a.busy);
    place(top.isConnected);

    balance.set(me.company.balance);
    reputation.set(me.company.reputation);
    const prog = rankProgress(me.pilot);
    ringProgress.setAttribute('stroke-dasharray', ringDash(prog.fraction));
    ringLabel.textContent = `R${prog.index + 1}`;
    pilotName.textContent = me.username;
    pilotSub.textContent = t('hud.rank', { n: prog.index + 1, pct: fm.percent(prog.fraction) });

    const { month, daysLeft } = fm.season(Date.now());
    const statusKey = `${d.antiCheat}|${month}|${daysLeft}`;
    if (statusKey !== keys.status) {
      keys.status = statusKey;
      status.replaceChildren(
        ...(d.antiCheat ? [] : [h('span', { title: t('hud.antiCheatOffHint') }, icon('shield-x', 14), t('hud.antiCheatOff'))]),
        h('span', null, icon('calendar-clock', 14), t('hud.season', { month }), h('span', { class: 'dim' }, daysLeft === 0 ? t('hud.lastDay') : tp('hud.daysLeft', daysLeft))));
    }
    const hintsKey = hintList.map((x) => `${x.key}=${x.label}`).join('|');
    if (hintsKey !== keys.hints) {
      keys.hints = hintsKey;
      hintsEl.replaceChildren(...hintList.map((x) => h('span', { class: 'hint' }, keycap(x.key), x.label)));
    }
  };
  update(initial, []);
  return { top, bottom, update, lang };
}

/** The HUD of the stage. Its text is translated when it is built, so a language change builds it afresh (the shell then remounts it). */
export function createHud(): Hud {
  let parts: ReturnType<typeof build> | null = null;
  return {
    get top() { return parts!.top; },
    get bottom() { return parts!.bottom; },
    update(d, hints) {
      if (!parts || parts.lang !== getLang()) parts = build(d, getLang());
      parts.update(d, hints);
    },
    reset() { parts = null; },
  };
}
