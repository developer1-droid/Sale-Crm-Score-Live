// VERBATIM COPY of CRM lib/so-fms-step11-close.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/so-fms-step11-close.js
// Closing SO-FMS Step-11 (Request Payment): when it reads as closed, what a close
// records, and how the board reads the reason back.
//
// Step-11 closes in one of two ways. Either the invoice is SETTLED (payments and
// discounts cover the CI amount), or an operator closes it BY HAND, with the
// money in or not. A close by hand is final: it says no more payment will come
// for this Commercial Invoice, so the closed row takes no payment. It is per
// CI — the other invoices of the same PI stay open. (Operators had been closing
// to pause the chase until a due date; that is what the follow-up date is for.)
//
// The board used to count only the first as closed. A row closed by hand kept the
// same 💰 button an open row shows, so the operator could not tell that the close
// had landed and closed it again. By 8 Oct 2026, 92 of the 298 manual closes in
// the history ledger were on a step that was already closed. Nor was the reason
// visible anywhere: it went into "Step-11 Last Follow-up Remarks", which the next
// follow-up overwrites.
//
// A close is now its own ledger row, in a category that names whether the money
// came in, carrying the reason and who closed it. The ledger is append-only, so
// the reason survives every later follow-up and payment.
//
// Pure and Firebase-free, so the board, its modals and the tests share one rule.

/** The board's rounding allowance: a balance within one unit of zero is settled. */
export const STEP11_SETTLED_TOLERANCE = 1;

/** A close reason needs at least this many letters or digits — "." is not a reason. */
export const MIN_CLOSE_REASON_CHARS = 5;

const COMPLETED = 'completed';

// What every completeStep ledger row carried before the operator was recorded.
const GENERIC_LEDGER_USER = 'User';

export const STEP11_CLOSE_STATE = Object.freeze({
  OPEN: 'open',
  // Closed, and the invoice value is covered.
  SETTLED: 'settled',
  // Closed by hand: money still owed, or no invoice value to settle against.
  CLOSED_UNSETTLED: 'closed_unsettled',
});

/** Whether the money had come in when the step was closed. */
export const STEP11_CLOSE_MONEY = Object.freeze({
  RECEIVED: 'received',
  NOT_RECEIVED: 'not_received',
  // A close recorded before the close dialog asked.
  UNKNOWN: 'unknown',
});

export const STEP11_CLOSE_MONEY_LABEL = Object.freeze({
  [STEP11_CLOSE_MONEY.RECEIVED]: 'Payment received',
  [STEP11_CLOSE_MONEY.NOT_RECEIVED]: 'Payment not received',
});

/**
 * The ledger category a close is written under, per money status.
 *
 * These are a contract: the board reads them back. They must never contain
 * "Payment", "Advance" or "Discount". The Client Wallet treats a row whose
 * category contains "Payment Received" or "Advance" as money in, and the Step-11
 * totals classify a row by those same words.
 */
export const STEP11_CLOSE_CATEGORY = Object.freeze({
  [STEP11_CLOSE_MONEY.RECEIVED]: 'Step-11 Closed (Money Received)',
  [STEP11_CLOSE_MONEY.NOT_RECEIVED]: 'Step-11 Closed (Money Not Received)',
});

/** Notification button for a close. The engine matches it exactly — import, never retype. */
export const STEP11_CLOSE_BUTTON = 'Close Step-11 (🔒)';

const amountOwed = (step) => Number(step?.pendingAmount) || 0;
const invoiceValue = (step) => Number(step?.ciAmount) || 0;

/**
 * How a Step-11 step object reads: open, settled, or closed without being
 * settled. The step's own status decides whether it is closed at all. Settled
 * needs a known invoice value that is covered: a step closed before its CI
 * amount existed owes nothing on paper, but nobody was paid.
 */
export function step11CloseState(step) {
  if (step?.status !== COMPLETED) return STEP11_CLOSE_STATE.OPEN;
  return invoiceValue(step) > 0 && amountOwed(step) <= STEP11_SETTLED_TOLERANCE
    ? STEP11_CLOSE_STATE.SETTLED
    : STEP11_CLOSE_STATE.CLOSED_UNSETTLED;
}

/**
 * Whether a master-tracker row says Step-11 is closed: its "Step-11 Actual Date"
 * is filled. That is the board's own rule — the transform reads a filled actual
 * date as completed — so a report reading the tracker directly agrees with it.
 */
export const isStep11ClosedOnMasterRow = (row) => Boolean(String(row?.step_11_actual_date ?? '').trim());

/** Why a close cannot be saved yet, or '' when it can. */
export function step11CloseError({ moneyStatus, reason } = {}) {
  if (!STEP11_CLOSE_CATEGORY[moneyStatus]) return 'Choose whether the payment has come in.';
  const letters = String(reason ?? '').replace(/[^\p{L}\p{N}]/gu, '');
  if (letters.length < MIN_CLOSE_REASON_CHARS) {
    return `Write why Step-11 is being closed (at least ${MIN_CLOSE_REASON_CHARS} letters).`;
  }
  return '';
}

const ledgerCategory = (row) =>
  row?.action_category ||
  row?.action_category_options_hold_placed_hold_released_date_extended_payment_received_follow_up_done_step_completed ||
  '';

const ledgerNewValue = (row) => String(row?.new_value || row?.new_value_e_g_nayi_extended_date || '');

/**
 * Which money status a Step-11 ledger row closed the step with, or null when the
 * row did not close it. A row from before the close dialog — a follow-up or a
 * payment whose new status was "completed" — closed it without saying.
 */
export function step11CloseKindOf(row) {
  const category = ledgerCategory(row);
  const kind = Object.keys(STEP11_CLOSE_CATEGORY).find((k) => STEP11_CLOSE_CATEGORY[k] === category);
  if (kind) return kind;
  return ledgerNewValue(row).trim().toLowerCase() === COMPLETED ? STEP11_CLOSE_MONEY.UNKNOWN : null;
}

/** Who wrote a ledger row, or '' when it only carries the old placeholder. */
export function ledgerAuthorOf(row) {
  const by = String(row?.updated_by || row?.updated_by_user_id_ya_name || '').trim();
  return by === GENERIC_LEDGER_USER ? '' : by;
}

/**
 * The newest close among a step's history entries, as the board shows it.
 *
 * `entries` are the Step-11 history entries (newest first, as the board keeps
 * them), each carrying the `closeKind`, `remarks`, `timestamp` and `closedBy`
 * the transform derived from its ledger row. Returns null when nothing closed it.
 */
export function latestStep11Closure(entries = []) {
  const close = (Array.isArray(entries) ? entries : []).find((entry) => entry?.closeKind);
  if (!close) return null;
  return {
    moneyStatus: close.closeKind,
    reason: String(close.remarks || '').trim(),
    at: close.timestamp || null,
    by: close.closedBy || '',
  };
}
