// VERBATIM COPY of CRM lib/reports/deptPerformance.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/reports/deptPerformance.js
//
// The numbers behind Department Analytics' two reports.
//
//   • CRM Executive — every step a CRM Executive owns that carries a planned
//     time, whichever board it lives on: CRM FMS (signed PI, advance), Design
//     Approval (CRM approval, buyer approval — help tickets included), the SO FMS
//     steps that are the CRM's job and tickets assigned to them: the steps the
//     rules' crmExec profile scores (`scoreIn`), so an edit there reaches this
//     tab and the weighted CRM score. Higher on-time is better.
//   • Other — the Process Coordinator desk (see lib/scoring/crmExecScore.js
//     scopePcSteps) plus every person whose role is neither CRM Executive,
//     Sales Coordinator, CRM Head nor Designer, over the steps the rules count
//     for the tab (`scoreIn` naming deptOther). Read by Delay %: 0% is a clean
//     desk, 100% means every step ran late.
//
// A profile the rules put on the MIS engine is scored by lib/mis/board.js;
// these numbers stay the page's step lists. Both tabs drop a step from before
// its cutoff as the report rules draw it (isBeforeCutoff): today the module
// dates Settings holds, at 05:30 IST; under the owner's decision 7 the one CRM
// FMS cutoff for every PI-based step, at IST midnight.
//
// Pure — no fetching, no React — so the page, an export and the tests read the
// same answer. Owner resolution (name/email → role, canonical key, display
// name) is injected by the caller from the team directory.

import { ROLE } from '../team-roles.js';
import { collapseCiSiblings } from '../so-fms-step-feed.js';
import { CARRY_OVER, PROFILE } from '../rules/profiles-default.js';
import { CUTOFF_BASIS } from '../rules/contract.js';
import { cutoffOf, isKeptByItsBoard } from '../rules/scope.js';
import { ownValue } from '../rules/util.js';
import { isInScope as isShownOnItsBoard } from '../pc-report/open-items.js';
import { isScoredIn, scoredInRuleOf } from '../scoring/scoredIn.js';

export const REPORT = { CRM: 'crm', OTHER: 'other' };

/** The scoring profile behind each tab (lib/rules/profiles-default.js). */
export const PROFILE_OF_REPORT = Object.freeze({ [REPORT.CRM]: PROFILE.CRM_EXEC, [REPORT.OTHER]: PROFILE.DEPT_OTHER });

const DONE = 'DONE';
const OVERDUE = 'OVERDUE';
const HOLD = 'HOLD';

/** Roles whose people make up the "Other" report. */
const OTHER_ROLES = new Set([ROLE.PC, ROLE.OTHER]);

/** Owner strings that name nobody. */
const NO_OWNER = new Set(['', 'unassigned', 'unknown', 'so team', 'na', 'n/a', '-']);

/**
 * Boards a CRM Executive's own work sits on. Design approval is read from the
 * Design Approval board (CRM approval + buyer approval, on that page's
 * calendar); the legacy Design board's D1/D2 carry no planned time.
 */
const CRM_BOARDS = new Set(['CRM FMS', 'Design Approval', 'SO FMS', 'Tickets']);

/**
 * SO FMS steps that are the CRM's own job today — the Sales scorecard's
 * CRM_STEPS (app/api/sales-coordinator-report/route.js) plus SO-14 feedback.
 * The rest name the PI's CRM only because the feed has no other owner: SO-0 is
 * ops scheduling, SO-4 production, SO-11.5 accounts, SO-13 the telex approval.
 * The registry's default crmExec `scoreIn` is built from this list
 * (lib/rules/steps-default.js); a step the rules have no rule for falls back to it.
 */
export const CRM_SO_STEPS = new Set([
  'SO-1', 'SO-2', 'SO-3', 'SO-5', 'SO-6', 'SO-7', 'SO-8', 'SO-9', 'SO-10', 'SO-11', 'SO-12', 'SO-14',
]);

/**
 * A CRM Executive's own work: a step on one of the CRM's boards the rules'
 * crmExec profile scores. A step the rules say nothing about keeps today's
 * place — every one on the CRM's boards, of the SO FMS only CRM_SO_STEPS.
 */
function isCrmWork(step, rules) {
  if (!CRM_BOARDS.has(step.tab)) return false;
  return scoredInRuleOf(rules, step, PROFILE.CRM_EXEC) ?? (step.tab !== 'SO FMS' || CRM_SO_STEPS.has(step.stepCode));
}

/** Board order for step lists: the order work happens in. */
const SOURCE_ORDER = ['CRM FMS', 'Design Approval', 'SO FMS', 'Design', 'Tickets'];

const text = (value) => String(value ?? '').trim();
const hasOwner = (owner) => !NO_OWNER.has(text(owner).toLowerCase());
const refDate = (step) => step.planDate || step.actDate || null;

/**
 * Is a listed step before its cutoff? The step's own cutoff — its registry
 * rule's `cutoffKey` — on its day as the rules hold it, IST midnight once they
 * say so (lib/rules/scope.js cutoffOf), held against the date the item carries:
 * its PI's approval (`cutoffRef`, on CRM FMS and SO FMS steps), else its plan,
 * else its actual. The Design Approval board's own cutoff is held against dates
 * a listed item does not carry — the latest of the PI's approval, the request
 * and the submission — so there the feed's own verdict on the step stands. A
 * step its board keeps past its cutoff — a Design Approval help ticket, by the
 * board's bypass (lib/rules/scope.js) — is before none, and neither is a step
 * the registry has no rule for, or whose cutoff has no date.
 *
 * @param {object} step  A step-feed item (useMisSteps().allSteps).
 * @param {object|null} rules  The resolved rules, whole or as GET /api/rules/resolved sends them.
 */
export function isBeforeCutoff(step, rules) {
  if (isKeptByItsBoard(step.scope)) return false;
  const cutoffKey = ownValue(rules?.steps, step.stepKey)?.cutoffKey;
  const { at } = cutoffOf(rules, cutoffKey);
  if (!at) return false;
  if (rules.cutoffs[cutoffKey].basis === CUTOFF_BASIS.LATEST_ACTIVITY) return !isShownOnItsBoard(step);
  const reference = step.cutoffRef || refDate(step);
  return Boolean(reference) && reference < at;
}

function withOwner(step, owner, ownerName) {
  return { ...step, owner, ownerName, source: step.source || step.tab };
}

/**
 * Every planned step a CRM Executive owns.
 *
 * @param {object[]} allSteps  useMisSteps().allSteps
 * @param {object} deps  { designationOf, identityOf, nameOf, rules }
 */
export function scopeCrmExecutiveSteps(allSteps, { designationOf, identityOf, nameOf, rules = null }) {
  const out = [];
  for (const step of allSteps || []) {
    if (!step.planDate || !hasOwner(step.owner) || !isCrmWork(step, rules)) continue;
    if (designationOf(step.owner) !== ROLE.CRM) continue;
    if (isBeforeCutoff(step, rules)) continue;
    const owner = identityOf(step.owner) || step.owner;
    out.push(withOwner(step, owner, nameOf(step.owner) || owner));
  }
  return collapseCiSiblings(out);
}

/**
 * The Process Coordinator desk plus every Other-role doer.
 *
 * The follow-up coordinator chases EVERY step in the business, so her lens
 * steps are marked `isFollowUp`: they make up her own row but never the team
 * totals, which would otherwise turn into the whole company's delay. Only the
 * steps the rules count for the tab (`scoreIn` naming deptOther) are in it.
 *
 * @param {object[]} allSteps  useMisSteps().allSteps
 * @param {object[]} pcSteps   scopePcSteps(allSteps, …) — the PC desk
 * @param {object} deps  { designationOf, identityOf, nameOf, followUpOwner, rules }
 */
export function scopeOtherSteps(allSteps, pcSteps, { designationOf, identityOf, nameOf, followUpOwner, rules = null }) {
  const seen = new Set();
  const out = [];
  const add = (step) => {
    const key = `${step.owner}|${step.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(step);
  };
  const isCounted = (step) => step.planDate && hasOwner(step.owner) && isScoredIn(rules, step, PROFILE.DEPT_OTHER);

  for (const step of pcSteps || []) {
    if (!isCounted(step)) continue;
    add({ ...withOwner(step, step.owner, step.ownerName || step.owner), isFollowUp: step.owner === followUpOwner });
  }
  for (const step of allSteps || []) {
    if (!isCounted(step)) continue;
    if (!OTHER_ROLES.has(designationOf(step.owner))) continue;
    if (isBeforeCutoff(step, rules)) continue;
    const owner = identityOf(step.owner) || step.owner;
    add(withOwner(step, owner, nameOf(step.owner) || owner));
  }
  return collapseCiSiblings(out);
}

/**
 * Steps that belong to a period: planned (or done) inside it, and the open work
 * the tab's profile says to keep (ScoringProfile.outcome.carryOver,
 * lib/mis/profile-engine.js carryOverOf):
 *
 *   SCORED (today) — every step still overdue or on hold, whatever its plan
 *     date, counted as the period's own: open work does not vanish when the
 *     window rolls over.
 *   LISTED (owner decision #3) — work still open from before the period is
 *     listed as backlog (`isBacklog`), out of the period's numbers; open work
 *     planned after it belongs to a later period.
 *
 * @param {object[]} steps
 * @param {{ start: Date, end: Date }} range
 * @param {string} [carryOver]  CARRY_OVER.SCORED (the default) or CARRY_OVER.LISTED.
 */
export function inPeriod(steps, { start, end }, carryOver = CARRY_OVER.SCORED) {
  if (carryOver !== CARRY_OVER.LISTED) return (steps || []).filter((step) => isInPeriod(step, start, end));
  return (steps || []).flatMap((step) => {
    if (isPlannedIn(step, start, end)) return [step];
    return isOpenFromBefore(step, start) ? [{ ...step, isBacklog: true }] : [];
  });
}

/** What a period's score may count: its own steps, never the backlog listed beside them. */
export const periodWork = (steps) => (steps || []).filter((step) => !step.isBacklog);

/**
 * What a team view counts: its own work. The follow-up lens is the whole
 * business, so it shows only when the follow-up coordinator is the one chosen.
 */
export const teamWork = (steps) => (steps || []).filter((step) => !step.isFollowUp);

function isPlannedIn(step, start, end) {
  const ref = refDate(step);
  return !!ref && ref >= start && ref <= end;
}

function isInPeriod(step, start, end) {
  // Open work does not leave the report when the window moves: overdue steps
  // and paused ones carry forward whatever their plan date.
  if (step.status === OVERDUE || step.status === HOLD) return true;
  return isPlannedIn(step, start, end);
}

/** Not done, and planned before the period began: the backlog decision #3 lists. */
function isOpenFromBefore(step, start) {
  const ref = refDate(step);
  return step.status !== DONE && !!ref && ref < start;
}

/** Late done + overdue, as a share of all steps. 0 is best. */
export function delayPct(lateDone, overdue, total) {
  return total ? Math.round(((lateDone + overdue) / total) * 100) : null;
}

/** On-time done as a share of done. */
export function onTimePct(onTime, done) {
  return done ? Math.round((onTime / done) * 100) : null;
}

function emptyTally() {
  return { total: 0, done: 0, onTime: 0, lateDone: 0, overdue: 0, open: 0, held: 0, delayMin: 0, backlog: 0 };
}

function count(tally, step) {
  // Backlog is listed beside the period, never scored against it.
  if (step.isBacklog) {
    tally.backlog += 1;
    return;
  }
  tally.total += 1;
  if (step.status === DONE) {
    tally.done += 1;
    if (step.onTime) tally.onTime += 1;
    else tally.lateDone += 1;
  } else if (step.status === OVERDUE) {
    tally.overdue += 1;
  } else {
    // Still open; a held step's clock is stopped, so it is never late.
    tally.open += 1;
    if (step.status === HOLD) tally.held += 1;
  }
  if (isLate(step)) tally.delayMin += step.delayMin;
}

/** Late is overdue, or done past its plan — a paused step or an on-time one inside its grace band is not. */
export const isLate = (step) => step.delayMin > 0 && (step.status === OVERDUE || (step.status === DONE && !step.onTime));

function finish(tally) {
  const late = tally.lateDone + tally.overdue;
  return {
    ...tally,
    pending: tally.overdue + tally.open,
    onTimePct: onTimePct(tally.onTime, tally.done),
    delayPct: delayPct(tally.lateDone, tally.overdue, tally.total),
    avgDelayMin: late ? tally.delayMin / late : 0,
  };
}

/** Totals over distinct steps — one step counted once even if two people hold it. */
export function summarize(steps) {
  const tally = emptyTally();
  const seen = new Set();
  for (const step of steps || []) {
    if (seen.has(step.id)) continue;
    seen.add(step.id);
    count(tally, step);
  }
  return finish(tally);
}

/** One row per person. */
export function personRows(steps) {
  const byOwner = new Map();
  for (const step of steps || []) {
    if (!byOwner.has(step.owner)) {
      byOwner.set(step.owner, { owner: step.owner, label: step.ownerName || step.owner, isFollowUp: false, bySource: {}, tally: emptyTally() });
    }
    const row = byOwner.get(step.owner);
    row.bySource[step.source] = (row.bySource[step.source] || 0) + 1;
    if (step.isFollowUp) row.isFollowUp = true;
    count(row.tally, step);
  }
  return [...byOwner.values()].map(({ tally, ...row }) => ({ ...row, ...finish(tally) }));
}

const NO_PENDING = Object.freeze({ overdue: 0, open: 0 });

/** A person's pending cell of a step row: overdue and still in time, and — only when there is some — backlog. */
function withPending(cell, step) {
  const pending = cell || NO_PENDING;
  if (step.isBacklog) return { ...pending, backlog: (pending.backlog || 0) + 1 };
  if (step.status === OVERDUE) return { ...pending, overdue: pending.overdue + 1 };
  return { ...pending, open: pending.open + 1 };
}

const TICKET_KEY = 'Tickets|TK';

/** The row a step belongs to in stepRows — tickets share one. */
export const stepKeyOf = (step) => (step.source === 'Tickets' ? TICKET_KEY : `${step.source}|${step.stepCode}`);

// 'SO-11.5' sorts between SO-11 and SO-12; ticket ids fall back to text order.
function codeOrder(code) {
  const match = text(code).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sourceRank(source) {
  const i = SOURCE_ORDER.indexOf(source);
  return i === -1 ? SOURCE_ORDER.length : i;
}

/**
 * One row per step (board + step code), with who holds what open.
 * Tickets collapse to one "Help Tickets" row: every ticket id is its own code.
 */
export function stepRows(steps) {
  const rows = new Map();
  for (const step of steps || []) {
    const key = stepKeyOf(step);
    const isTicket = key === TICKET_KEY;
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        source: step.source,
        stepCode: isTicket ? 'TK' : step.stepCode,
        stepName: isTicket ? 'Help Tickets' : step.stepName,
        tally: emptyTally(),
        ids: new Set(),
        byOwner: {},
      });
    }
    const row = rows.get(key);
    // A step two people hold (the follow-up lens and its doer) counts once.
    if (!row.ids.has(step.id)) {
      row.ids.add(step.id);
      count(row.tally, step);
    }
    if (step.status !== DONE) row.byOwner[step.owner] = withPending(row.byOwner[step.owner], step);
  }
  return [...rows.values()]
    .map(({ tally, ids, ...row }) => ({ ...row, ...finish(tally) }))
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source)
      || codeOrder(a.stepCode) - codeOrder(b.stepCode)
      || text(a.stepCode).localeCompare(text(b.stepCode)));
}

/* ── payments not received ───────────────────────────────────────────────── */

export const PAYMENT_KIND = { SIGNED_PI: 'signedPi', ADVANCE: 'advance', BALANCE: 'balance' };

const MONEY = /^([A-Z]{3})\s+([\d,]+(?:\.\d+)?)$/;

/** "USD 12,500" → { currency: 'USD', amount: 12500 }; anything else → null. */
export function parseMoney(value) {
  const match = text(value).match(MONEY);
  if (!match) return null;
  return { currency: match[1], amount: Number(match[2].replace(/,/g, '')) };
}

const columnReader = (header) => {
  const index = new Map((header || []).map((h, i) => [text(h), i]));
  return (row, name) => row[index.get(name)];
};

// The deposits inside a PI's advance due. They are never invoiced, so they stay
// owed on the PI after its invoice is raised (withoutInvoicedAdvances).
const DEPOSIT_COLUMNS = ['Cylinder Charge', 'Bag Security'];

/**
 * Rows of /api/reports/pi-advance-pending — a PI can wait on the signed PI, on
 * the advance, or on both; each wait becomes its own item. An advance item
 * carries `deposits`, the amount of its advance that is deposits.
 */
export function advancePendingItems({ header, rows } = {}) {
  const cell = columnReader(header);
  const items = [];
  for (const row of rows || []) {
    const base = {
      ref: text(cell(row, 'PI Number')),
      buyer: text(cell(row, 'Buyer Name')),
      ownerName: text(cell(row, 'CRM Name')),
      days: Number(cell(row, 'Days Pending')) || 0,
      remark: text(cell(row, 'CRM Remarks / Delay Reason')),
    };
    if (text(cell(row, 'Signed PI Received')).toLowerCase() === 'no') {
      items.push({ ...base, kind: PAYMENT_KIND.SIGNED_PI, money: null });
    }
    const money = parseMoney(cell(row, 'Advance Due (Remaining)'));
    if (!money) continue;
    const deposits = DEPOSIT_COLUMNS.reduce((sum, name) => sum + (parseMoney(cell(row, name))?.amount || 0), 0);
    items.push({ ...base, kind: PAYMENT_KIND.ADVANCE, money, deposits, dueDate: text(cell(row, 'Advance Due Date')) });
  }
  return items;
}

/**
 * Rows of /api/reports/arrived-payment-pending. Money there is per CI while
 * rows are per sales order, so only the CI's lead row carries the outstanding.
 */
export function balancePendingItems(rows) {
  return (rows || [])
    .filter((row) => row.outstanding === null || row.outstanding > 0)
    .map((row) => ({
      kind: PAYMENT_KIND.BALANCE,
      ref: text(row.ciNo) || text(row.soNo),
      soNo: text(row.soNo),
      piNo: text(row.piNo),
      buyer: text(row.buyer),
      ownerName: text(row.crmName),
      ownerEmail: text(row.ownerEmail),
      days: Number(row.daysSinceArrival) || 0,
      money: row.isCiLead && row.outstanding > 0
        ? { currency: text(row.currency) || 'USD', amount: row.outstanding }
        : null,
      remark: text(row.remark),
    }));
}

/**
 * Drop the advance on goods still listed for a PI an invoice has billed. From
 * billing on it is inside the invoice, which Step-11 chases — the CI's balance
 * item while it is unpaid, nothing once it is paid, closed or done — so keeping
 * it would chase that money twice, or chase money the board has finished with.
 * Deposits are never invoiced: what is left of them stays listed on the PI.
 *
 * @param {object[]} items  Payment items (advancePendingItems, balancePendingItems).
 * @param {string[]} [invoicedPiNos]  Every PI an invoice has billed, arrived or not
 *   (GET /api/reports/arrived-payment-pending `invoicedPiNos`).
 */
export function withoutInvoicedAdvances(items = [], invoicedPiNos = []) {
  const billedPis = new Set([
    ...items.filter((item) => item.kind === PAYMENT_KIND.BALANCE && item.piNo).map((item) => item.piNo),
    ...(invoicedPiNos || []),
  ].map((piNo) => text(piNo).toUpperCase()));
  return items.flatMap((item) => {
    if (item.kind !== PAYMENT_KIND.ADVANCE || !billedPis.has(text(item.ref).toUpperCase())) return [item];
    const amount = Math.min(item.money?.amount || 0, item.deposits || 0);
    return amount > 0 ? [{ ...item, money: { ...item.money, amount } }] : [];
  });
}

/**
 * Group payment items by person (canonical key) and kind, summing money per
 * currency — currencies are never added together.
 */
export function paymentsByOwner(items, identityOf) {
  const byOwner = new Map();
  for (const item of items || []) {
    const owner = identityOf(item.ownerEmail || item.ownerName) || item.ownerEmail || item.ownerName || 'Unassigned';
    if (!byOwner.has(owner)) byOwner.set(owner, { owner, items: [], kinds: {} });
    const entry = byOwner.get(owner);
    entry.items.push({ ...item, owner });
    const kind = entry.kinds[item.kind] || { count: 0, money: {} };
    kind.count += 1;
    if (item.money) kind.money[item.money.currency] = (kind.money[item.money.currency] || 0) + item.money.amount;
    entry.kinds[item.kind] = kind;
  }
  return byOwner;
}
