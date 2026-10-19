// VERBATIM COPY of CRM lib/rules/scope.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/scope.js
//
// Is a step inside its cutoff — the housekeeping line that keeps boards and
// reports on current work?
//
// Today each report draws that line for itself, and they disagree: one compares
// the PI's approval date, one the step's planned date, the design board the
// latest thing that happened to the request; one parses '2026-05-13' as UTC
// midnight (05:30 IST), another as IST midnight. Here a step rule names its
// cutoff (`cutoffKey`), the cutoff names the date it is held against (`basis`)
// and when its day starts (`atIstMidnight`), and `boardBypass` says when a board
// keeps showing a row the cutoff would hide.
//
// The Design Approval board asks one more question before any cutoff: is there
// an approved PI behind the row at all (lib/design-visibility.js:35-37)? An
// unapproved or rejected order has no artwork to review, so its design steps are
// out even when no cutoff is set. That gate is applied here to the
// 'designApproval' flow alone; HR-ERP's design steps (exhibition posters, PI-less
// help tickets) are another flow with their own rule. The board shows its own
// help tickets past both the gate and its cutoff — it asks for no PI and draws no
// line (app/(app)/design/approval/page.jsx, "Help tickets bypass the PI gate") —
// so a step whose facts say `isHelpTicket` is in scope by the board's bypass,
// under any rules: board truth, not a rule to edit (NON_CONFIG_DECISIONS #7 in
// lib/rules/decisions-2026-10-10.js).
//
// The boards draw their own line too: boardCutoffOf names the cutoff each board
// hides its older rows behind, so a board and the reports cut on one date —
// IST midnight once the rules say so (decision 7).
//
// Pure — the caller reads the dates off its rows and passes them in.

import { BOARD_BYPASS, CUTOFF, CUTOFF_BASIS, FLOW_DESIGN_APPROVAL } from './contract.js';
import { FLOW } from './names.js';
import { DAY_MS, IST_OFFSET_MS, isoDayToDayNumber, toEpochMs } from './time.js';
import { isPlainObject, ownValue } from './util.js';

/** Why a step is in or out of scope. */
export const SCOPE_REASON = Object.freeze({
  NO_CUTOFF: 'noCutoff',
  ON_OR_AFTER_CUTOFF: 'onOrAfterCutoff',
  BOARD_BYPASS: 'boardBypass',
  BEFORE_CUTOFF: 'beforeCutoff',
  NO_REFERENCE_DATE: 'noReferenceDate',
  NO_APPROVED_PI: 'noApprovedPi',
});

/** The fact that keeps a row on its board under each bypass mode. */
const BYPASS_FACT = new Map([
  [BOARD_BYPASS.HAS_FMS_ROW, 'hasFmsRow'],
  [BOARD_BYPASS.HAS_MASTER_ROW, 'hasMasterRow'],
]);

/**
 * The instant a cutoff day begins.
 *
 * `atIstMidnight: false` reproduces what every report does today,
 * `new Date('YYYY-MM-DD')`: an ISO date alone is UTC midnight, 05:30 in India,
 * so a PI approved at 01:00 IST on the cutoff day falls before it.
 * `atIstMidnight: true` starts the day at 00:00 IST, as the owner decided.
 *
 * @param {string} day  'YYYY-MM-DD'.
 * @param {{ atIstMidnight?: boolean }} [options]
 * @returns {Date|null} null for '' or anything that is not a real date.
 */
export function parseCutoffDay(day, { atIstMidnight = false } = {}) {
  const dayNumber = isoDayToDayNumber(day);
  if (dayNumber === null) return null;
  const utcMidnight = dayNumber * DAY_MS;
  return new Date(atIstMidnight === true ? utcMidnight - IST_OFFSET_MS : utcMidnight);
}

/** The day a cutoff is held at, as the rules hold it ('' for none). */
const cutoffDay = (cutoff) => String(cutoff.date ?? '');

/** The date a cutoff is held against, in epoch ms, or null when the row has none. */
function referenceMs(facts, basis) {
  if (basis === CUTOFF_BASIS.PI_APPROVAL) return toEpochMs(facts.piApprovedAt);
  if (basis === CUTOFF_BASIS.STEP_PLANNED) return toEpochMs(facts.plannedAt);
  if (basis !== CUTOFF_BASIS.LATEST_ACTIVITY) return null;
  const times = (Array.isArray(facts.activityDates) ? facts.activityDates : [])
    .map(toEpochMs)
    .filter((ms) => ms !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

function isKeptByBoard(facts, mode) {
  const fact = BYPASS_FACT.get(mode);
  return Boolean(fact) && facts[fact] === true;
}

/** The Design Approval board shows nothing for a PI that is not approved, cutoff or no cutoff. */
const needsApprovedPi = (stepRule) => stepRule?.flow === FLOW_DESIGN_APPROVAL;

/** ...but its help tickets, which it shows whatever their PI and their dates (see the note at the top). */
const isShownHelpTicket = (facts, stepRule) => needsApprovedPi(stepRule) && facts.isHelpTicket === true;

/**
 * Whether a step is in scope, and why.
 *
 * A row with no date to compare is out once a cutoff is set — the boards drop a
 * PI without an approval date the same way — unless its board keeps it. A
 * 'designApproval' step with no PI approval date is out before any cutoff is
 * looked at, but a help ticket, which the board keeps past both (see the note
 * at the top).
 *
 * @param {object} stepFacts
 * @param {boolean} [stepFacts.isHelpTicket]  a Design Approval help ticket: in scope by the board's bypass.
 * @param {Date|number|string} [stepFacts.piApprovedAt]   basis 'piApproval'; required by
 *   the 'designApproval' flow whatever the basis, but for a help ticket.
 * @param {Date|number|string} [stepFacts.plannedAt]      basis 'stepPlanned'.
 * @param {Array<Date|number|string>} [stepFacts.activityDates]  basis 'latestActivity':
 *   every date that counts as activity (the design board passes the PI's
 *   approval, the request and the submission); the latest one decides.
 * @param {boolean} [stepFacts.hasFmsRow]     the PI has a CRM FMS row.
 * @param {boolean} [stepFacts.hasMasterRow]  the order has a master-tracker row.
 * @param {import('./contract.js').StepRule} stepRule
 * @param {import('./contract.js').Rules} rules
 * @returns {{ inScope: boolean, reason: string }}  reason is a SCOPE_REASON.
 */
export function scopeVerdict(stepFacts, stepRule, rules) {
  const facts = isPlainObject(stepFacts) ? stepFacts : {};
  if (isShownHelpTicket(facts, stepRule)) return { inScope: true, reason: SCOPE_REASON.BOARD_BYPASS };
  if (needsApprovedPi(stepRule) && toEpochMs(facts.piApprovedAt) === null) {
    return { inScope: false, reason: SCOPE_REASON.NO_APPROVED_PI };
  }
  const cutoff = ownValue(rules?.cutoffs, stepRule?.cutoffKey);
  const line = isPlainObject(cutoff) ? parseCutoffDay(cutoffDay(cutoff), cutoff) : null;
  if (!line) return { inScope: true, reason: SCOPE_REASON.NO_CUTOFF };

  const reference = referenceMs(facts, cutoff.basis);
  if (reference !== null && reference >= line.getTime()) {
    return { inScope: true, reason: SCOPE_REASON.ON_OR_AFTER_CUTOFF };
  }
  if (isKeptByBoard(facts, ownValue(rules?.boardBypass, stepRule?.flow))) {
    return { inScope: true, reason: SCOPE_REASON.BOARD_BYPASS };
  }
  return { inScope: false, reason: reference === null ? SCOPE_REASON.NO_REFERENCE_DATE : SCOPE_REASON.BEFORE_CUTOFF };
}

/** Is the step in scope? See scopeVerdict for the reason. */
export const inScope = (stepFacts, stepRule, rules) => scopeVerdict(stepFacts, stepRule, rules).inScope;

/**
 * In scope because a cutoff that is set keeps the step (or its board's
 * bypass does) — not merely because no cutoff is set. A reader that must never
 * widen to every PI ever approved (a buyer chase, the buyer tracker) asks
 * this rather than `inScope`.
 *
 * @param {{ inScope?: boolean, reason?: string }|null|undefined} verdict  A scopeVerdict.
 */
export const isKeptByCutoff = (verdict) => Boolean(verdict?.inScope) && verdict.reason !== SCOPE_REASON.NO_CUTOFF;

/**
 * In scope because its board shows it past the gate or the cutoff that would
 * hide it — a Design Approval help ticket, or a row the rules' boardBypass
 * keeps. A reader that draws a line of its own (a report's PI gate, a step's
 * cutoff held against another date) leaves such a step where its board shows it.
 *
 * @param {{ inScope?: boolean, reason?: string }|null|undefined} verdict  A scopeVerdict.
 */
export const isKeptByItsBoard = (verdict) => verdict?.inScope === true && verdict.reason === SCOPE_REASON.BOARD_BYPASS;

/**
 * A cutoff of the rules, ready to compare against: its day as the rules hold
 * it and the instant that day starts (parseCutoffDay, with the cutoff's own
 * IST-midnight flag). '' and null when the cutoff is not set or its day is not
 * a date — the defaults the rules loader serves after a failed read hold no
 * date, and neither does a Settings date that was cleared.
 *
 * @param {import('./contract.js').Rules} rules
 * @param {string} key  A cutoff key ('crmFms', …).
 * @returns {{ day: string, at: Date|null }}
 */
export function cutoffOf(rules, key) {
  const cutoff = ownValue(rules?.cutoffs, key);
  const day = isPlainObject(cutoff) ? cutoffDay(cutoff) : '';
  const at = day ? parseCutoffDay(day, cutoff) : null;
  return at ? { day, at } : { day: '', at: null };
}

/**
 * Is a cutoff still read by any step of the rules? The SO FMS cutoff is not,
 * once the owner's overlay cuts SO FMS steps by the CRM FMS cutoff (decision
 * 7): Settings then says its date is retired, and no chase holds it any more.
 *
 * @param {import('./contract.js').Rules} rules
 * @param {string} key  A cutoff key.
 */
export function isCutoffInUse(rules, key) {
  const steps = isPlainObject(rules?.steps) ? Object.values(rules.steps) : [];
  return steps.some((rule) => rule?.cutoffKey === key);
}

/**
 * The SO FMS cutoff an SO step's plan is held against, by the two readers that
 * hold that date against the plan rather than the PI's approval: the chase list
 * (lib/pending-chase.js) and the MIS Performance Report (lib/reports/misScope.js).
 * null once no step reads the SO FMS cutoff (decision 7 retires it) — unless
 * no CRM FMS date is set either, so a missing cutoff never widens what they hold.
 *
 * @param {import('./contract.js').Rules} rules
 * @returns {Date|null}
 */
export function soPlanCutoffOf(rules) {
  const isHeld = isCutoffInUse(rules, CUTOFF.SO_FMS) || !cutoffOf(rules, CUTOFF.CRM_FMS).at;
  return isHeld ? cutoffOf(rules, CUTOFF.SO_FMS).at : null;
}

/**
 * The cutoffs each board shows its own rows by, the first the rules hold
 * winning. The CRM FMS and SO FMS boards show a PI — an order, by its PI —
 * approved on or after the CRM FMS date. The Design Approval board reads its
 * own cutoff (the CRM FMS date against the latest of the PI's approval, the
 * request and the submission — lib/design-visibility.js), and the CRM FMS date
 * from rules that do not carry it. The Design Requests board shows a help
 * ticket raised on or after the design request date (its PI rows go by the
 * CRM FMS boards' line).
 */
const BOARD_CUTOFF_KEYS = Object.freeze({
  [FLOW.CRM_FMS]: Object.freeze([CUTOFF.CRM_FMS]),
  [FLOW.SO_FMS]: Object.freeze([CUTOFF.CRM_FMS]),
  [FLOW.DESIGN_APPROVAL]: Object.freeze([CUTOFF.DESIGN_APPROVAL, CUTOFF.CRM_FMS]),
  [FLOW.DESIGN_REQUEST]: Object.freeze([CUTOFF.DESIGN_REQ]),
});

/**
 * The cutoff a board hides its older rows behind, as the rules hold it — its
 * day, and the instant that day starts (IST midnight once the rules say so,
 * decision 7). '' and null for a board with none, or a date not set.
 *
 * @param {import('./contract.js').Rules} rules
 * @param {string} flow  The board's flow: 'crmFms', 'soFms', 'designApproval', 'designRequest'.
 * @returns {{ day: string, at: Date|null }}
 */
export function boardCutoffOf(rules, flow) {
  const keys = BOARD_CUTOFF_KEYS[flow] || [];
  const key = keys.find((name) => isPlainObject(ownValue(rules?.cutoffs, name)));
  return key ? cutoffOf(rules, key) : { day: '', at: null };
}

