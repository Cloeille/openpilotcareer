import { PRODUCT_NAME } from '../brand.ts';
import { button, icon, panel } from '../components.ts';
import { ApiError } from '../errors.ts';
import { fmt } from '../format.ts';
import { t } from '../i18n.ts';
import { BRIDGE_TIMEOUT_MS, UNVERIFIED_PAY_PCT, bridgeVerdict, keyUsed, type CheckState } from '../onboarding-model.ts';
import { apiKeys, bridgeStatus, BRIDGE_STATUS_URL, createApiKey, downloadSize, downloadUrl, deleteApiKey } from '../api-onboarding.ts';
import type { BridgeStatus } from '../onboarding-types.ts';
import { guarded, hintsOf, obError, titleArea, type StepResult, type Wizard } from '../onboarding-shell.ts';
import { h } from '../ui.ts';
import type { Key } from '../messages.ts';
import type { IconName } from '../icons.ts';

const CHECK_ICON: Record<CheckState, IconName> = { ok: 'circle-check', wait: 'loader-circle', idle: 'circle-dashed', unknown: 'circle-dashed' };
const POLL_MS = 2000;
const KEY_LABEL = 'PC principal';

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export async function step5(w: Wizard): Promise<StepResult> {
  const fm = fmt();
  const error = h('p', { class: 'ob-error', role: 'alert' });

  // ---- 1. the API key: created once per run, shown once, kept in memory only
  let existingUsed: { label: string; at: number } | null = null;
  let keyFailed = false;
  if (!w.key) {
    try {
      const keys = await apiKeys();
      const old = keys.find((k) => k.label === KEY_LABEL && k.lastUsedAt !== null);
      if (old) existingUsed = { label: old.label, at: old.lastUsedAt! };
      else {
        // A key of an earlier, abandoned pass of this step cannot be shown again: replace it.
        for (const k of keys.filter((x) => x.label === KEY_LABEL && x.lastUsedAt === null)) await deleteApiKey(k.id).catch(() => undefined);
        const created = await createApiKey(KEY_LABEL);
        w.key = { id: created.id, label: created.label, secret: created.key };
      }
    } catch { keyFailed = true; }
  }

  const keyBox = h('div', { class: 'ob-keybox', tabindex: 0, 'aria-label': t('ob.s5.keyCreated', { label: KEY_LABEL }) }, w.key?.secret ?? '');
  const copyBtn = button(t('ob.s5.copy'), { variant: 'primary', key: 'C' });
  copyBtn.removeAttribute('data-primary'); // looks primary (the mockup), but Enter must go to "Continuer", not copy
  const copyLabel = copyBtn.querySelector('span')!;
  const copyKey = async (): Promise<void> => {
    if (!w.key?.secret) return;
    const ok = await copyText(w.key.secret);
    if (!ok) { const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(keyBox); sel?.removeAllRanges(); sel?.addRange(r); }
    copyLabel.textContent = t('ob.s5.copied');
    window.setTimeout(() => { copyLabel.textContent = t('ob.s5.copy'); }, 2000);
  };
  copyBtn.addEventListener('click', () => void copyKey());
  const keyBlock = h('div', { class: 'ob-howto-body' });
  const paintKey = (hidden: boolean): void => {
    const sub = h('p', null, t('ob.s5.keySub', { product: PRODUCT_NAME }));
    if (w.key?.secret && !hidden) {
      keyBlock.replaceChildren(h('h2', null, t('ob.s5.key')), sub,
        h('div', { class: 'ob-reveal' },
          h('div', { class: 'ob-reveal-head' }, h('b', null, t('ob.s5.keyCreated', { label: w.key.label })), h('span', null, t('ob.s5.once'))),
          h('div', { class: 'ob-keyrow' }, keyBox, copyBtn),
          h('div', { class: 'ob-reveal-foot' }, h('small', null, t('ob.s5.lost')),
            button(t('ob.s5.iCopied'), { variant: 'ghost', icon: 'check', onclick: () => { if (w.key) w.key.secret = null; paintKey(true); } }))));
    } else if (existingUsed) {
      keyBlock.replaceChildren(h('h2', null, t('ob.s5.keyExisting')), h('p', null, t('ob.s5.keyExistingSub', { label: existingUsed.label, when: fm.ago(existingUsed.at, Date.now()) || fm.dateTime(existingUsed.at) })));
    } else if (keyFailed) {
      keyBlock.replaceChildren(h('h2', null, t('ob.s5.key')), h('p', { class: 'ob-error' }, t('ob.s5.keyFailed')));
    } else {
      keyBlock.replaceChildren(h('h2', null, t('ob.s5.key')), sub, h('p', { class: 'ob-meaning-note' }, t('ob.s5.hidden')));
    }
  };
  paintKey(false);

  // ---- 2. the download
  const size = await downloadSize();
  const dlInfo = h('small', null, size === null ? t('ob.s5.fileMissing') : size > 0 ? t('ob.s5.fileSize', { size: fm.num(size / 1_000_000, 1) }) : '');
  const dl = size === null
    ? button(t('ob.s5.download'), { variant: 'secondary', icon: 'download', disabled: true })
    : h('a', { class: 'btn secondary', href: downloadUrl(), download: 'opc-bridge-win-x64.exe', rel: 'noopener' }, icon('download'), h('span', null, t('ob.s5.download')));

  // ---- 3. the live test: the bridge on this PC, and the server seeing the key
  const started = Date.now();
  let probe: BridgeStatus | null = null;
  let keyOk = existingUsed !== null;
  const stateHost = h('div');
  const checksHost = h('ul', { class: 'ob-checks' });
  const diagHost = h('div');
  const successHint = h('div');
  let timer = 0;
  let stopped = false;
  let diagOpen = false;
  let lastVerdict = bridgeVerdict(null, keyOk, 0);

  const installIndex = h('span', { class: 'ob-howto-index' }, '1');
  const keyIndex = h('span', { class: 'ob-howto-index' }, '2');
  const mark = (el: HTMLElement, done: boolean, n: string): void => { el.classList.toggle('done', done); el.replaceChildren(...(done ? [icon('check', 13)] : [n])); };
  const check = (state: CheckState, label: string, value: string): HTMLElement =>
    h('li', { class: `ob-check ${state}` }, icon(CHECK_ICON[state], 17), h('b', null, label), h('span', null, value));

  const contBtnHost = h('div', { class: 'ob-continue' });
  const paintContinue = (connected: boolean): void => {
    const b = button(t('ob.hint.continue'), { variant: 'primary', key: t('key.enter'), disabled: !connected, onclick: () => { w.bridge = 'connected'; w.next(); } });
    contBtnHost.replaceChildren(...(connected ? [] : [h('small', null, t('ob.s5.after'))]), b);
  };

  const paint = (): void => {
    const elapsed = Date.now() - started;
    const v = bridgeVerdict(probe ? { reachable: true, ...(probe.version !== undefined ? { version: probe.version } : {}), ...(probe.sim !== undefined ? { sim: probe.sim } : {}), hasFlight: probe.flight != null } : null, keyOk, elapsed);
    lastVerdict = v;
    const iconBox = (cls: string, name: IconName, spin = false): HTMLElement => h('div', { class: `ob-state-icon ${cls}` }, h('span', { class: spin ? 'spin' : '' , style: 'display:grid' }, icon(name, 24)));
    let head: HTMLElement;
    if (v.overall === 'connected') {
      head = h('div', { class: 'ob-state' }, iconBox('ok', 'circle-check'), h('div', { class: 'ob-state-text' }, h('b', null, t('ob.s5.connected')), h('span', null, t('ob.s5.connectedSub'))));
    } else if (v.overall === 'failed') {
      head = h('div', { class: 'ob-state' }, iconBox('bad', 'circle-x'), h('div', { class: 'ob-state-text' }, h('b', null, t('ob.s5.failed')), h('span', null, t('ob.s5.failedSub'))));
    } else {
      const [title, sub] = v.bridge !== 'ok' ? [t('ob.s5.waitBridge'), t('ob.s5.waitBridgeSub', { product: PRODUCT_NAME })]
        : v.key !== 'ok' ? [t('ob.s5.waitKey'), t('ob.s5.waitKeySub')] : [t('ob.s5.waitSim'), t('ob.s5.waitSimSub')];
      head = h('div', { class: 'ob-state' }, iconBox('', 'loader-circle', true), h('div', { class: 'ob-state-text' }, h('b', null, title), h('span', null, sub)),
        h('span', { class: 'ob-elapsed' }, t('ob.s5.since', { time: fm.elapsed(elapsed) })));
    }
    stateHost.replaceChildren(head);
    stateHost.setAttribute('role', 'status');
    checksHost.replaceChildren(
      check(v.bridge, t('ob.s5.c.bridge', { product: PRODUCT_NAME }), v.bridge === 'ok' ? (probe?.version ? t('ob.s5.c.bridgeOk', { v: probe.version }) : t('ob.s5.c.bridgeOkNoV')) : t('ob.s5.c.bridgeWait')),
      check(v.key, t('ob.s5.c.key'), v.key === 'ok' ? t('ob.s5.c.keyOk') : t('ob.s5.c.keyWait')),
      check(v.sim, t('ob.s5.c.sim'), v.sim === 'ok' ? t('ob.s5.c.simOk') : v.sim === 'unknown' ? t('ob.s5.c.simUnknown') : t('ob.s5.c.simWait')),
      check(v.data, t('ob.s5.c.data'), v.data === 'ok' ? t('ob.s5.c.dataOk') : t('ob.s5.c.dataIdle')));
    diagHost.replaceChildren(...(diagOpen ? [h('div', { class: 'ob-diag', role: 'status' },
      h('div', null, t('ob.s5.diagBridge', { url: BRIDGE_STATUS_URL, state: probe ? t('ob.s5.diagUp') : t('ob.s5.diagDown') })),
      h('div', null, t('ob.s5.diagKey', { state: keyOk ? t('ob.s5.yes') : t('ob.s5.no') })),
      h('div', null, t('ob.s5.diagHint')))] : []));
    paintContinue(v.overall === 'connected');
    mark(installIndex, v.bridge === 'ok', '1');
    mark(keyIndex, v.key === 'ok', '2');
    w.bridgeSeen(probe);
  };

  const poll = async (): Promise<void> => {
    if (stopped) return;
    probe = await bridgeStatus();
    if (stopped) return;
    if (!keyOk && w.key) {
      try { keyOk = keyUsed(await apiKeys(), w.key.id); } catch { /* the server may be busy: the next tick retries */ }
    } else if (!keyOk && existingUsed) keyOk = true;
    paint();
    // connected stays on screen once reached; keep polling slowly so the bar stays truthful
    timer = window.setTimeout(() => void poll(), lastVerdict.overall === 'connected' ? POLL_MS * 3 : POLL_MS);
  };
  const retest = (): void => { window.clearTimeout(timer); void poll(); };
  paint();
  void poll();

  const retestBtn = button(t('ob.s5.retest'), { variant: 'secondary', icon: 'refresh-cw', onclick: retest });
  const diagBtn = button(t('ob.s5.diag'), { variant: 'ghost', onclick: () => { diagOpen = !diagOpen; paint(); } });
  const testPanel = panel({ title: t('ob.s5.test'), action: h('span', { class: 'badge info' }, icon('radio', 12), t('ob.s5.live')), id: 'ob-test' },
    stateHost, checksHost, h('div', { class: 'ob-test-actions' }, retestBtn, diagBtn), diagHost);
  void successHint;

  const other = (ok: boolean, when: Key, title: Key, msg: Key): HTMLElement =>
    h('div', { class: 'ob-other' }, h('div', { class: 'when' }, h('span', { class: `icon ${ok ? 'ok' : 'bad'}`, style: 'display:grid' }, icon(ok ? 'circle-check' : 'circle-x', 15)), t(when)), h('b', null, t(title)), h('p', null, t(msg)));

  const skip = (): void => { w.bridge = 'skipped'; w.next(); };
  const skipBtn = button(t('ob.s5.skip'), { variant: 'ghost', onclick: skip });

  const left = h('div', { class: 'ob-bridge-left' },
    titleArea(t('ob.s5.over'), t('ob.s5.title'), t('ob.s5.sub', { product: PRODUCT_NAME })),
    h('div', { class: 'ob-howto' },
      h('div', { class: 'ob-howto-step' }, installIndex,
        h('div', { class: 'ob-howto-body' }, h('h2', null, t('ob.s5.install', { product: PRODUCT_NAME })), h('p', null, t('ob.s5.installSub')), h('div', { class: 'ob-dl' }, dl, dlInfo))),
      h('div', { class: 'ob-howto-step' }, keyIndex, keyBlock)));
  const view = h('div', { class: 'ob-page' },
    h('div', { class: 'ob-body' }, left, h('div', { class: 'ob-test' }, testPanel,
      h('div', { class: 'ob-others' }, other(true, 'ob.s5.okWhen', 'ob.s5.okTitle', 'ob.s5.okMsg'), other(false, 'ob.s5.failWhen', 'ob.s5.failTitle', 'ob.s5.failMsg')))),
    h('div', { class: 'ob-foot' },
      h('div', { class: 'ob-skip' }, skipBtn, h('span', { class: 'ob-skip-note' }, t('ob.s5.skipA'), h('span', { class: 'badge unverified' }, icon('circle-dashed', 12), t('ob.s5.unverified')), t('ob.s5.skipB', { pct: UNVERIFIED_PAY_PCT }))),
      h('div', { class: 'ob-foot-left' }, error, contBtnHost)));
  void guarded; void obError; void ApiError;
  return {
    scene: 'bridge', view, back: () => w.prev(),
    keys: { t: retest, c: () => void copyKey(), p: skip },
    hints: hintsOf([t('key.esc'), t('ob.hint.prevStep')], ['T', t('ob.hint.retest')], ['C', t('ob.hint.copyKey')], ['P', t('ob.hint.skip')]),
    cleanup: () => { stopped = true; window.clearTimeout(timer); if (w.key) w.key.secret = null; },
  };
}
