import { button, icon } from '../components.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { companyTitle, keyFigures } from '../figures.ts';
import { h } from '../ui.ts';
import type { Snapshot } from '../snapshot.ts';

export const RETRY_EVERY_S = 30;

export type OfflineState = { since: number; attempt: number; nextAt: number; lastSync: number | null };

/** Read-only view over the last snapshot while the server cannot be reached: what is paused, when it retries. */
export function offlineView(snap: Snapshot, st: OfflineState, now: number, retryNow: () => void, changeServer: () => void): { view: HTMLElement; tick: (now: number) => void } {
  const f = fmt();
  const since = h('span', null);
  const countdown = h('span', { class: 'countdown-value' });
  const attempt = h('span', { class: 'dim' }, t('offline.attempt', { n: st.attempt, s: RETRY_EVERY_S }));
  const fill = h('span', null);
  const tick = (n: number): void => {
    since.textContent = n - st.since < 5000 ? t('offline.justNow') : t('offline.since', { time: f.elapsed(n - st.since) });
    const left = Math.max(0, Math.ceil((st.nextAt - n) / 1000));
    countdown.textContent = f.elapsed(left * 1000);
    fill.style.width = `${Math.min(100, Math.max(0, 100 - ((st.nextAt - n) / (RETRY_EVERY_S * 1000)) * 100))}%`;
  };
  tick(now);
  const rule = (label: string, value: string): HTMLElement => h('div', { class: 'rule' }, h('span', { class: 'line-label' }, label), h('span', { class: 'strong' }, value));
  const sync = st.lastSync ?? snap.at;
  const view = h('div', { class: 'wide-layout' }, companyTitle(snap), h('div', { class: 'offline-row' },
    h('section', { class: 'panel offline', 'aria-labelledby': 'offline-title' },
      h('div', { class: 'offline-head' }, h('span', { class: 'status-line danger' }, icon('cloud-off', 15), since)),
      h('div', { class: 'col tight' }, h('h1', { id: 'offline-title', class: 'title big' }, t('offline.title')), h('p', { class: 'muted' }, t('offline.sub'))),
      h('div', { class: 'col tight', role: 'timer', 'aria-live': 'off' },
        h('div', { class: 'retry-row' }, h('div', { class: 'col tight' }, h('span', { class: 'dim small' }, t('offline.retryIn')), countdown), attempt),
        h('div', { class: 'retry-bar' }, fill)),
      h('div', { class: 'col tight rules' }, rule(t('offline.lastSync'), f.zulu(sync)), rule(t('offline.rule2'), t('offline.rule2v')), rule(t('offline.rule3'), t('offline.rule3v'))),
      h('div', { class: 'row' },
        button(t('offline.retryNow'), { variant: 'primary', key: t('key.enter'), onclick: retryNow }),
        button(t('offline.changeServer'), { variant: 'ghost', onclick: changeServer }))),
    keyFigures(snap.me, snap.lastFlight, now, h('p', { class: 'snapshot-note' }, icon('lock', 13), t('offline.snapshot', { time: f.zulu(sync) })))));
  return { view, tick };
}
