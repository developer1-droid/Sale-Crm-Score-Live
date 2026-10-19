// VERBATIM COPY of CRM lib/pending-chase.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/pending-chase.js
// The open SO FMS and CRM FMS steps worth chasing, as the boards show them.
//
// The PC report page and the pending-work digest both answer "what is open, who
// owns it, and when is it due". They used to answer it separately: the digest
// from /api/pc-report's own copy of the step rules, which listed a Sales Order
// once per item line, listed steps the board already had done, and never
// listed Steps 4, 5, 7, 8, 9, 11 or 12. Both now read the boards' own feeds
// through this one module, so they cannot disagree with each other or with
// the boards.
//
// The lines a chase is cut by come from the report rules (chaseCutoffsOf):
// the CRM FMS cutoff a board shows a PI by, the SO FMS cutoff today's chase
// also holds a step's plan against, and the board bypass flags. So does
// Step-0's owner: whoever the rules put on the order scheduling duty
// (lib/rules/duties.js, decision 12's editable duty list).
//
// Pure and client-safe: feeds in, chase items out.

import { crmFmsFeedSteps } from './crm-fms-clock.js';
import { BOARD_BYPASS, CUTOFF } from './rules/contract.js';
import { dutyHolder } from './rules/duties.js';
import { FLOW } from './rules/names.js';
import { DUTY } from './rules/owners-default.js';
import { cutoffOf, soPlanCutoffOf } from './rules/scope.js';
import { SO_STEP_LABELS } from './so-fms-catalog.js';
import { closeDoneCiSiblings, collapseCiSiblings } from './so-fms-step-feed.js';

/** Feed status → chase status. Done, held and waiting steps are not chased. */
export const CHASE_STATUS = Object.freeze({ OVERDUE: 'overdue', TODAY: 'today', UPCOMING: 'upcoming' });

// Accounts Confirmation is the accounts team's step, driven by the Client Wallet.
const ACCOUNTS_STEP = 'step11_5';
// Step-0, Order Scheduled: the order scheduling duty's, not the PI's CRM's.
const ORDER_SCHEDULING_STEP = 'orderScheduled';
const SO_FALLBACK_OWNER = 'SO Team';
const CRM_FALLBACK_OWNER = 'Unassigned';
const REJECTED = 'rejected';

export const normPi = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The PI facts the chase rules need, keyed by normalized PI number, from the
 * /api/pc-report payload: approval date, approval status and owner name.
 */
export function piContext(pc = {}) {
  const approvedAt = new Map();
  const status = new Map();
  const owner = new Map();
  Object.entries(pc.piApprovalDates || {}).forEach(([pi, iso]) => {
    const date = toDate(iso);
    if (date) approvedAt.set(normPi(pi), date);
  });
  Object.entries(pc.piApprovalStatus || {}).forEach(([pi, value]) => status.set(normPi(pi), String(value || '').toLowerCase()));
  Object.entries(pc.piOwnerMap || {}).forEach(([pi, name]) => {
    if (pi && name) owner.set(normPi(pi), name);
  });
  return { approvedAt, status, owner };
}

/**
 * The lines a chase is cut by, read off the report rules (lib/rules/scope.js):
 *   crmCutoff  the CRM FMS cutoff a PI's approval is held against — the line
 *              both boards show a PI, an order by its PI, behind; IST midnight
 *              once the rules say so (decision 7);
 *   soCutoff   the SO FMS cutoff today's chase also holds an SO step's plan
 *              against (soPlanCutoffOf, as the MIS Performance Report does).
 *              Retired once no step reads it (decision 7 cuts SO FMS by the
 *              CRM FMS cutoff) — unless no CRM FMS date is set, so a missing
 *              cutoff never widens the chase;
 *   crmBypass, soBypass  a pre-cutoff PI its board still shows is chased
 *              (rules.boardBypass, decision 8; off by default and as decided).
 *
 * @param {import('./rules/contract.js').Rules} rules
 */
export function chaseCutoffsOf(rules) {
  return {
    crmCutoff: cutoffOf(rules, CUTOFF.CRM_FMS).at,
    soCutoff: soPlanCutoffOf(rules),
    crmBypass: rules?.boardBypass?.[FLOW.CRM_FMS] === BOARD_BYPASS.HAS_FMS_ROW,
    soBypass: rules?.boardBypass?.[FLOW.SO_FMS] === BOARD_BYPASS.HAS_MASTER_ROW,
  };
}

/** The lines of the rules when a caller has them, else the dates it passed (no bypass). */
const linesOf = (rules, { crmCutoff = null, soCutoff = null }) =>
  (rules ? chaseCutoffsOf(rules) : { crmCutoff, soCutoff, crmBypass: false, soBypass: false });

/**
 * A Sales Order's steps are chased only while its PI is approved, not rejected,
 * and approved on or after the CRM FMS cutoff — the SO FMS board's own rule for
 * which orders it shows.
 */
const isPiChased = (pis, piKey, crmCutoff) => {
  const approvedAt = pis.approvedAt.get(piKey);
  if (!approvedAt) return false;
  if ((pis.status.get(piKey) || '').includes(REJECTED)) return false;
  return !(crmCutoff && approvedAt < crmCutoff);
};

/**
 * Open SO FMS steps from the board's step feed (lib/so-fms-step-feed.js).
 *
 * An invoice-level step (SO-9 to SO-14) is chased once per invoice and owner:
 * the sales orders of a split CI each carry it, but one action — and the
 * one-click completion, which writes at invoice level — settles all of them.
 * One the board shows done on any order of the invoice is not chased on the
 * others, whoever owns them and whatever the cutoffs say (closeDoneCiSiblings,
 * decision 15), as the step feed lists it.
 *
 * @param {object[]} feedItems  /api/so-fms/step-feed items.
 * @param {object} options
 * @param {ReturnType<typeof piContext>} options.pis
 * @param {import('./rules/contract.js').Rules} [options.rules]  The report rules: the lines come from them
 *   (chaseCutoffsOf), and Step-0's owner from their order scheduling duty — today's duty without them.
 * @param {Date|null} [options.crmCutoff]  PI approval cutoff, without rules.
 * @param {Date|null} [options.soCutoff]   Planned-date cutoff, without rules.
 */
export function soChaseItems(feedItems = [], { pis, rules = null, crmCutoff = null, soCutoff = null }) {
  const lines = linesOf(rules, { crmCutoff, soCutoff });
  const scheduler = dutyHolder(rules, DUTY.ORDER_SCHEDULING).name;
  // Every feed item is a board row: the order has a master-tracker row.
  const piLine = lines.soBypass ? null : lines.crmCutoff;
  const open = [];
  closeDoneCiSiblings(feedItems).forEach((it) => {
    if (!CHASE_STATUS[it.status] || it.stepKey === ACCOUNTS_STEP) return;
    const piKey = normPi(it.piNo);
    if (!isPiChased(pis, piKey, piLine)) return;
    const planDate = toDate(it.planned);
    if (lines.soCutoff && planDate && planDate < lines.soCutoff) return;
    const owner = it.stepKey === ORDER_SCHEDULING_STEP ? scheduler : (pis.owner.get(piKey) || SO_FALLBACK_OWNER);
    open.push({ ...it, owner, planDate });
  });
  // Folded after the PI and cutoff filters, so a sibling they drop never stands in.
  return collapseCiSiblings(open).map((it) => ({
    id: it.id,
    ref: it.ref,
    soNo: it.soNo,
    piNo: it.piNo,
    buyer: it.buyer || '',
    brand: it.brand || '',
    stepKey: it.stepKey,
    stepCode: it.stepCode,
    stepName: SO_STEP_LABELS[it.stepKey] || it.stepName,
    owner: it.owner,
    planDate: it.planDate,
    status: CHASE_STATUS[it.status],
    delayMin: it.delayMin || 0,
    remarks: it.delayReason || '',
  }));
}

/**
 * Each step once, by its own id. The PC report keyed a row by board, step code
 * and order instead, and a Design Approval step's order is its PI: the designs
 * of one PI (26500-1, 26500-2), each on its own clock, collapsed into one row.
 * Every source names its steps apart — '{SO}-SO-n' on the SO FMS board,
 * '{PI}-S2' on CRM FMS, 'DA-S1-{Row ID}' per design row, 'TK-{id}' per ticket.
 */
export function distinctSteps(items = []) {
  const byId = new Map();
  (items || []).forEach((item) => {
    if (!byId.has(item.id)) byId.set(item.id, item);
  });
  return [...byId.values()];
}

const hasFmsRow = (entry) => Boolean(entry?.fms) && typeof entry.fms === 'object';

/**
 * Open CRM FMS steps from the CRM FMS board's clock (lib/crm-fms-clock.js),
 * over /api/pc-report's `crmFmsPis`.
 *
 * @param {object[]} crmFmsPis
 * @param {{ rules?: object, crmCutoff?: Date|null, now?: Date }} [options]  The lines
 *   come from `rules` when given (chaseCutoffsOf), else from `crmCutoff`.
 */
export function crmChaseItems(crmFmsPis = [], { rules = null, crmCutoff = null, now = new Date() } = {}) {
  const lines = linesOf(rules, { crmCutoff });
  const items = [];
  (crmFmsPis || []).forEach((entry) => {
    const isKeptByBoard = lines.crmBypass && hasFmsRow(entry);
    crmFmsFeedSteps(entry, now).forEach((step) => {
      const chase = CHASE_STATUS[step.status];
      if (!chase) return;
      // By the PI's approval date: an older PI the board still shows is not
      // chased, unless the rules' board bypass says so (decision 8).
      if (lines.crmCutoff && step.cutoffRef < lines.crmCutoff && !isKeptByBoard) return;
      items.push({
        id: step.id,
        ref: step.indentNo,
        piNo: step.piNo,
        buyer: step.buyerName || '',
        brand: step.brand || '',
        stepCode: step.stepCode,
        stepName: step.stepName,
        owner: entry.owner || CRM_FALLBACK_OWNER,
        planDate: step.planDate,
        status: chase,
        delayMin: step.delayMin || 0,
        remarks: step.delayReason || '',
      });
    });
  });
  return items;
}
