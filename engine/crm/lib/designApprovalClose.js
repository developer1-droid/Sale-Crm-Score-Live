// VERBATIM COPY of CRM lib/designApprovalClose.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * Closing a design request — what "closed" has to mean to every clock that
 * reads the row.
 *
 * A close is an abandonment: the buyer never came back, the order moved on, the
 * request is dead. Nobody can act on it again, so no step's delay may keep
 * growing past the moment it was closed. The lateness earned BEFORE the close is
 * real and stays on the record; every minute after it is noise.
 *
 * That is one rule, but it was being re-derived in a dozen places — the approval
 * screen, Design Report, Design Analytics, PC Report (three separate copies),
 * the MIS step feed, the designer and CRM scorecards, the pending digest — and
 * each copy had its own idea of what "closed" looks like on a row. This module is
 * the single answer, and it deliberately answers three questions:
 *
 *   isClosedRow(row)      — is this request closed at all?
 *   closedAtOf(row)       — when? (the freeze instant)
 *   clockEndFor(row, now) — what should any delay measure UP TO?
 *
 * `clockEndFor` is the one every delay calculation wants: `closedAt` when the
 * request is closed, wall-clock `now` when it is still live. Swapping a bare
 * `new Date()` for it is the whole fix at most call sites.
 *
 * ── Why the status columns cannot be trusted alone ──────────────────────────
 * Closing used to overwrite `Approval Status` / `Buyer Approval Status` /
 * `Management Approval Status` with 'Closed', which destroyed the record of
 * steps that had ALREADY been decided. A request approved by CRM on 21 May and
 * closed on 8 July came back reading "step 1 never decided, 331 hours late" —
 * the close inflated CRM's delay by the entire buyer wait, and every gate that
 * tests for the string 'Approved' (SO-FMS Step-0, the PI tracker) went dead.
 * So the close no longer touches a decided step, and closed-ness is detected
 * from `Closed At` first. `decisionAt` exists for the rows already damaged: it
 * recovers a step's real decision time from Version History when the dedicated
 * timestamp column is empty.
 */

import { parseDT, workingMinutesBetween } from './designApprovalSla.js';

export const CLOSED_STATUS = 'Closed';

/** Sheet columns a close writes. */
export const CLOSE_COLUMNS = {
  closedAt: 'Closed At',
  closedBy: 'Closed By',
  reason: 'Close Reason',
};

/** `Design Work Status` value a close parks the designer queue at. */
export const CLOSED_WORK_STATUS = 'closed';

/** Per-step columns, so callers stop hardcoding which name belongs to which step. */
export const STEP_COLUMNS = {
  1: { status: 'Approval Status', approvedAt: 'CRM Approved At', disapprovedAt: 'CRM Disapproved At', history: 'CRM' },
  2: { status: 'Buyer Approval Status', approvedAt: 'Buyer Approved At', disapprovedAt: '', history: 'Buyer' },
  3: { status: 'Management Approval Status', approvedAt: 'Management Approved At', disapprovedAt: '', history: 'Management' },
};

/** UI-row (camelCase) counterparts of the same fields. */
const STEP_FIELDS = {
  1: { status: 'approvalStatus', approvedAt: 'crmApprovedAt', disapprovedAt: 'crmDisapprovedAt' },
  2: { status: 'buyerApprovalStatus', approvedAt: 'buyerApprovedAt', disapprovedAt: '' },
  3: { status: 'managementApprovalStatus', approvedAt: 'managementApprovedAt', disapprovedAt: '' },
};

/** A step nobody has decided yet — the only kind a close may stamp 'Closed'. */
export const DECIDED_STEP_STATUSES = ['Approved', 'Disapproved'];

const str = (v) => String(v ?? '').trim();
/** Sheet text is hand-touched often enough that case is not a promise. */
const sameStatus = (a, b) => str(a).toLowerCase() === str(b).toLowerCase();

/** Rows reach this module in two shapes: sheet-header keys and UI camelCase. */
const readField = (row, column, field) => {
  if (!row) return '';
  const byField = field ? str(row[field]) : '';
  if (byField) return byField;
  return column ? str(row[column]) : '';
};

export const rawClosedAt = (row) => readField(row, CLOSE_COLUMNS.closedAt, 'closedAt');

/** When the design currently on the row was (re)submitted. */
export const lastSubmittedAt = (row) =>
  parseDT(readField(row, 'Design Submitted At', 'designSubmitted'));

/** The freeze instant, or null when the request is still live. */
export const closedAtOf = (row) => parseDT(rawClosedAt(row));

export const stepStatusOf = (row, step) =>
  readField(row, STEP_COLUMNS[step]?.status, STEP_FIELDS[step]?.status);

export const isStepDecided = (row, step) =>
  DECIDED_STEP_STATUSES.some((s) => sameStatus(s, stepStatusOf(row, step)));

/**
 * Is this request closed?
 *
 * `Closed At` is the primary signal — it is the only one a close cannot lose.
 * The status columns and `Design Work Status` are still honoured so rows closed
 * before this module existed (which have 'Closed' written over their statuses)
 * are recognised too.
 */
export const isClosedRow = (row) => {
  if (!row) return false;
  if (rawClosedAt(row)) return true;
  if (sameStatus(readField(row, 'Design Work Status', 'designWorkStatus'), CLOSED_WORK_STATUS)) return true;
  return [1, 2, 3].some((step) => sameStatus(stepStatusOf(row, step), CLOSED_STATUS));
};

/**
 * What every delay on this row must measure up to: the close instant once it is
 * closed, wall-clock `now` while it is live. A closed row with no parseable
 * `Closed At` falls back to `now` rather than erasing its delay — losing the
 * lateness a step genuinely earned would be a worse lie than showing it.
 */
export const clockEndFor = (row, now = new Date()) => {
  if (!isClosedRow(row)) return now;
  return closedAtOf(row) || now;
};

/**
 * A step's decision timestamp — the column when it is stamped, else the entry
 * Version History kept. Legacy rows were decided before the dedicated timestamp
 * columns existed, and without this fallback their delay ticks live forever
 * against a decision that actually landed months ago.
 */
export const decisionAt = (row, step) => {
  const cols = STEP_COLUMNS[step];
  const fields = STEP_FIELDS[step];
  if (!cols) return null;
  const direct =
    parseDT(readField(row, cols.approvedAt, fields.approvedAt)) ||
    parseDT(readField(row, cols.disapprovedAt, fields.disapprovedAt));
  if (direct) return direct;
  // No status guard: Version History only ever records decisions that actually
  // happened, and on a row damaged by an older close the status column is the
  // very thing that was lost. It must still be the decision on the design that
  // is on the row NOW — see supersededHistoryDecision.
  return supersededHistoryDecision(row, step) ? null : historyDecisionAt(row, step);
};

/**
 * Was the verdict Version History remembers overtaken by a redo?
 *
 * A disapproval sends the request back to the designer, and the resubmission
 * clears the step's status column — the step is genuinely undecided again, so a
 * close legitimately stamps 'Closed' on it. History, however, still holds the
 * old disapproval, and reading it back turns a closed step into a disapproved
 * one. Row 26211-2 is the case: the buyer disapproved on 27 Jul 11:36, the
 * designer resubmitted at 17:34 and the buyer never answered again, so closing
 * on 29 Aug made Step 2 read "Disapproved" — a verdict nobody gave on this
 * design. A decision older than the design it judged is stale; a decision made
 * after the last resubmission still stands.
 */
export const supersededHistoryDecision = (row, step) => {
  const decidedAt = historyDecisionAt(row, step);
  if (!decidedAt) return false;
  const submittedAt = lastSubmittedAt(row);
  return !!submittedAt && submittedAt > decidedAt;
};

/** Parsed Version History, newest last. Bad JSON is history we do not have. */
export const parseVersionHistory = (row) => {
  const raw = readField(row, 'Version History', 'versionHistory');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** When Version History says `step` was decided — the latest such entry. */
export const historyDecisionAt = (row, step) => {
  const label = STEP_COLUMNS[step]?.history;
  if (!label) return null;
  const hit = parseVersionHistory(row)
    .filter((e) => sameStatus(e?.step, label) && DECIDED_STEP_STATUSES.some((s) => sameStatus(s, e?.status)))
    .pop();
  return hit ? parseDT(hit.timestamp) : null;
};

/** What Version History says the step's status was, ignoring the close. */
export const historyStatusOf = (row, step) => {
  const label = STEP_COLUMNS[step]?.history;
  if (!label) return '';
  const hit = parseVersionHistory(row)
    .filter((e) => sameStatus(e?.step, label) && DECIDED_STEP_STATUSES.some((s) => sameStatus(s, e?.status)))
    .pop();
  return hit ? str(hit.status) : '';
};

/**
 * The step's verdict as it should read. Normally the column; for a row whose
 * status was overwritten by an older close, whatever Version History recorded
 * before that close. Restores 'Approved' / 'Disapproved' on the damaged rows so
 * the screen tells the truth even before the sheet is repaired.
 */
export const effectiveStepStatus = (row, step) => {
  const status = stepStatusOf(row, step);
  if (!sameStatus(status, CLOSED_STATUS)) return status;
  if (supersededHistoryDecision(row, step)) return status;
  return historyStatusOf(row, step) || status;
};

/**
 * Working minutes a step is late by: planned → its decision, or planned → the
 * clock end when no decision ever landed. `null` when the step's clock never
 * started, which callers render as "—" rather than "on time".
 */
export const stepDelayMinutes = ({ planned, actual, row, now = new Date() }) => {
  if (!planned) return null;
  return workingMinutesBetween(planned, actual || clockEndFor(row, now));
};
