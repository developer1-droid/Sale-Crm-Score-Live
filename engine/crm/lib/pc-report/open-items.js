// VERBATIM COPY of CRM lib/pc-report/open-items.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/pc-report/open-items.js
//
// The Pending Work Report's rows, read off the step feed (GET /api/step-feed,
// lib/step-feed/build.js). The page used to assemble them itself from four
// fetches — the board chase lists (lib/pending-chase), the Design Approval
// clock and its own ticket clock, then its own dedupe and cutoffs — and could
// disagree with the MIS on the same step. Now one pure pass over the feed:
//
//   open      the board says OVERDUE, TODAY or UPCOMING. A held step is not
//             listed: its clock is paused and nobody chases it — the page,
//             lib/pending-chase.js and the registry's EXCLUSION.HELD alike;
//   chased    the registry's `chase` flag on the item's step (SO-11.5 is the
//             accounts team's); a step the registry has no rule for is listed,
//             and the feed warns about it;
//   in scope  the feed's cutoff verdict, which keeps a Design Approval help
//             ticket — with a PI or none — by the board's own bypass, as the
//             board shows it (lib/rules/scope.js);
//   owner     whom the feed chases the step to, whoever can act on it now —
//             an open step of a PI transferred since it fell due is its
//             current CRM's, its score staying the earlier CRM's (owner
//             decision 12, lib/step-feed/owners.js withChaseOwner) — except a
//             Design Approval review or buyer step, which the page gives to
//             the PI's CRM first (owner decision
//             10): the feed names that CRM on the item (piCrm, piCrmEmail —
//             lib/step-feed/build.js), so a reader of their own steps gets
//             their PIs' design steps even when the feed hands them no other
//             step of that PI. An owner the feed names by email is shown by
//             the team roster's name, as the page's PI owner map named them.
//
// Pure and Firebase-free.

import { withChaseOwner } from '../step-feed/owners.js';
import { canonicalEmail } from '../step-feed/route-logic.js';

/** The page's status buckets. */
export const ROW_STATUS = Object.freeze({ OVERDUE: 'overdue', TODAY: 'today', UPCOMING: 'upcoming', NOPLAN: 'noplan' });

/** A feed status that makes a row, and the bucket it lands in. HOLD, DONE and NOPLAN make none. */
const ROW_STATUS_OF_FEED = Object.freeze({
  OVERDUE: ROW_STATUS.OVERDUE,
  TODAY: ROW_STATUS.TODAY,
  UPCOMING: ROW_STATUS.UPCOMING,
});

const RANK = Object.freeze({ [ROW_STATUS.OVERDUE]: 0, [ROW_STATUS.TODAY]: 1, [ROW_STATUS.UPCOMING]: 2, [ROW_STATUS.NOPLAN]: 3 });

/** The feed's tabs, as the page's categories. */
export const CATEGORY = Object.freeze({
  CRM_FMS: 'CRM FMS',
  SO_FMS: 'SO FMS',
  DESIGN_APPROVAL: 'Design Approval',
  TICKETS: 'Tickets',
});

/** The categories in the page's tab order. */
export const CATEGORIES = Object.freeze([CATEGORY.CRM_FMS, CATEGORY.DESIGN_APPROVAL, CATEGORY.SO_FMS, CATEGORY.TICKETS]);

/**
 * Where a row's step can be actioned and its docs viewed. The target pages
 * read ?q= to filter to the row's reference, so the step's action buttons and
 * document cards are one click away without copying them into the report.
 */
export const CATEGORY_ROUTE = Object.freeze({
  [CATEGORY.SO_FMS]: '/pi/sofms',
  [CATEGORY.CRM_FMS]: '/pi/fms',
  [CATEGORY.DESIGN_APPROVAL]: '/design/approval',
  [CATEGORY.TICKETS]: '/tickets',
});

const UNASSIGNED = 'Unassigned';
/** The page's label for a ticket with no title; the feed's is 'Ticket'. */
const HELP_TICKET_TITLE = 'Help Ticket';

export const itemHref = (row) => {
  const base = CATEGORY_ROUTE[row.category];
  if (!base) return '';
  const query = encodeURIComponent(row.soNo || row.ref || '');
  return query ? `${base}?q=${query}` : base;
};

/* ── which items make a row ──────────────────────────────────────────────── */

export const isOpen = (item) => Boolean(ROW_STATUS_OF_FEED[item.status]);

/**
 * Chased unless the registry says not to. An item with no registry key is
 * listed: losing a step because the registry is behind the board is worse
 * than listing one the owner may not want chased.
 */
export function isChased(item, rules) {
  if (!item.stepKey) return true;
  const rule = rules?.steps?.[item.stepKey];
  return !rule || rule.chase !== false;
}

/** Shown on its board: the feed's verdict, a help ticket kept by the Design Approval board's bypass. */
export const isInScope = (item) => item.scope?.inScope === true;

/* ── the owner ───────────────────────────────────────────────────────────── */

/**
 * Email → name from the team roster (/api/teamSheets members), so an owner the
 * feed names by email reads as the person. Keyed canonically; a member with
 * no email or no name adds nothing.
 *
 * @param {{ name?: string, email?: string }[]} members
 * @returns {Map<string, string>}
 */
export function ownerNamesOf(members) {
  const names = new Map();
  (members || []).forEach((member) => {
    const email = canonicalEmail(member?.email);
    const name = String(member?.name || '').trim();
    if (email && name && !names.has(email)) names.set(email, name);
  });
  return names;
}

/** The boards whose steps the PI's CRM owns; the page named that CRM from the PI owner map, by name. */
const PI_OWNED_TABS = new Set([CATEGORY.CRM_FMS, CATEGORY.SO_FMS]);

/**
 * The row's owner. A PI's CRM — on a CRM FMS or SO FMS step, or a Design
 * Approval review or buyer step the feed names them on (piCrm) — is shown by
 * the roster's name when the feed names them by email. Everyone else (a
 * ticket's assignee, the management reviewer, a desk) is shown as the feed
 * names them.
 */
function ownerOf(item, ownerNames) {
  const crm = item.piCrm ? { owner: item.piCrm, ownerEmail: item.piCrmEmail || '' } : null;
  const { owner, ownerEmail } = crm || { owner: item.owner || UNASSIGNED, ownerEmail: item.ownerEmail || '' };
  const isPiCrm = Boolean(crm) || PI_OWNED_TABS.has(item.tab);
  const name = isPiCrm && owner.includes('@') ? ownerNames?.get(canonicalEmail(ownerEmail)) : '';
  return { owner: name || owner, ownerEmail };
}

/* ── one row ─────────────────────────────────────────────────────────────── */

const isTicket = (item) => item.tab === CATEGORY.TICKETS;

/** The ticket's title as the page labels it: the feed's `title`, 'Help Ticket' when untitled. */
const ticketTitleOf = (item) => item.title || HELP_TICKET_TITLE;

/**
 * The row's remarks: a ticket's as the page builds them — priority, then
 * description — which the feed carries (lib/step-feed/ticket-steps.js); any
 * other step's, its delay reason.
 */
const remarksOf = (item) => (isTicket(item) ? item.remarks || '' : item.delayReason || '');

/**
 * @typedef {object} PendingRow
 * @property {string} id
 * @property {string} ref         PI, SO, CI, design or ticket reference
 * @property {string} soNo        the sales order, for SO FMS rows
 * @property {string} piNo
 * @property {string} buyer
 * @property {string} category    a CATEGORY
 * @property {string} stepCode
 * @property {string} stepName
 * @property {string} owner       whom the feed chases the step to (an email or a name)
 * @property {string} ownerEmail  '' when nobody could be named
 * @property {Date|null} planDate
 * @property {string} st          a ROW_STATUS
 * @property {number} delayMin
 * @property {string} remarks
 * @property {string} href
 */

function rowOf(item, ownerNames) {
  const row = {
    id: item.id,
    ref: item.indentNo || '',
    soNo: item.soNumber || '',
    piNo: item.piNo || '',
    buyer: item.buyerName || '',
    category: item.tab,
    stepCode: item.stepCode,
    stepName: isTicket(item) ? ticketTitleOf(item) : item.stepName,
    ...ownerOf(withChaseOwner(item), ownerNames),
    planDate: item.planDate || null,
    st: ROW_STATUS_OF_FEED[item.status],
    delayMin: item.delayMin || 0,
    remarks: remarksOf(item),
  };
  return { ...row, href: itemHref(row) };
}

const planTime = (row) => (row.planDate ? row.planDate.getTime() : Infinity);

/** The page's order: overdue, today, upcoming, no plan; the earliest plan first within each. */
const byUrgency = (a, b) => (RANK[a.st] !== RANK[b.st] ? RANK[a.st] - RANK[b.st] : planTime(a) - planTime(b));

/* ── the rows ────────────────────────────────────────────────────────────── */

/**
 * The open, chased, in-scope feed items as the page's rows, most urgent first.
 *
 * @param {object[]} items  Feed items, rehydrated (lib/step-feed/client.js).
 * @param {object} deps
 * @param {import('../rules/contract.js').Rules} deps.rules  For the chase flags.
 * @param {Map<string, string>} [deps.ownerNames]  Email → name (ownerNamesOf).
 * @returns {PendingRow[]}
 */
export function openRowsOf(items, { rules, ownerNames = null }) {
  return (items || [])
    .filter((item) => isOpen(item) && isChased(item, rules) && isInScope(item))
    .map((item) => rowOf(item, ownerNames))
    .sort(byUrgency);
}

/** The rows the reader owns: the owner's canonical email is theirs. An unowned row is nobody's. */
export function myRowsOf(rows, email) {
  const me = canonicalEmail(email);
  if (!me) return [];
  return (rows || []).filter((row) => canonicalEmail(row.ownerEmail) === me);
}
