// VERBATIM COPY of CRM lib/reports/misScope.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/reports/misScope.js
//
// Which steps of the MIS feed (hooks/useMisSteps.js) the MIS Performance Report
// counts, and which of them fall in a period.
//
// The KPI cards held a PI's steps to an approved PI and cut SO FMS and Tickets
// at their module cutoffs, while the step table, the doer cards, the detail
// table and the CSV read the feed as it came — so the tables summed to more
// than the KPIs above them. Every view now starts from misCountedSteps(), and
// the KPIs and the detail table share inMisPeriod().
//
// The SO FMS and ticket gates draw the report rules' lines, as every other
// reader does (lib/rules/scope.js): an SO step's plan against the SO FMS
// cutoff while a step still reads it (soPlanCutoffOf; decision 7 retires it),
// a ticket against its own step's cutoff (deptPerformance.js isBeforeCutoff),
// each at IST midnight once the rules say so. Without the rules — before they
// load, or when they cannot be read — Settings' dates stand, at UTC midnight,
// as the report always read them.
//
// Pure: steps in, steps out.

import { normPi } from '../pending-chase.js';
import { isKeptByItsBoard, parseCutoffDay, soPlanCutoffOf } from '../rules/scope.js';
import { collapseCiSiblings } from '../so-fms-step-feed.js';
import { isBeforeCutoff } from './deptPerformance.js';

/* The feed's tabs (hooks/useMisSteps.js DEPARTMENTS), and the legacy board it leaves out. */
const CRM_FMS_TAB = 'CRM FMS';
const SO_FMS_TAB = 'SO FMS';
const DESIGN_APPROVAL_TAB = 'Design Approval';
const TICKETS_TAB = 'Tickets';
const LEGACY_DESIGN_TAB = 'Design';

const DONE = 'DONE';

/**
 * The legacy Design board's D1/D2 (/api/pc-report's 'Design' tab) are no one's
 * score. They are read from 'Buyer Sent At' and 'Approved At', columns the
 * Design Requests sheet does not have, so every buyer-approved design came out
 * as a D2 done on time with no plan; D1 ran on the optional 'Deadline' under
 * the requester; and the buyer's approval is the Design Approval board's DA-S2
 * already. The MIS feed leaves them out, and so does the Process Coordinator
 * lens (lib/scoring/crmExecScore.js).
 */
export const isLegacyDesignStep = (step) => step.tab === LEGACY_DESIGN_TAB;

/** Boards whose steps belong to a PI: they count only while it is approved. */
const PI_BOARDS = new Set([CRM_FMS_TAB, SO_FMS_TAB, DESIGN_APPROVAL_TAB]);

const refDate = (step) => step.planDate || step.actDate || null;
// A step with neither a plan nor an actual is before no cutoff.
const isBefore = (date, cutoff) => !!date && !!cutoff && date < cutoff;

function isOnApprovedPi(step, piApprovedSet) {
  if (!PI_BOARDS.has(step.tab)) return true;
  // A step its board shows past the PI gate counts as the board shows it: a
  // Design Approval help ticket, with a PI or none (lib/rules/scope.js).
  if (isKeptByItsBoard(step.scope)) return true;
  // Keyed on the PI itself: an SO step's indentNo is its SO or CI number, and a
  // master carton's reads '26164-MC'.
  const key = normPi(step.piNo || step.indentNo);
  return !!key && piApprovedSet.has(key);
}

/**
 * The SO FMS and ticket gates: the rules' lines when the report has them, else
 * Settings' days at UTC midnight (see the note at the top).
 */
function gatesOf(rules, cutoffDates) {
  if (rules) {
    return { soLine: soPlanCutoffOf(rules), isTicketCut: (step) => isBeforeCutoff(step, rules) };
  }
  const ticketLine = parseCutoffDay(String(cutoffDates?.designReq ?? '').trim());
  return {
    soLine: parseCutoffDay(String(cutoffDates?.soFms ?? '').trim()),
    isTicketCut: (step) => isBefore(refDate(step), ticketLine),
  };
}

/**
 * The steps the MIS counts: a PI's steps only on an approved PI (approved on or
 * after the CRM FMS cutoff — useMisSteps().piApprovedSet) unless their board
 * shows them past that gate, SO FMS and Tickets from their cutoffs on, and an
 * invoice-level SO step once per invoice and owner. The fold comes after the
 * gate, so a sibling the gate drops never stands in for one it keeps.
 *
 * @param {object[]} steps  useMisSteps().allSteps
 * @param {object} deps
 * @param {Set<string>} deps.piApprovedSet  normalized PI numbers
 * @param {object|null} [deps.rules]        the resolved rules (GET /api/rules/resolved)
 * @param {object} [deps.cutoffDates]       systemSettings/globalCutoffDates, read only without rules
 */
export function misCountedSteps(steps, { piApprovedSet, rules = null, cutoffDates }) {
  const { soLine, isTicketCut } = gatesOf(rules, cutoffDates);
  const counted = (steps || []).filter((step) => {
    if (!isOnApprovedPi(step, piApprovedSet)) return false;
    if (step.tab === SO_FMS_TAB && isBefore(refDate(step), soLine)) return false;
    return !(step.tab === TICKETS_TAB && isTicketCut(step));
  });
  return collapseCiSiblings(counted);
}

/** In the period when its plan (or, with none, its actual) falls inside it; an undated step is in none. */
export function inMisPeriod(step, { start, end }) {
  const ref = refDate(step);
  return !!ref && ref >= start && ref <= end;
}

/**
 * Pending work with no date yet — a CRM FMS step waiting on an earlier step, a
 * ticket with no due date. It is in no period, so the KPIs never count it; the
 * detail table lists it under every period so it stays findable, and says by
 * how many its "All" exceeds the period's steps.
 */
export const isUndatedOpen = (step) => !refDate(step) && step.status !== DONE;
