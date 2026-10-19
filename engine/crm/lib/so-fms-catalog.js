// VERBATIM COPY of CRM lib/so-fms-catalog.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/so-fms-catalog.js
//
// What the SO FMS board's fourteen steps ARE, and which of their values the
// master sheet has no column for.
//
// Lifted out of app/(app)/pi/sofms/page.jsx unchanged. Two kinds of fact live
// here, and they belong together because they answer the same question — what
// does a step carry, and where does that value actually come from:
//
//   * the step catalogue (SO_STEPS) and the photo fields the packing form
//     captures, which the board renders and the transform reads;
//   * the sets naming the steps whose remark, delay reason, delay hours or
//     extended date has NO column on the master tracker. Those values are
//     written to the history ledger and read back from it; without these sets
//     the cell silently reads "-" one refresh after the operator filled it in.
//
// Neither touches React. They are here so the transform can be imported —
// and eventually run — outside the browser.

import { dutyHolder } from './rules/duties.js';
import { DEFAULT_DUTIES, DUTY } from './rules/owners-default.js';
import { parseDayFirstDT } from './so-fms-datetime.js';

// Every packing PHOTO the buyer form captures, in display order. Each entry maps a
// packing-data field (set by /api/packing-data) to a human label used both in the
// Step-3 table and in the single merged "all packing images" PDF sent on WhatsApp
// /email. Videos are handled separately (they can't be embedded in that PDF).
export const PACKING_PHOTO_FIELDS = [
  ["frontImage", "Front"],
  ["backImage", "Back"],
  ["sealingImage", "Sealing / Stitching"],
  ["gussetImage", "Bottom Gusset"],
  ["innerImage", "Inner"],
  ["kantaEmptyImage", "Kanta (Empty Bag)"],
  ["kantaFilledImage", "Kanta (Filled Bag)"],
  ["labelingImage", "Labeling"],
];

// Kanta (weighing-scale) photos are captured and stored, but the buyer does NOT
// need them — they are EXCLUDED from the single merged "all packing images" PDF
// that goes out on WhatsApp/email (manual Combined-PDF button + the auto
// {{mergedPackingImagesPdf}} attachment). Every other photo (packing + cooking
// images) is still shared.
export const MERGE_EXCLUDED_PACKING_FIELDS = new Set(["kantaEmptyImage", "kantaFilledImage"]);

// Step-0 (Order Scheduled) is operations scheduling, not the PI's CRM. The
// registry's order scheduling duty names its person (lib/rules/owners-default.js);
// the step feed reads the duty from the resolved rules, this is its default.
export const ORDER_SCHEDULING_OWNER = DEFAULT_DUTIES[DUTY.ORDER_SCHEDULING].people[0].name;

const ORDER_SCHEDULED_KEY = 'orderScheduled';

/** Step-0's column name, naming whoever holds the order scheduling duty; no name, no brackets. */
function orderScheduledStepName(holderName) {
  const name = String(holderName ?? '').trim();
  return name ? `Step-0: ORDER SCHEDULED (${name})` : 'Step-0: ORDER SCHEDULED';
}

// Each step's name as the reports and the pending-work digest print it.
export const SO_STEP_LABELS = Object.freeze({
  orderScheduled: 'Order Scheduled', step1: 'Share Preshipment Drafts',
  step2: 'Buyer Approval - Preshipment Drafts', step3: 'Share Packing / Cooking Images',
  step4: 'Production / Dispatch Update', step5: 'Expected ETD / ETA',
  step6: 'Update Final ETD / ETA', step7: 'Container Stuffing',
  step8: 'SOB Confirmation', step9: 'Share Final Docs Scan',
  step10: 'Cargo-X', step11: 'Request Payment',
  step11_5: 'Accounts Confirmation', step12: 'Update Arrival',
  step13: 'Telex Management Approval', step14: 'Take Feedback',
});

// Step definitions. orderScheduled needs custom 6-column layout.
export const SO_STEPS = [
  { key: ORDER_SCHEDULED_KEY, name: orderScheduledStepName(ORDER_SCHEDULING_OWNER), shortName: "Sched", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Dispatch Date", "Action"] },
  { key: "step1", name: "Step-1: SHARE PRESHIPMENT DRAFTS", shortName: "Drafts", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Action"] },
  { key: "step2", name: "Step-2: BUYER APPROVAL — PRE-SHIPMENT DRAFTS", shortName: "Buyer Appr.", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Remarks", "Action"] },
  { key: "step3", name: "Step-3: SHARE PACKING IMAGES / COOKING IMAGES", shortName: "Packing", subheaders: ["Planned", "Actual", "First Pkg", "First Image (F/B)", "Last Pkg", "Last Image (F/B)", "Delay", "Delay Reason", "Remarks", "Action"] },
  { key: "step4", name: "Step-4: PRODUCTION/DISPATCH UPDATE", shortName: "Dispatch", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Expected Dispatch", "First Dispatch", "Last Dispatch", "Dispatched / Ordered"] },
  { key: "step5", name: "Step-5: EXPECTED ETD/ETA", shortName: "Shipment", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Expected ETD", "Expected ETA", "Action"] },
  { key: "step6", name: "Step-6: UPDATE FINAL ETD/ETA", shortName: "Final Ship", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Final ETD", "Final ETA", "Action"] },
  { key: "step7", name: "Step-7: SHARE CONTAINER STUFFING", shortName: "Stuffing", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Action"] },
  { key: "step8", name: "Step-8: SOB CONFIRMATION", shortName: "SOB", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Action"] },
  { key: "step9", name: "Step-9: SHARE FINAL DOCS SCAN", shortName: "Docs Scan", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "CI Amount", "Action"] },
  { key: "step10", name: "Step-10: CARGO - X (Egypt Only)", shortName: "Cargo-X", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Batch/Expiry", "Document", "Action"] },
  { key: "step11", name: "Step-11: REQUEST PAYMENT", shortName: "Req. Pay", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Arrival / Financials", "Action"] },
  { key: "step11_5", name: "Step-11.5: ACCOUNTS CONFIRMATION", shortName: "Acc. Conf", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Action"] },
  { key: "step12", name: "Step-12: UPDATE ARRIVAL", shortName: "Arrival", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Action"] },
  { key: "step13", name: "Step-13: TELEX MANAGEMENT APPROVAL", shortName: "Telex Mgmt", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Action"] },
  { key: "step14", name: "Step-14: TAKE FEEDBACK", shortName: "Feedback", subheaders: ["Planned", "Actual", "Delay", "Delay Reason", "Action"] },
];

/**
 * The steps as the board shows them, Step-0 naming whoever the rules put on
 * the order scheduling duty (lib/rules/duties.js dutyHolder) — today's
 * scheduler until the board has its rules — so an edit to the duty list
 * reaches the board's own column header, as it reaches every chase and score.
 *
 * @param {object|null} rules  The rules the board holds (hooks/useWorkCalendar.js `rules`).
 */
export function soStepsFor(rules) {
  const name = orderScheduledStepName(dutyHolder(rules, DUTY.ORDER_SCHEDULING).name);
  return SO_STEPS.map((step) => (step.key === ORDER_SCHEDULED_KEY ? { ...step, name } : step));
}

// Valid step keys, for telling a step key apart from a display label. The
// "Current Active Step" column holds both (the hold modal writes a key, every
// step completion writes a shortName), and a label read as a key resolves to
// index -1 — which the hold propagation used to treat as "every step is held".
export const SO_STEP_KEYS = new Set(SO_STEPS.map((s) => s.key));

// Per-order notification mute. The state is one master-tracker column and the
// board is its only reader/writer, so the sheet header and the normalized key it
// folds onto are named once here.
export const MUTE_COLUMN_HEADER = "Notifications Muted";
export const MUTE_COLUMN_KEY = "notifications_muted";
export const MUTED_VALUE = "Yes";
export const UNMUTED_VALUE = "No";

// Steps whose remark has NO column on the master sheet. Their note is recorded on
// the history ledger under the step's short name and read back from there, so the
// Remarks cell shows what the operator typed instead of "-" after a refresh.
export const REMARKLESS_STEPS = new Set(['step1', 'step4', 'step5', 'step6', 'step7', 'step8', 'step10']);


// Steps with NO Delay Reason column. The reason the operator types is written to
// the history ledger (it always was) and read back from there.
export const DELAY_REASONLESS_STEPS = new Set(['step11', 'step11_5', 'step12', 'step13']);

// Steps with NO Extended Date column. Step-11.5 is the only one; its extension
// lives on the ledger row the Extend modal writes.
export const EXTENDED_DATELESS_STEPS = new Set(['step11_5']);

// dispatchDate → the Step-0 Planned override: that date at 18:00:00 local, as ISO.
// Returns null when the input is empty or unparseable. Single source of truth shared
// by the soData planned override and the schedule-change history entry.
export const dispatchToPlannedISO = (dispatchDate) => {
  if (!dispatchDate) return null;
  const dd = parseDayFirstDT(dispatchDate);
  if (!dd || isNaN(dd.getTime())) return null;
  const planned18 = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate(), 18, 0, 0);
  return planned18.toISOString();
};
