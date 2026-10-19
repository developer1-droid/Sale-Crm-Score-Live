/* On-screen period chips for the CRM and Sales boards, plus "Set as default". */
import { el } from './dom.js';
import { CRM_PERIODS, SALES_PERIODS } from './settingsModel.js';

const SAVED_MS = 2200;

function chipGroup(label, periods, onPick) {
  const group = el('div', 'fb-group');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', `${label} period`);
  const chips = new Map(periods.map((p, i) => {
    const b = el('button', 'fb-chip', p.chip);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.key = p.key;
    if (label === 'CRM' && i < 9) b.title = `${p.chip} (key ${i + 1})`;
    b.addEventListener('click', () => onPick(p.key));
    return [p.key, b];
  }));
  group.append(el('span', 'fb-label', label), ...chips.values());
  return { group, chips };
}

/**
 * onPick(kind, key) — kind 'crm' | 'sales'; onSaveDefault() → Promise.
 */
export function createFilterBar(host, { onPick, onSaveDefault }) {
  const crm = chipGroup('CRM', CRM_PERIODS, (key) => onPick('crm', key));
  const sales = chipGroup('Sales', SALES_PERIODS, (key) => onPick('sales', key));
  const save = el('button', 'fb-save', 'Set as default');
  save.type = 'button';
  const note = el('span', 'fb-note');
  note.setAttribute('role', 'status');
  const end = el('div', 'fb-end');
  end.append(note, save);
  host.replaceChildren(crm.group, sales.group, end);

  let noteTimer = null;
  function flash(text, tone) {
    note.textContent = text;
    note.dataset.tone = tone;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.textContent = ''; }, SAVED_MS);
  }

  save.addEventListener('click', () => {
    save.disabled = true;
    onSaveDefault()
      .then(() => flash('Saved ✓ for every screen', 'good'))
      .catch((err) => flash(err && err.message ? err.message : 'Could not save', 'bad'))
      .finally(() => { save.disabled = false; });
  });

  const mark = (chips, key) => chips.forEach((b, k) => b.setAttribute('aria-checked', String(k === key)));
  const defaultChip = (key) => (CRM_PERIODS.find((p) => p.key === key) || { chip: key }).chip;

  return {
    /** focus = which group the current board uses ('crm' | 'sales' | null).
        crmLabels = { key: label } when the CRM names its periods itself (its MIS engine: "This week" …). */
    render({ crmKey, salesKey, focus, isDirty, visible, crmLabels, crmHidden = [] }) {
      host.hidden = !visible;
      crm.chips.forEach((b, k) => {
        const text = (crmLabels && crmLabels[k]) || defaultChip(k);
        if (b.textContent !== text) b.textContent = text;
        b.style.display = crmHidden.includes(k) ? 'none' : '';
      });
      mark(crm.chips, crmKey);
      mark(sales.chips, salesKey);
      crm.group.classList.toggle('is-focus', focus === 'crm');
      sales.group.classList.toggle('is-focus', focus === 'sales');
      save.hidden = !isDirty;
    },
  };
}
