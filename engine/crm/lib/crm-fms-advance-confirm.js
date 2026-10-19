// VERBATIM COPY of CRM lib/crm-fms-advance-confirm.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/crm-fms-advance-confirm.js
//
// CRM FMS Step-4 (Advance Payment Confirmation, stored as `step7`) is decided by
// the Client Wallet: once the wallet counts a PI's advance as confirmed, Step-4
// is done. The wallet mirrors its own confirm button onto the sheet, but the
// wallet also confirms an advance in ways that never touch the sheet — a ledger
// entry, a carry-forward, a payment from before the confirm workflow existed —
// and a stale CRM FMS tab can post an old pending Step-4 back over the mirror.
// The board and the PC report therefore read the confirmation from the wallet.
//
// Client-safe and Firebase-free so it can be unit tested.
import { parseSheetDate } from './sheet-date.js';
import { externalStatus, isConfirmWorkflowEra } from './wallet-entry-status.js';

export const STEP_COMPLETED = 'completed';
export const CONFIRMED_VIA_WALLET_REMARK = 'Advance confirmed via Client Wallet';

const CONFIRMED = 'confirmed';
const CREDIT = 'CREDIT';
const CRM_ADVANCE_ENTRY_PREFIX = 'crm-adv-';
const isAdvanceCategory = (category) => /advance/i.test(String(category || ''));
const normPi = (value) => String(value || '').trim();

const isDone = (step) => step?.status === STEP_COMPLETED && Boolean(step?.actualDateTime);

const toInstant = (value) => {
  const date = parseSheetDate(value);
  return date ? date.toISOString() : '';
};

/**
 * When the wallet's evidence for one advance says it was confirmed.
 * `at` is a real accounts decision. `onReceipt` means the advance counts as
 * confirmed the moment it arrived: it predates the confirm workflow, or it is
 * money the wallet had already confirmed, moved here by a carry-forward.
 */
function externalEvidence(entry, overlay, now) {
  if (externalStatus(entry, overlay, now) !== CONFIRMED) return null;
  if (overlay?.confirmedAt && isConfirmWorkflowEra(entry.date, now)) {
    return { at: toInstant(overlay.confirmedAt), onReceipt: false };
  }
  return { at: '', onReceipt: true };
}

function ledgerEvidence(entry, now) {
  if ((entry.status || CONFIRMED) !== CONFIRMED) return null;
  if (entry.type !== CREDIT) return { at: toInstant(entry.date), onReceipt: false };
  if (entry.isCarryForward || !isConfirmWorkflowEra(entry.date, now)) return { at: '', onReceipt: true };
  return { at: toInstant(entry.confirmedAt || entry.date), onReceipt: false };
}

/**
 * PI number → { confirmedAt, onReceipt } for every PI whose advance the Client
 * Wallet counts as confirmed. `confirmedAt` is the earliest accounts decision
 * (ISO, or '' when there is none); `onReceipt` is true when any evidence counts
 * from receipt. A PI missing from the map has no confirmed advance.
 *
 * @param {object[]} externals  getAllExternalWalletEntries() rows (CRM + SO-FMS)
 * @param {object}   overlays   walletConfirmations docs keyed by entryId
 * @param {object[]} ledger     walletLedger docs whose category is Advance
 */
export function advanceConfirmationsByPi({ externals = [], overlays = {}, ledger = [], now = new Date() }) {
  const byPi = {};
  const note = (piNo, evidence) => {
    const pi = normPi(piNo);
    if (!pi || !evidence) return;
    const current = byPi[pi] || { confirmedAt: '', onReceipt: false };
    const earlier = evidence.at && (!current.confirmedAt || evidence.at < current.confirmedAt);
    byPi[pi] = {
      confirmedAt: earlier ? evidence.at : current.confirmedAt,
      onReceipt: current.onReceipt || evidence.onReceipt,
    };
  };

  const seen = new Set();
  for (const entry of externals) {
    seen.add(entry.id);
    if (isAdvanceCategory(entry.category)) note(entry.piNo, externalEvidence(entry, overlays[entry.id], now));
  }
  // An accounts decision stands even when its sheet row was not read this time
  // — a failed Sheets read, or a PI whose row has since moved.
  for (const [entryId, overlay] of Object.entries(overlays)) {
    if (seen.has(entryId) || overlay?.status !== CONFIRMED || !overlay.confirmedAt) continue;
    const isAdvance = entryId.startsWith(CRM_ADVANCE_ENTRY_PREFIX) || isAdvanceCategory(overlay.category);
    if (!isAdvance) continue;
    const piNo = overlay.piNo || (entryId.startsWith(CRM_ADVANCE_ENTRY_PREFIX) ? entryId.slice(CRM_ADVANCE_ENTRY_PREFIX.length) : '');
    note(piNo, { at: toInstant(overlay.confirmedAt), onReceipt: false });
  }
  for (const entry of ledger) note(entry.piNo, ledgerEvidence(entry, now));
  return byPi;
}

/**
 * Step-4's actual once the wallet has confirmed the advance: the earliest of the
 * accounts decision, the Step-3 actual when the advance counts from receipt, and
 * any actual the sheet already holds. A sheet actual stamped later — by a bulk
 * back-fill, or a board click days after the wallet — does not make it late.
 */
export function step4ActualFrom(confirmation, step3Actual, sheetActual = null) {
  const candidates = [
    parseSheetDate(confirmation?.confirmedAt),
    confirmation?.onReceipt ? parseSheetDate(step3Actual) : null,
    parseSheetDate(sheetActual),
  ].filter(Boolean);
  if (!candidates.length) return null;
  return new Date(Math.min(...candidates.map((date) => date.getTime())));
}

/**
 * Step-4 as the board should show it once the wallet has confirmed the advance.
 * A Step-4 already done keeps everything but an actual the wallet beats.
 */
export function applyWalletAdvanceConfirmation(step, confirmation, step3Actual) {
  if (!confirmation) return step;
  if (isDone(step)) {
    const own = parseSheetDate(step.actualDateTime);
    const actual = step4ActualFrom(confirmation, step3Actual, own);
    if (!own || !actual || actual.getTime() >= own.getTime()) return step;
    return { ...step, actualDateTime: actual.toISOString(), walletAdvanceConfirmed: true };
  }
  const actual = step4ActualFrom(confirmation, step3Actual);
  return {
    ...(step || {}),
    status: STEP_COMPLETED,
    actualDateTime: actual ? actual.toISOString() : '',
    paymentConfirmed: 'yes',
    remarks: CONFIRMED_VIA_WALLET_REMARK,
    walletAdvanceConfirmed: true,
  };
}

// What applyWalletAdvanceConfirmation writes onto a board row.
const WALLET_STEP4_FIELDS = ['status', 'actualDateTime', 'paymentConfirmed', 'remarks'];

/**
 * The Step-4 a board save may send to the sheet. A Step-4 closed by the wallet
 * is display-only: its fields stay off the sheet, so an unrelated save (a hold,
 * a delay reason) cannot pin it done after the wallet reverses the advance. The
 * server keeps the sheet's own values for anything left out (mergeStep4Save).
 */
export function sheetStep4Payload(payload, step) {
  if (!step?.walletAdvanceConfirmed) return payload;
  const kept = { ...payload };
  WALLET_STEP4_FIELDS.forEach((field) => { delete kept[field]; });
  return kept;
}

/**
 * Merge an incoming board save of a step over the one on the sheet. A save
 * that carries no actual cannot reopen a step the sheet shows completed — only
 * a deliberate `reopen` (the wallet rejecting the advance) can — so the fields
 * that record its completion stay the sheet's. Everything else the save
 * carries, like a delay reason or an extension, still lands.
 *
 * The board posts every step of a PI with each save, so a stale CRM FMS tab
 * posts back as pending a step finished elsewhere since it loaded: Step-4 by
 * the Client Wallet (mergeStep4Save), Step-2 by a signed PI uploaded from the
 * Approved PI list (lib/crm-fms-signed-pi.js mergeStep2Save).
 *
 * @param {object|null} sheetStep  The step as the sheet holds it.
 * @param {object|null} incomingStep  The step as the save posts it.
 * @param {string[]} completionFields  What records the step's completion, kept from the sheet.
 */
export function mergeCompletedStepSave(sheetStep, incomingStep, completionFields) {
  const merged = { ...(sheetStep || {}), ...(incomingStep || {}) };
  if (!isDone(sheetStep) || incomingStep?.actualDateTime || incomingStep?.reopen) return merged;
  return { ...merged, ...Object.fromEntries(completionFields.map((field) => [field, sheetStep[field]])) };
}

// What a completed Step-4 records: the confirmation the Client Wallet wrote.
const STEP4_COMPLETION_FIELDS = Object.freeze([
  'actualDateTime', 'status', 'delayHours', 'paymentConfirmed', 'confirmationRemarks', 'remarks',
]);

/** A Step-4 save over the sheet's: a stale pending one cannot undo a confirmation the wallet wrote. */
export const mergeStep4Save = (sheetStep, incomingStep) =>
  mergeCompletedStepSave(sheetStep, incomingStep, STEP4_COMPLETION_FIELDS);
