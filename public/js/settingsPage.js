/* Settings page: edit a draft of the shared settings, Save → PUT /api/settings
   (demo mode: this browser). Every TV applies the saved settings live. */
import { $, el, keyOf } from './dom.js';
import { setMotion } from './motion.js';
import { applyResolved } from './theme.js';
import { BOARD_IDS, BOARD_LABELS, CRM_PERIODS, SALES_PERIODS, TRANSITIONS, DEFAULT_SETTINGS, sanitizeSettings } from './settingsModel.js';
import { createSettingsStore, PinError } from './settingsStore.js';
import { createBoardOrder } from './boardOrder.js';
import { createTransitionPreview } from './transitionPreview.js';
import { createVoiceFields } from './voice/voiceFields.js';

const IS_MOCK = new URLSearchParams(location.search).get('mock') === '1';
const SAVED_MS = 3000;
const store = createSettingsStore({ mock: IS_MOCK });
let saved = store.cached();
let draft = saved;

const isDirty = () => JSON.stringify(draft) !== JSON.stringify(saved);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/* ---------- builders for the option groups ---------- */
function radioSeg(host, name, options) {
  host.dataset.field = name;
  host.replaceChildren(...options.map((o) => {
    const label = el('label');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = o.value;
    label.append(input, el('span', '', o.label));
    return label;
  }));
}
radioSeg($('crmPeriod'), 'crmPeriod', CRM_PERIODS.map((p) => ({ value: p.key, label: p.chip })));
radioSeg($('salesPeriod'), 'salesPeriod', SALES_PERIODS.map((p) => ({ value: p.key, label: p.chip })));
radioSeg($('transition'), 'transition', TRANSITIONS.map((t) => ({ value: t, label: cap(t) })));
$('singleBoard').replaceChildren(...BOARD_IDS.map((id) => { const o = el('option', '', BOARD_LABELS[id]); o.value = id; return o; }));

const boardOrder = createBoardOrder($('boardOrder'), { onChange: (boards) => edit({ boards }) });
const preview = createTransitionPreview($('pvStage'), $('pvCaption'));
const voiceFields = createVoiceFields({
  onChange: (voice) => edit({ voice }),
  getPeriods: () => ({ crm: draft.crmPeriod, sales: draft.salesPeriod }),
});

/* ---------- draft → form ---------- */
const setRadio = (name, value) => document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === value; });

function render() {
  setRadio('theme', draft.theme);
  setRadio('crmPeriod', draft.crmPeriod);
  renderCustom();
  setRadio('salesPeriod', draft.salesPeriod);
  setRadio('transition', draft.animation.transition);
  $('showFilterBar').checked = draft.showFilterBar;
  $('showTicker').checked = draft.showTicker;
  $('rotate').checked = draft.rotate;
  $('rotateHint').textContent = draft.rotate ? 'Boards take turns in the order below' : 'One board stays on screen';
  $('singleWrap').hidden = draft.rotate;
  $('singleBoard').value = draft.singleBoard;
  $('boardOrder').classList.toggle('is-muted', !draft.rotate);
  boardOrder.render(draft.boards);
  $('animEnabled').checked = draft.animation.enabled;
  $('speed').value = String(draft.animation.speed);
  $('speedOut').textContent = `${draft.animation.speed}×`;
  $('transition').classList.toggle('is-muted', !draft.animation.enabled);
  $('rowsPerPage').value = String(draft.rowsPerPage);
  $('pageDwellSec').value = String(draft.pageDwellSec);
  voiceFields.render(draft.voice);
  $('btnSave').disabled = !isDirty();
  applyResolved(draft.theme);
  setMotion(draft.animation);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('motionHint').textContent = reduced ? 'This screen asks for reduced motion, so the preview cuts' : '';
  preview.update(draft.animation);
}

function edit(partial) {
  draft = sanitizeSettings(partial, draft);
  if (isDirty()) setState('', '');
  render();
}

/* ---------- custom CRM dates: a draft in the two boxes, applied once it is a whole, ordered range ---------- */
const customBoxes = () => ({ from: $('crmCustomFrom').value, to: $('crmCustomTo').value });
function renderCustom() {
  const { from, to } = draft.crmCustom || { from: '', to: '' };
  const typed = customBoxes();
  // Keep a half-typed range in the boxes; show the saved one otherwise.
  if (!(typed.from && !typed.to) && !(!typed.from && typed.to)) {
    if ($('crmCustomFrom').value !== from) $('crmCustomFrom').value = from;
    if ($('crmCustomTo').value !== to) $('crmCustomTo').value = to;
  }
  const backwards = typed.from && typed.to && typed.from > typed.to;
  $('crmCustomHint').textContent = backwards ? 'From is after To' : from && to ? 'Shown under the “Custom” chip on every TV' : 'Pick both dates to add a “Custom” chip';
  $('crmCustomHint').dataset.tone = backwards ? 'bad' : '';
}
function editCustom() {
  const { from, to } = customBoxes();
  if (from && to && from <= to) edit({ crmCustom: { from, to } });
  else renderCustom();
}
$('crmCustomFrom').addEventListener('change', (e) => { e.stopPropagation(); editCustom(); });
$('crmCustomTo').addEventListener('change', (e) => { e.stopPropagation(); editCustom(); });
$('crmCustomClear').addEventListener('click', () => {
  $('crmCustomFrom').value = '';
  $('crmCustomTo').value = '';
  edit({ crmCustom: { from: '', to: '' }, crmPeriod: draft.crmPeriod === 'custom' ? 'this-week' : draft.crmPeriod });
});

/* ---------- form → draft ---------- */
$('form').addEventListener('change', (e) => {
  const t = e.target;
  if (t.type === 'radio' && t.name === 'transition') { edit({ animation: { transition: t.value } }); return; }
  if (t.type === 'radio') { edit({ [t.name]: t.value }); return; }
  if (t.id === 'animEnabled') { edit({ animation: { enabled: t.checked } }); return; }
  if (t.id === 'speed') { edit({ animation: { speed: Number(t.value) } }); return; }
  if (['showFilterBar', 'showTicker', 'rotate'].includes(t.id)) { edit({ [t.id]: t.checked }); return; }
  if (t.id === 'singleBoard') { edit({ singleBoard: t.value }); return; }
  if (['rowsPerPage', 'pageDwellSec'].includes(t.id)) edit({ [t.id]: Number(t.value) });
});
$('speed').addEventListener('input', (e) => { $('speedOut').textContent = `${e.target.value}×`; });

/* ---------- save ---------- */
let stateTimer = null;
function setState(text, tone) {
  const node = $('saveState');
  node.textContent = text;
  node.dataset.tone = tone;
  clearTimeout(stateTimer);
  if (tone === 'good') stateTimer = setTimeout(() => { node.textContent = ''; }, SAVED_MS);
}

function showPin(message) {
  $('pinWrap').hidden = false;
  $('pin').focus();
  setState(message, 'bad');
}

$('btnSave').addEventListener('click', () => {
  $('btnSave').disabled = true;
  setState('Saving…', '');
  store.save(draft, $('pin').value || undefined)
    .then((next) => {
      saved = next;
      draft = next;
      render();
      setState(IS_MOCK ? 'Saved ✓ (this browser)' : 'Saved ✓ · all screens updated', 'good');
    })
    .catch((err) => {
      $('btnSave').disabled = false;
      if (err instanceof PinError) showPin($('pin').value ? 'Wrong PIN' : 'Enter the settings PIN');
      else setState(err.message || 'Could not save', 'bad');
    });
});
$('pin').addEventListener('keydown', (e) => { if (keyOf(e) === 'Enter') $('btnSave').click(); });
$('btnReset').addEventListener('click', () => edit(DEFAULT_SETTINGS));
window.addEventListener('beforeunload', (e) => {
  if (!isDirty()) return undefined;
  // Older Chrome ignores preventDefault() here: it prompts on returnValue / a returned string.
  e.preventDefault();
  e.returnValue = '';
  return '';
});

/* ---------- start ---------- */
$('backLink').href = IS_MOCK ? './?mock=1' : './';
if (IS_MOCK) $('scopeNote').textContent = 'Demo mode: saved in this browser only, and picked up by demo boards open here.';
render();
store.load()
  .then((loaded) => {
    const wasDirty = isDirty();
    saved = loaded;
    if (!wasDirty) draft = loaded;
    $('pinWrap').hidden = !store.pinRequired();
    render();
  })
  .catch(() => setState('Server unreachable: showing the last known settings', 'bad'));
