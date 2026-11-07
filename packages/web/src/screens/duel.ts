import type { CompanyProfile } from '@opc/shared';
import { panel, titleBlock } from '../components.ts';
import { loadProfile, loadSeason } from '../competition-data.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { hashFor } from '../keys.ts';
import type { Ctx, Screen } from '../screen.ts';
import { duel, duelScore, kindOf, type DuelKey, type DuelRow, type Standing } from '../standings.ts';
import { h } from '../ui.ts';

const missing = (): HTMLElement => h('span', { class: 'unknown', title: t('duel.missing') }, '–');

/** Side-by-side comparison of the player's company with one rival, over the current season. */
export async function duelScreen(ctx: Ctx): Promise<Screen> {
  const { snap, arg, go } = ctx;
  const { me } = snap;
  const fm = fmt();
  const back = '#leaderboard';
  const rivalId = arg ? Number(arg) : NaN;
  const data = await loadSeason();
  const rivalRow = data.standings.find((r) => r.companyId === rivalId);
  const myRow = data.standings.find((r) => r.companyId === me.company.id);
  const [rivalProfile, myProfile] = await Promise.all([rivalRow ? loadProfile(rivalRow.companyId) : null, myRow ? loadProfile(myRow.companyId) : null]);
  if (!rivalRow || !rivalProfile || !myRow || !myProfile || rivalRow.companyId === myRow.companyId) {
    return { title: t('duel.panel'), scene: 'ai', tab: 'leaderboard', back, hints: [{ key: t('key.esc'), label: t('hint.leaderboard') }], view: h('p', { class: 'dim' }, t('duel.pick')) };
  }

  const a = { standing: myRow, profile: myProfile };
  const b = { standing: rivalRow, profile: rivalProfile };
  const rows = duel(a, b);
  const score = duelScore(rows);

  const money = (k: DuelKey, v: number | null): HTMLElement | string => {
    if (v === null) return missing();
    switch (k) {
      case 'worth': return fm.moneyShort(v);
      case 'gain': return fm.signedMoney(v);
      case 'revenuePerFlight': return fm.money(Math.round(v));
      case 'reputation': return fm.num(v, 1);
      case 'hours': return fm.hours(v);
      default: return fm.num(v);
    }
  };
  const line = (r: DuelRow): HTMLElement => h('div', { class: 'duel-line' },
    h('span', { class: `duel-value ${r.winner === 'a' ? 'win' : ''}`.trim() }, money(r.key, r.a)),
    h('div', { class: 'duel-bar left', 'aria-hidden': 'true' }, h('span', { class: r.winner === 'a' ? 'win' : '', style: `width:${Math.round(r.aShare * 100)}%` })),
    h('span', { class: 'duel-label' }, t(`duel.${r.key}`), r.winner === 'a' || r.winner === 'b' ? h('span', { class: 'sr' }, ` · ${t('duel.winner')}: ${r.winner === 'a' ? me.company.name : rivalRow.name}`) : null),
    h('div', { class: 'duel-bar right', 'aria-hidden': 'true' }, h('span', { class: r.winner === 'b' ? 'win' : '', style: `width:${Math.round(r.bShare * 100)}%` })),
    h('span', { class: `duel-value ${r.winner === 'b' ? 'win' : ''}`.trim() }, money(r.key, r.b)));

  const verdict = score.a === score.b ? t('duel.tie', { a: score.a, b: score.b }) : t('duel.lead', { name: score.a > score.b ? me.company.name : rivalRow.name, a: Math.max(score.a, score.b), b: Math.min(score.a, score.b) });
  const kind = (s: Standing, p: CompanyProfile): string => {
    const k = kindOf(s, me.company.id, p);
    return t(k === null ? 'lb.kind.ai' : (`lb.kind.${k}`));
  };
  const ids = data.standings.filter((r) => r.companyId !== me.company.id).map((r) => r.companyId);
  const step = (d: 1 | -1): void => { const i = ids.indexOf(rivalRow.companyId); go(hashFor('duel', ids[(i + d + ids.length) % ids.length]!)); };

  const view = h('div', { class: 'duel-layout' },
    h('div', { class: 'duel-header' },
      titleBlock(t('duel.status', { rank: fm.ordinal(myRow.rank) }), me.company.name),
      h('div', { class: 'duel-center' }, h('span', { class: 'duel-vs' }, t('duel.vs')), h('span', { class: 'dim small' }, verdict)),
      h('div', { class: 'title-block end' }, h('div', { class: 'status-line' }, t('duel.statusRival', { kind: kind(rivalRow, rivalProfile), rank: fm.ordinal(rivalRow.rank) })), h('h1', { class: 'title' }, rivalRow.name))),
    panel({ title: t('duel.panel'), action: verdict, class: 'duel-panel' }, h('div', { class: 'duel-lines' }, rows.map(line)), h('p', { class: 'dim small' }, t('lb.gap'))));
  return {
    title: t('duel.panel'), scene: 'ai', tab: 'leaderboard', view, back,
    hints: [{ key: t('key.esc'), label: t('hint.leaderboard') }, { key: '← →', label: t('hint.rivals') }, ...(rivalRow.isAI ? [{ key: 'F', label: t('hint.sheet') }] : [])],
    keys: { left: () => step(-1), right: () => step(1), ...(rivalRow.isAI ? { f: () => go(hashFor('company-sheet', rivalRow.companyId)) } : {}) },
  };
}
