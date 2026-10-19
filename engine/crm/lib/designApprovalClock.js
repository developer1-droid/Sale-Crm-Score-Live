// VERBATIM COPY of CRM lib/designApprovalClock.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/designApprovalClock.js
//
// The Design Approval board's step clocks for one row — CRM review, buyer
// response and management approval: planned time, decision, hold and the
// close freeze. Lifted out of app/(app)/design/approval/page.jsx unchanged so
// the page and the MIS step feed (hooks/useMisSteps.js) run the SAME clock and
// a report can never disagree with the board.
//
// Each step's time after its anchor, its calendar and its grace come from the
// rules registry (lib/work-clock.js: rules.steps['designApproval:DA-Sn']); the
// built-in values below are the registry's defaults and run until the rules
// are loaded. The anchors stay the board's own.

import { skipsBuyerApproval } from './designRequestHelpers.js';
import { stepDelayWithHold } from './designApprovalHold.js';
import { MANAGEMENT_STEP_LIVE_AT, requiresManagementApproval, managementAnchorStep } from './designManagementApproval.js';
import { DESIGN_APPROVAL_PROFILE, SLA_MINUTES, parseDT, workingMinutesBetween } from './designApprovalSla.js';
import { CALENDAR, FLOW } from './rules/names.js';
import { isDueToday, stepGraceMin, stepPlannedAt } from './work-clock.js';
import {
  CLOSED_STATUS, clockEndFor, closedAtOf, decisionAt, effectiveStepStatus, historyDecisionAt, isClosedRow, isStepDecided,
} from './designApprovalClose.js';

/* ═══════════════════ THE THREE STEP CLOCKS OF ONE ROW ══════════════════
   PI rows and help-ticket rows differ only in where Step 1's deadline comes
   from before the designer submits, so they share this. They used to carry a
   hand-copied version each, and the copies had already drifted apart on exactly
   the branches that matter here — the closed-row ones.

   Same rule for all three steps: measure from the planned date to the step's
   decision, and when no decision ever landed, to the row's CLOCK END —
   `Closed At` for a closed request, wall clock for a live one. That single
   substitution is what stops a closed request accruing delay forever, and it
   keeps the lateness it earned before the close. See lib/designApprovalClose.js.

   Step calendar: Step 1 = submission + 2 working hours, Step 2 = Step-1 decision
   + 1 working day, Step 3 = its anchor + the configured management hours. */
export const WORKING_DAY_MINS = 480; // 1 working day = 8h (9:30-13:30 + 14:00-18:00)

const MINUTES_PER_HOUR = 60;
const STEP_CODE = Object.freeze({ CRM: 'DA-S1', BUYER: 'DA-S2', MANAGEMENT: 'DA-S3' });

/** A step's plan from its anchor: the registry's time on the board's calendar, the built-in `minutes` until the rules load. */
const planFrom = (code, anchor, minutes) => stepPlannedAt(FLOW.DESIGN_APPROVAL, code, anchor, {
  minutes, calendar: CALENDAR.OFFICE_DA, profile: DESIGN_APPROVAL_PROFILE,
});


const APPROVED = 'Approved';

/**
 * A decision stamped before the step's clock last started belongs to an earlier
 * round: a disapproval sends the design back, and its old 'CRM Disapproved At' /
 * 'Management Approved At' stays on the row while the resubmitted design waits
 * for review again. Counting it closed the new round before it began.
 *
 * An approval the row still carries is not an earlier round. A management light
 * loop sends the design back to the designer but keeps CRM and buyer approved
 * (spec §2.3.1), and nothing asks them again — so their approval stands though
 * the resubmission came after it. Dropping it left 26255-1 reading 43 days
 * overdue on CRM review with all three steps approved.
 */
const decisionSince = (decidedAt, clockStart, status) => {
  if (!decidedAt) return null;
  if (!clockStart || decidedAt >= clockStart || status === APPROVED) return decidedAt;
  return null;
};

/** No management clock starts before the step existed. */
const notBeforeManagementStep = (at) =>
  (at && at < MANAGEMENT_STEP_LIVE_AT ? new Date(MANAGEMENT_STEP_LIVE_AT.getTime()) : at);

export const enrichApprovalRow = (row, { managementPlannedHours, now, plannedFallbackToDueDate = false }) => {
  const submittedAt = parseDT(row.designSubmitted);
  // Help tickets mirror the designer's own due date until the design lands;
  // after that both kinds of row measure CRM against submission + SLA.
  const plannedDate = submittedAt
    ? planFrom(STEP_CODE.CRM, submittedAt, SLA_MINUTES)
    : (plannedFallbackToDueDate ? parseDT(row.designDueAt) : null);

  const isClosed = isClosedRow(row);
  const closedAt = closedAtOf(row);
  // One instant for the whole row: the three delays and the hold subtraction
  // underneath them all stop together, so they cannot disagree.
  const clockEnd = clockEndFor(row, now);
  const stepDelay = (planned, actual, step) =>
    stepDelayWithHold(
      row,
      step,
      planned ? workingMinutesBetween(planned, actual || clockEnd) : null,
      clockEnd
    );
  // A step approved with no time on record anywhere — set by hand, or restored
  // after an old close — is decided all the same. Only how late it was is
  // unknown, so its delay is null (the page's "—"), not a clock still running
  // against a step nobody can act on: 1780476713066's buyer step read 97 days.
  const decidedDelay = (planned, actual, status, step) =>
    (!actual && status === APPROVED ? null : stepDelay(planned, actual, step));

  // ── Step 1: CRM review ──
  // Actual = the CRM decision. `decisionAt` falls back to Version History for
  // rows decided before the 'CRM Approved At' column existed — without it their
  // delay ticks live against an approval that landed months ago.
  const step1Status = effectiveStepStatus(row, 1);
  const step1Approved = step1Status === APPROVED;
  const step1ActualAt = decisionSince(decisionAt(row, 1), submittedAt, step1Status);
  const step1Decided = !!step1ActualAt || step1Approved;
  const delayMins = decidedDelay(plannedDate, step1ActualAt, step1Status, 1);

  // ── Step 2: buyer response ──
  // Planned = Step-1 ACTUAL + 1 working day. Anchoring to the real approval time
  // means the buyer always gets a full working day AFTER the design reaches
  // them; a late CRM approval no longer pushes the buyer's deadline before the
  // approval itself. Our Brand designs skip this step — except Jute / Non-Woven
  // / HDPE packaging, which needs buyer approval like private_label_regular.
  const buyerApprovalNotRequired = skipsBuyerApproval(row.designCategory, row.packagingType);
  const buyerSentAt = step1Approved ? parseDT(row.buyerSentAt) : null;
  const step2Status = effectiveStepStatus(row, 2);
  const step2Approved = step2Status === APPROVED;
  const buyerApprovedAt = decisionSince(decisionAt(row, 2), step1ActualAt, step2Status);
  const step2Decided = !!buyerApprovedAt || step2Approved;
  const s2PlannedDate = (!buyerApprovalNotRequired && step1Approved && step1ActualAt)
    ? planFrom(STEP_CODE.BUYER, step1ActualAt, WORKING_DAY_MINS)
    : null;
  const s2DelayMins = decidedDelay(s2PlannedDate, buyerApprovedAt, step2Status, 2);

  // ── Step 3: management approval ──
  // Required only for private_label_new / private_label_regular. The step is
  // "open" once its upstream approval has happened — CRM approval for regular,
  // buyer approval for new — derived from the approval STATUS, not just a
  // timestamp. Anchor = explicit "Management Sent At" if present, else that
  // upstream approval time; then max'd with the latest resubmission so a redo
  // restarts the SLA.
  //
  // The step went live on 5 Aug 2026. A design approved upstream before then
  // that management never took up — no 'Management Sent At', no decision — has
  // no management step: nobody could approve it at the time, and reading it open
  // charged management with 100+ days on designs finished in May and June
  // (26083, 26088, 26091, 26097, 26101, 26114; 105 rows). A design management
  // did rule on anyway (21 on 6 Aug) keeps its step, clocked from the go-live.
  const mgmtStatus = effectiveStepStatus(row, 3);
  const mgmtApproved = mgmtStatus === APPROVED;
  const mgmtAnchorKind = managementAnchorStep(row.designCategory); // 'crm' | 'buyer' | null
  const mgmtUpstreamApproved = mgmtAnchorKind === 'crm' ? step1Approved
    : mgmtAnchorKind === 'buyer' ? step2Approved
    : false;
  const mgmtUpstreamApproval = mgmtAnchorKind === 'crm'
    ? (step1ActualAt || parseDT(row.approvedAt))
    : mgmtAnchorKind === 'buyer'
    ? buyerApprovedAt
    : null;
  const mgmtSentAt = parseDT(row.managementSentAt);
  const mgmtHasDecision = isStepDecided(row, 3) || !!historyDecisionAt(row, 3);
  const mgmtPredatesStep = mgmtUpstreamApproved && !mgmtSentAt && !mgmtHasDecision
    && (!mgmtUpstreamApproval || mgmtUpstreamApproval < MANAGEMENT_STEP_LIVE_AT);
  const mgmtRequired = requiresManagementApproval(row.designCategory) && !mgmtPredatesStep;
  const mgmtOpen = mgmtRequired && mgmtUpstreamApproved;
  const mgmtBaseAnchor = mgmtSentAt || notBeforeManagementStep(mgmtUpstreamApproval);
  const mgmtAnchor = mgmtBaseAnchor
    ? (submittedAt && submittedAt > mgmtBaseAnchor ? submittedAt : mgmtBaseAnchor)
    : null;
  // The registry's plan carries Settings' management hours (lib/rules/resolve.js
  // lays them over it), so the two agree; `managementPlannedHours` runs until
  // the rules load.
  const mgmtPlannedDate = (mgmtOpen && mgmtAnchor)
    ? planFrom(STEP_CODE.MANAGEMENT, mgmtAnchor, managementPlannedHours * MINUTES_PER_HOUR)
    : null;
  const mgmtApprovedAtDate = decisionSince(decisionAt(row, 3), mgmtAnchor, mgmtStatus);
  const mgmtDecided = !!mgmtApprovedAtDate || mgmtApproved;
  // A design (re)submitted AFTER the management step's base anchor means it came
  // back through the disapprove→redo loop — flagged so the management queue can
  // surface it at the top.
  const mgmtResubmitted = !!(mgmtOpen && submittedAt && mgmtBaseAnchor && submittedAt > mgmtBaseAnchor);
  const mgmtDelayMins = decidedDelay(mgmtPlannedDate, mgmtApprovedAtDate, mgmtStatus, 3);

  return {
    ...row,
    plannedDate,
    delayMins,
    step1Status,
    step1Approved,
    step1Decided,
    step1ActualAt,
    buyerSentAt,
    s2PlannedDate,
    s2DelayMins,
    step2Status,
    step2Approved,
    step2Decided,
    step2ActualAt: buyerApprovedAt,
    buyerApprovalNotRequired,
    isClosed,
    closedAtDate: closedAt,
    clockEndAt: clockEnd,
    // What the status filter matches on: a closed request reads as Closed even
    // though its decided steps keep their own verdicts.
    filterStatus: isClosed ? CLOSED_STATUS : step1Status,
    mgmtRequired,
    mgmtOpen,
    mgmtPlannedDate,
    mgmtOpenedAt: mgmtAnchor,
    mgmtResubmitted,
    mgmtDelayMins,
    mgmtStatus,
    mgmtApproved,
    mgmtDecided,
    step3ActualAt: mgmtApprovedAtDate,
  };
};

/** The page's "On time" band: up to five minutes late still reads on time. */
export const ON_TIME_GRACE_MIN = 5;

const HELP_TICKET = 'help ticket';
/**
 * A help ticket's row ('Request Type' Help Ticket). A help ticket linked to a
 * PI item takes that item's Row ID, so the two rows share it; the ticket's
 * steps are kept apart by their own key. The board shows a help ticket
 * whatever its PI (app/(app)/design/approval/page.jsx), which the step feed
 * follows (lib/step-feed/adapters/design-approval.js).
 */
export const isHelpTicket = (row) => String(row?.requestType || '').trim().toLowerCase() === HELP_TICKET;

/**
 * One feed status from a step's clock, the way the page shows it: a held and
 * undecided step is paused; a decided — or closed — step is done with the
 * delay it earned (none when its decision time was never recorded); otherwise
 * late past the step's grace (the rules', ON_TIME_GRACE_MIN by default) is
 * overdue, and due today on its IST calendar day or before.
 */
function feedClock({ planned, decided, decidedAt, delayMins, held, closedAt, now, graceMin }) {
  const delay = Math.max(0, delayMins ?? 0);
  if (decided || closedAt) return { status: 'DONE', actDate: decidedAt || closedAt || null, delayMin: delay, onTime: delay <= graceMin };
  if (held) return { status: 'HOLD', actDate: null, delayMin: delay, onTime: false };
  if (delay > graceMin) return { status: 'OVERDUE', actDate: null, delayMin: delay, onTime: false };
  return { status: isDueToday(planned, now) ? 'TODAY' : 'UPCOMING', actDate: null, delayMin: 0, onTime: false };
}

/**
 * The feed's Design Approval steps for one row, from the page's own clock:
 * DA-S1 CRM review, DA-S2 buyer response, DA-S3 management approval.
 *
 * @param {object} row   a Design Approval row (GET /api/design-approval)
 * @param {object} opts  { managementPlannedHours, now, isStepHeld, requester, managementOwner }
 */
export function approvalFeedSteps(row, { managementPlannedHours, now, isStepHeld, requester, managementOwner }) {
  const e = enrichApprovalRow(row, { managementPlannedHours, now });
  const closedAt = e.isClosed ? e.closedAtDate : null;
  // A master carton is its own design row ('{PI}-{n}-MC'); it shows as '{PI}-MC'.
  const refBase = row.piNumber || row.rowId || '';
  const daRef = /-mc$/i.test(String(row.rowId || '')) ? `${String(refBase).replace(/-mc$/i, '')}-MC` : refBase;
  const base = {
    indentNo: daRef, piNo: row.piNumber || '', buyerName: row.buyer || '', brand: row.brandName || '',
    tab: 'Design Approval', isClosed: !!e.isClosed, clockFromBoard: true,
  };
  const steps = [
    {
      stepCode: STEP_CODE.CRM, stepName: 'Design Approval — CRM Approval', owner: requester, planned: e.plannedDate,
      decided: e.step1Decided, decidedAt: e.step1ActualAt, delayMins: e.delayMins, step: 1,
      delayReason: row.step1DelayReason || row.delayReason || '',
    },
    {
      stepCode: STEP_CODE.BUYER, stepName: 'Design Approval — Buyer Approval', owner: requester, planned: e.s2PlannedDate,
      decided: e.step2Decided, decidedAt: e.step2ActualAt, delayMins: e.s2DelayMins, step: 2,
      delayReason: row.step2DelayReason || '',
    },
    {
      stepCode: STEP_CODE.MANAGEMENT, stepName: 'Design Approval — Management Approval', owner: managementOwner, planned: e.mgmtPlannedDate,
      decided: e.mgmtDecided, decidedAt: e.step3ActualAt, delayMins: e.mgmtDelayMins, step: 3, delayReason: '',
    },
  ];
  return steps
    .filter((s) => s.planned)
    .map(({ step, decided, decidedAt, delayMins, ...s }) => {
      const graceMin = stepGraceMin(FLOW.DESIGN_APPROVAL, s.stepCode, ON_TIME_GRACE_MIN);
      const clock = feedClock({ planned: s.planned, decided, decidedAt, delayMins, held: isStepHeld(row, step), closedAt, now, graceMin });
      return {
        ...base, ...s,
        id: `${s.stepCode}-${isHelpTicket(row) ? 'HT-' : ''}${row.rowId || daRef}`,
        planDate: s.planned, planned: s.planned.toISOString(),
        actual: clock.actDate ? clock.actDate.toISOString() : '',
        ...clock,
        isHeld: clock.status === 'HOLD',
      };
    });
}
