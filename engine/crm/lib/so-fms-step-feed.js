// VERBATIM COPY of CRM lib/so-fms-step-feed.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/so-fms-step-feed.js
//
// Every SO FMS step as the board shows it, for the reports.
//
// The PC report, MIS, the CRM Executive report and the Scoreboard used to work
// out SO steps again from the master tracker with their own formulas, so an
// order the board showed as "waiting for approvals" could read months overdue
// in a report. This reads the board's own rows instead — built by
// lib/so-fms-transform.js and folded per order by lib/so-fms-collapse.js — and
// states each step's plan, actual, status and delay in the feed vocabulary.
//
// Pure: rows in, feed items out.

import { SO_STEPS } from './so-fms-catalog.js';
import { parseDT } from './so-fms-datetime.js';
import { isTelexAcknowledged } from './telex-ack.js';
import { normalizeInvoiceKey } from './final-docs.js';
import { STEP11_CLOSE_STATE, step11CloseState } from './so-fms-step11-close.js';
import { soStepCode } from './so-fms-sla.js';
import { FLOW } from './rules/names.js';
import { HOUR_FLOOR_GRACE_MIN } from './rules/step-clock.js';
import { isDueToday, stepGraceMin } from './work-clock.js';

const COMPLETED = 'completed';
const WAITING_APPROVALS = 'waiting_approvals';
const NO_INVOICE = 'N/A';
const STEP11_KEY = 'step11';
const MINUTES_PER_HOUR = 60;

/** Steps that carry the Commercial Invoice rather than the SO as their reference. */
export const CI_STEP_KEYS = new Set(['step9', 'step10', 'step11', 'step11_5', 'step12', 'step13', 'step14']);

// The board key's code ('step11_5' → 'SO-11.5') is written once, in lib/so-fms-sla.js.
export { soStepCode };

const toIso = (value) => {
  const date = value ? parseDT(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
};

/**
 * The board's delay (whole working hours) against the step's grace in the
 * rules (59 minutes by default: anything under an hour late is on time), and
 * the one "due today" every clock shares (lib/rules/step-clock.js isDueToday).
 */
function statusOf(step, { held, planned, now, graceMin }) {
  const delayMin = Math.max(0, Number(step.delayHours) || 0) * MINUTES_PER_HOUR;
  if (step.status === COMPLETED) return { status: 'DONE', delayMin, onTime: delayMin <= graceMin };
  if (held) return { status: 'HOLD', delayMin, onTime: false };
  if (!planned || step.status === WAITING_APPROVALS) return { status: 'NOPLAN', delayMin: 0, onTime: false };
  if (delayMin > graceMin) return { status: 'OVERDUE', delayMin, onTime: false };
  return { status: isDueToday(planned, now) ? 'TODAY' : 'UPCOMING', delayMin: 0, onTime: false };
}

/**
 * The close of a Step-11 the board shows closed by hand — whether the money
 * came in, why, who, when — as the transform reads it off the ledger
 * (lib/so-fms-transform.js puts latestStep11Closure's answer on the row as
 * steps.step11.closure). The board shows a close only on a step it reads
 * closed without the invoice settled (lib/so-fms-step11-close.js
 * step11CloseState CLOSED_UNSETTLED: the "Step-11 closed" summary with its
 * reason); a settled step reads "Paid" with no reason, and an open one —
 * reopened, say — has no close. Both are null here, so the feed, the Client
 * Wallet and the Client Ledger (lib/so-fms-step11-board.js) read one closed
 * set. A step the board shows closed with no close on its ledger is closed
 * with no reason, as the board shows it.
 */
function closureOf(step) {
  if (step11CloseState(step) !== STEP11_CLOSE_STATE.CLOSED_UNSETTLED) return null;
  const closure = step.closure || {};
  return {
    moneyStatus: String(closure.moneyStatus || '').trim(),
    reason: String(closure.reason || '').trim(),
    by: String(closure.by || '').trim(),
    at: toIso(closure.at),
  };
}

/**
 * The board's own excuses, for the step feed's adapter
 * (lib/step-feed/adapters/so-fms.js): on Step-11 its close by hand (null
 * while the step is open or settled), and on a held step the hold remark the row carries. The row
 * carries PI Data's 'Workflow Hold Remarks' (lib/so-fms-transform.js
 * holdRemarks); the master tracker's global hold reason and the ledger's
 * Hold Placed remark are not on the row, so a hold placed from the SO board
 * reads '' here until the transform surfaces them.
 */
function excusesOf(key, step, row, held) {
  return {
    ...(key === STEP11_KEY ? { closure: closureOf(step) } : {}),
    ...(held ? { holdReason: String(row.holdRemarks || '').trim() } : {}),
  };
}

/**
 * Feed items for every step of every order.
 *
 * @param {object[]} soRows  One row per order (collapseSoRows).
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {Array<{id: string, soNo: string, piNo: string, ciNo: string, ref: string,
 *   buyer: string, brand: string, stepKey: string, stepCode: string, stepName: string,
 *   planned: string, actual: string, status: string, delayMin: number, onTime: boolean,
 *   delayReason: string, closure?: {moneyStatus: string, reason: string, by: string, at: string}|null,
 *   holdReason?: string}>}
 *   `closure` rides on every Step-11 item, `holdReason` on every held item.
 *   A telex parked on "Proceed upon Acknowledgement" is left out: it waits on
 *   accounts with its clock frozen, as on the board.
 */
export function soStepFeed(soRows = [], { now = new Date() } = {}) {
  const items = [];
  soRows.forEach((row) => {
    const ciNo = row.finalInvoiceNo && row.finalInvoiceNo !== NO_INVOICE ? String(row.finalInvoiceNo) : '';
    SO_STEPS.forEach(({ key, name }) => {
      const step = row.steps?.[key];
      if (!step) return;
      if (key === 'step13' && isTelexAcknowledged(step.status)) return;
      const planned = step.plannedDateTime ? parseDT(step.plannedDateTime) : null;
      const held = !!(row.isHold && step.isStepHeld);
      const graceMin = stepGraceMin(FLOW.SO_FMS, soStepCode(key), HOUR_FLOOR_GRACE_MIN);
      items.push({
        id: `${row.soNo}-${soStepCode(key)}`,
        soNo: row.soNo,
        piNo: row.piNo || '',
        ciNo,
        ref: CI_STEP_KEYS.has(key) && ciNo ? ciNo : row.soNo,
        buyer: row.buyer || '',
        brand: row.brandName || '',
        stepKey: key,
        stepCode: soStepCode(key),
        stepName: String(name || key).replace(/^Step-[\d.]+:\s*/i, ''),
        planned: planned && !Number.isNaN(planned.getTime()) ? planned.toISOString() : '',
        actual: step.status === COMPLETED ? toIso(step.actualDateTime) : '',
        delayReason: step.delayReason || '',
        ...statusOf(step, { held, planned, now, graceMin }),
        ...excusesOf(key, step, row, held),
      });
    });
  });
  return items;
}

/* ── a Commercial Invoice's steps, once ──────────────────────────────────── */

const DONE = 'DONE';

/** SO FMS steps done once per Commercial Invoice, whatever the number of sales orders on it. */
const CI_STEP_CODES = new Set([...CI_STEP_KEYS].map(soStepCode));

const ciKeyOf = (step) => (CI_STEP_CODES.has(step.stepCode) ? normalizeInvoiceKey(step.ciNo) : null);
// A report step carries its completion as `actDate`, a board feed item as `actual`.
const actualTime = (step) => {
  const at = step.actDate || step.actual;
  const time = at ? new Date(at).getTime() : NaN;
  return Number.isNaN(time) ? Infinity : time;
};
// Report steps carry the order as `soNumber`, the board feed and its chase list as `soNo`.
const soNumberOf = (step) => String(step.soNumber || step.soNo || '');

/**
 * Which sibling copy of a CI step stands for it, best first. A done copy wins:
 * the board stamps one completion onto every sibling, so an open one beside it
 * is a leftover. Then the earliest completion, then the longest delay so the
 * collapse never hides lateness, then the base SO before its -P2/-P3.
 */
const copyRank = (step) => {
  const done = step.status === DONE;
  return [done ? 0 : 1, done ? actualTime(step) : 0, -(step.delayMin || 0), soNumberOf(step)];
};

function preferredCopy(kept, next) {
  const [a, b] = [copyRank(kept), copyRank(next)];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return kept;
    if (a[i] > b[i]) return next;
  }
  return kept;
}

/**
 * An invoice-level step across every sales order of its invoice,
 * `${stepCode}|${CI}`, whoever owns the order and whichever side of a cutoff
 * it sits on; null for an order-level step or one with no invoice.
 */
export const invoiceStepKeyOf = (step) => {
  const ci = ciKeyOf(step);
  return ci ? `${step.stepCode}|${ci}` : null;
};

/**
 * The invoice-level steps the board shows done on any sales order of their
 * invoice, by invoiceStepKeyOf: the earliest completion of each.
 */
export function doneInvoiceSteps(steps) {
  const done = new Map();
  for (const step of steps || []) {
    const key = step.status === DONE ? invoiceStepKeyOf(step) : null;
    if (key && (!done.has(key) || actualTime(step) < actualTime(done.get(key)))) done.set(key, step);
  }
  return done;
}

/**
 * The steps without the open copies of an invoice step the board shows done
 * on another sales order of the invoice. The board stamps one completion onto
 * every sibling, so an open copy beside a done one is a leftover, and done,
 * paid or closed is never pending anywhere (decision 15). Done is done for
 * every owner and on both sides of a cutoff, so this runs on the board's own
 * items, before owners and scope are read: the step feed's SO loader
 * (lib/step-feed/build.js) and the chase list (lib/pending-chase.js). An open
 * step still gets a row per owner (collapseCiSiblings, decision 13).
 */
export function closeDoneCiSiblings(steps) {
  const done = doneInvoiceSteps(steps);
  return (steps || []).filter((step) => step.status === DONE || !done.has(invoiceStepKeyOf(step)));
}

/** The kept copy, carrying a sibling's delay reason when it has none of its own. */
const withSiblingReason = (best, other) => (best.delayReason || !other.delayReason ? best : { ...best, delayReason: other.delayReason });

/**
 * One row per CI step per person. A CI split across sales orders (260468398
 * and 260468398-P2 on HR/ES/26/0121) is one shipment: its docs, payment chase,
 * arrival and feedback are entered once, but this feed lists them once per SO,
 * so one late payment chase read as three. Every report and the pending-work
 * digest fold them here. Run it after a caller's own owner, cutoff and PI
 * filters, so a sibling outside them never stands in for one inside.
 */
export function collapseCiSiblings(steps) {
  const at = new Map();
  const out = [];
  for (const step of steps || []) {
    const ci = ciKeyOf(step);
    const key = ci && `${step.owner}|${step.stepCode}|${ci}`;
    if (!key || !at.has(key)) {
      if (key) at.set(key, out.length);
      out.push(step);
      continue;
    }
    const kept = out[at.get(key)];
    const best = preferredCopy(kept, step);
    out[at.get(key)] = withSiblingReason(best, best === kept ? step : kept);
  }
  return out;
}
