// VERBATIM COPY of CRM lib/telex-ack.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/telex-ack.js
// "Proceed upon Acknowledgement" — the third management decision on SO-FMS
// Step-13 (Telex Management Approval).
//
// Why it exists: management is often willing to release the telex BEFORE the
// accounts team has confirmed the buyer's payment. Approving there and then
// would release the telex against unconfirmed money; rejecting would be wrong
// too. So a middle state exists: management acknowledges, the CRM who raised the
// request is told that the release will proceed once accounts confirm, the
// Step-13 clock is PARKED (a wait on accounts is not the CRM's or management's
// delay), and the approval request is put back in front of management the moment
// accounting confirms the payment.
//
// Everything here is pure and Firebase-free so both the board and the API routes
// share one definition of the state machine (and it is unit-tested).

import { addWorkingMinutes, workingMinutesBetween, parseSoDate } from './so-working-hours.js';

/* ------------------------------ State machine ----------------------------- */

// Written to the master tracker's "Step-13 Status" column. 'pending' /
// 'requested' / 'completed' / 'rejected' already existed; 'acknowledged' is new.
export const TELEX_STATUS = {
  PENDING: 'pending',
  REQUESTED: 'requested',
  ACKNOWLEDGED: 'acknowledged',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
};

// The master tracker has no spare Step-13 column, so the park is expressed with
// the columns that already exist: Status = 'acknowledged' + Hold Status = 'Yes'
// (the latter is what the pending digest and the buyer tracker already read as
// "this step is paused").
export const TELEX_HOLD_YES = 'Yes';

// Lifecycle of the Firestore ack record (see lib/telex-ack-store.js).
export const ACK_PARKED = 'awaiting_payment_confirmation';
export const ACK_RELEASED = 'released';

// buttonName strings are matched by EXACT equality in the notification engine —
// emoji and spacing included. Never retype these; import them.
export const TELEX_RAISE_BUTTON = 'Raise Telex Release (👑)';
export const TELEX_APPROVE_BUTTON = 'Approve Telex Release (👑)';
export const TELEX_REJECT_BUTTON = 'Reject Telex Release (👑)';
export const TELEX_ACK_BUTTON = 'Proceed upon Acknowledgement';
export const TELEX_RERAISE_BUTTON = 'Telex Approval Reminder — Payment Confirmed';

export const TELEX_RAISE_SLUG = 'fms-telex-raised';
export const TELEX_ACK_SLUG = 'fms-telex-acknowledged';
export const TELEX_RERAISE_SLUG = 'fms-telex-reraise';

// Presets whose message carries the secure approve/reject/ack links.
export const TELEX_LINK_SLUGS = [TELEX_RAISE_SLUG, TELEX_RERAISE_SLUG];
export const TELEX_LINK_BUTTONS = [TELEX_RAISE_BUTTON, TELEX_RERAISE_BUTTON];

const norm = (v) => String(v ?? '').trim().toLowerCase();

export const isTelexAcknowledged = (status) => norm(status) === TELEX_STATUS.ACKNOWLEDGED;

export const isTelexDecided = (status) =>
  norm(status) === TELEX_STATUS.COMPLETED || norm(status) === TELEX_STATUS.REJECTED;

// The CRM may raise (or re-raise) a telex only when one isn't already sitting
// with management. A rejected request can be re-raised; an acknowledged one is
// already live and must NOT invite a duplicate raise.
export const canRaiseTelex = (status) =>
  ![TELEX_STATUS.REQUESTED, TELEX_STATUS.ACKNOWLEDGED, TELEX_STATUS.COMPLETED].includes(norm(status));

// Management can acknowledge only a live request that is not already parked.
export const canAcknowledgeTelex = (status) => norm(status) === TELEX_STATUS.REQUESTED;

// Statuses for which the Step-13 management cell renders its decision box.
export const TELEX_ACTIONABLE_STATUSES = [
  TELEX_STATUS.REQUESTED,
  TELEX_STATUS.ACKNOWLEDGED,
  TELEX_STATUS.COMPLETED,
  TELEX_STATUS.REJECTED,
];

export const isTelexActionable = (status) => TELEX_ACTIONABLE_STATUSES.includes(norm(status));

/* ------------------------------ Money snapshot ---------------------------- */

// "Step-13 CI Details" holds the per-CI breakdown the telex request was raised
// on: the ONE Step-13 column that survives a refresh and still carries the whole
// money picture (amount / payments / advance / discount / pending / pending
// confirmation). Everything else the raise computes lives only in that browser
// session, so this is what later surfaces read back.
export function parseCiDetails(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const sumBy = (rows, key) => rows.reduce((total, r) => total + (Number(r?.[key]) || 0), 0);

export function telexFigures(rawCiDetails) {
  const rows = parseCiDetails(rawCiDetails);
  return {
    ciAmount: sumBy(rows, 'ciAmount'),
    paid: sumBy(rows, 'paymentsReceived'),
    advance: sumBy(rows, 'advance'),
    discount: sumBy(rows, 'discount'),
    outstanding: sumBy(rows, 'pending'),
    pendingConfirm: sumBy(rows, 'pendingConfirm'),
  };
}

// Below this, a figure is rounding noise, not money. Same threshold the telex
// modal uses for `hasPendingConfirm`.
const MONEY_EPSILON = 0.01;

// "Accounts have not confirmed this money yet" — either a SWIFT is sitting
// unconfirmed, or the invoice simply isn't paid off. Both are cases where
// management may want to acknowledge instead of approving outright.
export function telexAwaitsAccounts(rawCiDetails) {
  const f = telexFigures(rawCiDetails);
  return f.pendingConfirm > MONEY_EPSILON || f.outstanding > MONEY_EPSILON;
}

/* -------------------- Figures when the accounts team confirms -------------- */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// A parked request keeps its figures as display text, written by
// lib/format-money: "$115,125.00", "-$26.70", "₹1,15,125.00". Read one back.
export function moneyFromText(text) {
  const n = parseFloat(String(text ?? '').replace(/−/g, '-').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// The wallet may write a CI as "HRES260301" where the board writes
// "HR/ES/26/0301", so carry-forwards are matched on letters and digits only.
const looseCi = (ci) => String(ci ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Advance allocated to one CI by hand, from /api/client-wallet?type=carryforwards. */
export function allocatedAdvanceForCi(carryForwardByCi = {}, ciNo = '') {
  const want = looseCi(ciNo);
  if (!want) return 0;
  return round2(Object.entries(carryForwardByCi || {})
    .filter(([ci]) => looseCi(ci) === want)
    .reduce((sum, [, amount]) => sum + (parseFloat(amount) || 0), 0));
}

/**
 * The CI's figures at the moment the accounts team confirms its payment.
 *
 * A parked request holds the figures it was raised on, before that payment was
 * confirmed. Sending those back told management "Payment Confirmed" beside
 * "Payments Received $0.00" (HR/ES/26/0301, 9 Oct 2026). Here the confirmed
 * payments and the advance allocated to the CI are the live ones; the CI amount,
 * discount and the CRM's other charges are the raise's.
 *
 * At the raise, the buyer's unallocated advance covered what the invoice still
 * needed. The confirmed payment now covers part of that, so the advance covers
 * only what is left (the passbook rule, lib/advance-pool.js).
 *
 * @param {object} input
 * @param {{ciAmount: number, paid: number, advance: number, discount: number, outstanding: number}} input.raised
 *   Figures the request was raised on. `outstanding` includes the CRM's charges.
 * @param {number} input.paid  Payments accounts have confirmed on the CI.
 * @param {number} input.allocated  Advance allocated to the CI by hand, now.
 * @returns {{ciAmount: number, paid: number, advance: number, discount: number, outstanding: number}}
 */
export function releasedTelexFigures({ raised, paid = 0, allocated = 0 }) {
  const { ciAmount, discount } = raised;
  const charges = Math.max(0, raised.outstanding - (ciAmount - raised.paid - raised.advance - discount));
  const fromPoolThen = Math.max(0, raised.advance - allocated);
  const stillNeeded = ciAmount - paid - allocated - discount;
  const advance = round2(allocated + Math.min(fromPoolThen, Math.max(0, stillNeeded)));
  const owed = ciAmount - paid - advance - discount + charges;
  return {
    ciAmount: round2(ciAmount),
    paid: round2(paid),
    advance,
    discount: round2(discount),
    outstanding: Math.abs(owed) < MONEY_EPSILON ? 0 : round2(owed),
  };
}

/* --------------------- Accounts confirmation for one CI ------------------- */

// Mirror of GET /api/client-wallet?type=ci-summary, narrowed to a single CI, so
// a server route can answer "have accounts confirmed this invoice?" from the
// same merged collection rows the wallet and the telex modal use.
export function ciPaymentSummary(rows = [], ciNo = '') {
  const want = String(ciNo || '').trim().toUpperCase();
  const summary = { confirmedPayments: 0, pendingPayments: 0 };
  if (!want) return summary;
  for (const r of rows) {
    if (String(r?.ciNo || '').trim().toUpperCase() !== want) continue;
    if (!/payment/i.test(String(r?.category || ''))) continue;
    const amt = Number(r?.amount) || 0;
    if (r?.status === 'pending') summary.pendingPayments += amt;
    else if (r?.status === 'confirmed') summary.confirmedPayments += amt;
  }
  return summary;
}

// Accounts have confirmed when money HAS come in and nothing is left pending.
// A CI with no payment at all is NOT confirmed — that distinction is the bug in
// the raise modal's `telexPaymentConfirmed` flag, which reads "Yes" when there is
// simply nothing to confirm.
export function isCiAccountsConfirmed({ confirmedPayments = 0, pendingPayments = 0 } = {}) {
  return Number(pendingPayments) <= MONEY_EPSILON && Number(confirmedPayments) > MONEY_EPSILON;
}

/* ------------------------------ Clock parking ---------------------------- */

// Step-13's SLA: the CRM's telex submission + 1 working hour. Duplicated across
// the board, pc-report, the MIS feed and here — this is the server-side copy.
export const TELEX_SLA_WORKING_MINUTES = 60;

export function telexPlannedFrom(formTimestamp) {
  const raised = parseSoDate(formTimestamp);
  return raised ? addWorkingMinutes(raised, TELEX_SLA_WORKING_MINUTES) : null;
}

// The delay to FREEZE at the moment of acknowledgement. Everything after this
// instant is a wait on the accounts team, so it must not accrue: the board reads
// this stored value back instead of recomputing against the wall clock.
export function frozenTelexDelayHours(formTimestamp, now = new Date()) {
  const planned = telexPlannedFrom(formTimestamp);
  if (!planned || now <= planned) return 0;
  return Math.max(0, Math.floor(workingMinutesBetween(planned, now) / 60));
}

/* ------------------------- Management message blocks --------------------- */

// The acknowledgement call-to-action is offered ONLY while accounts have not
// confirmed the payment — once they have, there is nothing to acknowledge and
// management should simply approve. Template substitution is single-pass and
// cannot branch, so (exactly like {{telexPaymentStatusHtml}}) the whole block is
// built here and rendered through one variable.
export function buildAckBlocks({ ackUrl = '', paymentConfirmed = false } = {}) {
  if (!ackUrl || paymentConfirmed) return { ackUrl: '', telexAckLine: '', telexAckHtml: '' };
  return {
    ackUrl,
    telexAckLine:
      `🕓 *PROCEED UPON ACKNOWLEDGEMENT:* ${ackUrl}\n` +
      `(Choose this if you are willing to proceed once the accounts team confirms the payment. ` +
      `The telex is NOT released yet — the approval request will come back to you the moment the payment is confirmed.)`,
    telexAckHtml:
      `<table style="border-collapse:collapse;margin:0 0 12px;"><tr><td>` +
      `<a href="${ackUrl}" style="display:inline-block;background:#b45309;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 22px;border-radius:8px;font-size:14px;">🕓 Proceed upon Acknowledgement</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 14px;font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;">` +
      `Choose <b>Proceed upon Acknowledgement</b> if you are willing to proceed once the accounts team confirms the payment. ` +
      `The telex is <b>not</b> released yet: the Step-13 clock is paused and this approval request returns to you as soon as the payment is confirmed.</p>`,
  };
}

// Default remark stored against the park when management adds none.
export const TELEX_ACK_DEFAULT_REMARK =
  'Acknowledged by management — to proceed once the accounts team confirms the payment.';
