import { START_MODE_IDS, type Company, type CompanyImpact, type StartMode } from '@opc/shared';
import { companyImpact, deleteCompany, resetCompany } from './api-company.ts';
import { session } from './api.ts';
import { button, icon, inputField } from './components.ts';
import { passwordOpen, readiness, losses, type CompanyAction, type Confirmation } from './company-actions-model.ts';
import { errorText } from './error-text.ts';
import { fmt } from './format.ts';
import { t, tp } from './i18n.ts';
import { START_FACTS } from './onboarding-model.ts';
import { h, notify } from './ui.ts';

export type CompanyDialog = {
  company: Company;
  action: CompanyAction;
  /** The button that opened it: the focus goes back there. */
  opener: HTMLElement;
  /** Companies the player keeps after a deletion; none sends her back to the onboarding. */
  remaining: number;
  exportJson: () => void;
  refresh: () => Promise<void>;
  go: (hash: string) => void;
};

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]';

/** The danger confirmation: what will be lost, then the company's name typed, then the password. Esc and the backdrop close it; Enter in a field never acts, it only moves on (the destructive button has to be pressed on purpose). While it is open the page behind is inert and Tab cycles inside. */
export function openCompanyDialog(o: CompanyDialog): void {
  const { company, action } = o;
  const name = company.name;
  const state: Confirmation = { name, typedName: '', password: '', impact: null, busy: false };
  let mode: StartMode = company.startMode ?? 'airliner';
  const app = document.getElementById('app');

  const error = h('p', { class: 'cd-error', role: 'alert' });
  const lossBox = h('div', { class: 'cd-loss', 'aria-live': 'polite' }, h('p', { class: 'dim' }, t('co.dlg.loading')));
  const nameField = inputField({ label: t('co.dlg.typeName', { name }), icon: 'building-2', id: 'cd-name' }, { type: 'text', name: 'confirm-company-name', autocomplete: 'off', spellcheck: 'false', maxlength: 60 });
  const pwField = inputField({ label: t('co.dlg.password'), icon: 'lock', id: 'cd-password' }, { type: 'password', name: 'confirm-password', autocomplete: 'current-password', maxlength: 128, disabled: true });
  const go = button(t(action === 'reset' ? 'co.dlg.resetGo' : 'co.dlg.deleteGo'), { variant: 'danger', icon: action === 'reset' ? 'refresh-cw' : 'trash-2', disabled: true });
  const cancel = button(t('co.dlg.cancel'), { variant: 'secondary', onclick: () => close() });

  const paint = (): void => {
    pwField.control.disabled = !passwordOpen(state);
    go.disabled = readiness(state) !== 'ready';
  };

  const showImpact = (i: CompanyImpact): void => {
    const lost = losses(i).map((l) => h('li', null, tp(`co.dlg.loss.${l.kind}`, l.n)));
    lossBox.replaceChildren(
      h('p', null, t(action === 'reset' ? 'co.dlg.resetIntro' : 'co.dlg.deleteIntro', { name })),
      h('ul', { class: 'cd-list' }, h('li', null, t('co.dlg.balance', { amount: fmt().money(i.balance) })), lost, h('li', { class: 'dim' }, t('co.dlg.also'))),
      ...(i.flightActive ? [h('p', { class: 'cd-flight', role: 'alert' }, icon('triangle-alert', 14), t('co.dlg.flightActive'))] : []));
  };

  const startPick = action === 'reset'
    ? h('fieldset', { class: 'cd-start' },
      h('legend', null, t('co.dlg.start')),
      START_MODE_IDS.map((m) => h('label', { class: 'cd-mode' },
        h('input', { type: 'radio', name: 'cd-start', value: m, checked: m === mode, onchange: () => { mode = m; } }),
        h('span', null, t(`co.mode.${m}`), ' ', h('span', { class: 'dim' }, fmt().money(START_FACTS[m].capital)))))) : null;

  const exportNote = h('p', { class: 'cd-export' }, icon('download', 14), h('span', null, t('co.dlg.export'), ' '),
    h('button', { type: 'button', class: 'link-btn', onclick: () => o.exportJson() }, t('co.dlg.exportJson')), ' · ',
    h('button', { type: 'button', class: 'link-btn', onclick: () => { close(); document.querySelector<HTMLElement>('#export-panel button')?.focus(); } }, t('co.dlg.exportOther')));

  const submit = async (): Promise<void> => {
    if (readiness(state) !== 'ready') return;
    state.busy = true; paint(); error.textContent = '';
    try {
      if (action === 'delete') {
        await deleteCompany(company.id, state.password);
        session.forget(company.id);
        close(false);
        notify(t('co.dlg.deleteDone', { name }));
        if (o.remaining === 0) { location.hash = '#dashboard'; location.reload(); } else await o.refresh();
      } else {
        await resetCompany(company.id, state.password, mode);
        session.company = company.id;
        close(false);
        notify(t('co.dlg.resetDone', { name }));
        o.go('#company');
      }
    } catch (e) {
      error.textContent = errorText(e);
      state.busy = false; state.password = ''; pwField.control.value = ''; paint();
      pwField.control.focus();
    }
  };
  go.addEventListener('click', () => void submit());

  nameField.control.addEventListener('input', () => { state.typedName = nameField.control.value; paint(); });
  pwField.control.addEventListener('input', () => { state.password = pwField.control.value; error.textContent = ''; paint(); });

  const title = h('h2', { id: 'cd-title' }, t(action === 'reset' ? 'co.dlg.resetTitle' : 'co.dlg.deleteTitle', { name }));
  const dialog = h('div', { class: 'cd-dialog', role: 'dialog', 'aria-modal': 'true', tabindex: -1, 'aria-labelledby': 'cd-title', 'aria-describedby': 'cd-body' },
    h('header', { class: 'cd-head' }, icon('triangle-alert', 18), title),
    h('div', { class: 'cd-body', id: 'cd-body' }, lossBox, startPick, exportNote, nameField.root, pwField.root, error),
    h('footer', { class: 'cd-foot' }, cancel, go));
  const overlay = h('div', { class: 'cd-overlay', onmousedown: (e: MouseEvent) => { if (e.target === overlay) close(); } }, dialog);

  /** Keys pressed while the focus is outside the dialog (it fell to the page, which is inert): Esc closes, the rest is kept from the page's shortcuts. */
  const strayKey = (e: KeyboardEvent): void => {
    if (dialog.contains(e.target as Node)) return;
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') { e.preventDefault(); nameField.control.focus(); }
  };
  document.addEventListener('keydown', strayKey, true);

  function close(restore = true): void {
    document.removeEventListener('keydown', strayKey, true);
    overlay.remove();
    app?.removeAttribute('inert');
    if (restore && o.opener.isConnected) o.opener.focus();
  }

  dialog.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') {
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0]!, last = items.at(-1)!;
      if (e.shiftKey && (el === first || !dialog.contains(el))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (el === last || !dialog.contains(el))) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'Enter' && el instanceof HTMLInputElement) {
      e.preventDefault();
      if (el === nameField.control && passwordOpen(state)) pwField.control.focus();
      else if (el === pwField.control && readiness(state) === 'ready') go.focus();
    }
    e.stopPropagation(); // the page's own shortcuts (Q/E, Enter = primary button) must not act behind the dialog
  });

  app?.setAttribute('inert', '');
  document.body.append(overlay);
  nameField.control.focus();
  companyImpact(company.id).then((i) => { state.impact = i; showImpact(i); paint(); }, () => lossBox.replaceChildren(h('p', { class: 'cd-error', role: 'alert' }, t('co.dlg.impactFailed'))));
}
