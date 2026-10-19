// VERBATIM COPY of CRM lib/mis/delay-reasons.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/delay-reasons.js
//
// Why work ran late, in the words written on the boards: the delay reason the
// CRM FMS, SO FMS and Design Approval boards (and the design requests) carry
// on a step, gathered over a report's delayed steps — done late, still open
// past plan, or open from before the period — each step once however many
// people share it. A delayed step with no reason written is counted as such,
// so a reason-less week reads as one, not as a quiet one.
//
// Pure; lib/__tests__/mis-delay-reasons.test.js.

import { MIS_OUTCOME } from './types.js';

export const NO_REASON = 'No reason given';
export const OTHER_REASONS = 'Other reasons';
export const DEFAULT_REASON_LIMIT = 8;
const PCT = 100;

const DELAYED = new Set([MIS_OUTCOME.LATE, MIS_OUTCOME.NOT_DONE, MIS_OUTCOME.CARRIED_OVER]);

/** A reason as written, spaces tidied; '' when none. */
export const reasonText = (step) => String(step?.delayReason ?? '').replace(/\s+/g, ' ').trim();

/** The key two spellings of one reason share: case and punctuation at the ends do not split them. */
const keyOf = (reason) => reason.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

/** Each delayed step once, in the order listed. */
function delayedSteps(steps) {
  const seen = new Set();
  return (steps ?? []).filter((step) => {
    if (!DELAYED.has(step.outcome) || seen.has(step.stepId)) return false;
    seen.add(step.stepId);
    return true;
  });
}

/**
 * @param {ReadonlyArray<import('./types.js').MisReportStep>} steps  A report's (or a search's) listed steps.
 * @param {{ limit?: number }} [options]  Rows kept before the rest fold into "Other reasons".
 * @returns {{ total: number, rows: Array<{ reason: string, count: number, share: number, codes: string[],
 *   isMissing: boolean, isOther: boolean }> }}  `total` delayed steps; rows most frequent first, with the steps
 *   (codes) each reason was written on, most frequent first; "No reason given" ranks by its count like any other.
 */
export function delayReasonRows(steps, { limit = DEFAULT_REASON_LIMIT } = {}) {
  const delayed = delayedSteps(steps);
  const groups = new Map();
  delayed.forEach((step) => {
    const written = reasonText(step);
    const key = written ? keyOf(written) || written.toLowerCase() : '';
    if (!groups.has(key)) groups.set(key, { reason: written || NO_REASON, count: 0, codes: new Map(), isMissing: !written });
    const group = groups.get(key);
    group.count += 1;
    group.codes.set(step.code, (group.codes.get(step.code) ?? 0) + 1);
  });
  const total = delayed.length;
  const shareOf = (count) => (total > 0 ? Math.round((count / total) * PCT) : 0);
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const kept = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const rows = kept.map((group) => ({
    reason: group.reason,
    count: group.count,
    share: shareOf(group.count),
    codes: [...group.codes.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code),
    isMissing: group.isMissing,
    isOther: false,
  }));
  if (rest.length > 0) {
    const count = rest.reduce((sum, group) => sum + group.count, 0);
    rows.push({ reason: `${OTHER_REASONS} (${rest.length})`, count, share: shareOf(count), codes: [], isMissing: false, isOther: true });
  }
  return { total, rows };
}

/**
 * Each person's most written reason over their delayed steps, by doer key;
 * a person whose delays carry no reason at all gets NO_REASON.
 * @param {ReadonlyArray<import('./types.js').MisReportStep>} steps
 * @param {(step: object) => string} keyOfDoer  lib/mis/score.js doerKeyOf.
 * @returns {Map<string, { reason: string, count: number, delayed: number }>}
 */
export function topReasonByDoer(steps, keyOfDoer) {
  const byDoer = new Map();
  (steps ?? []).forEach((step) => {
    if (!DELAYED.has(step.outcome)) return;
    const key = keyOfDoer(step);
    if (!byDoer.has(key)) byDoer.set(key, []);
    byDoer.get(key).push(step);
  });
  const top = new Map();
  byDoer.forEach((doerSteps, key) => {
    const given = delayReasonRows(doerSteps.map((step, index) => ({ ...step, stepId: `${key}|${index}` })), { limit: Infinity })
      .rows.filter((row) => !row.isMissing);
    top.set(key, given.length > 0
      ? { reason: given[0].reason, count: given[0].count, delayed: doerSteps.length }
      : { reason: NO_REASON, count: doerSteps.length, delayed: doerSteps.length });
  });
  return top;
}

/** What a step's reason cell says: the board's excuse, the delay reason written, that none was written, or nothing. */
export const STEP_REASON_KIND = Object.freeze({ EXCUSE: 'excuse', WRITTEN: 'written', MISSING: 'missing', NONE: 'none' });

/**
 * Why one step stands as it does, for a drawer's row.
 * @param {import('./types.js').MisReportStep} step
 * @param {(excuse: object) => string} excuseTextOf  lib/mis/format.js excuseText.
 * @returns {{ text: string, kind: string }}  kind is a STEP_REASON_KIND.
 */
export function stepReasonOf(step, excuseTextOf) {
  if (step.excuse) return { text: excuseTextOf(step.excuse), kind: STEP_REASON_KIND.EXCUSE };
  if (!DELAYED.has(step.outcome)) return { text: '—', kind: STEP_REASON_KIND.NONE };
  const written = reasonText(step);
  return written ? { text: written, kind: STEP_REASON_KIND.WRITTEN } : { text: NO_REASON, kind: STEP_REASON_KIND.MISSING };
}
