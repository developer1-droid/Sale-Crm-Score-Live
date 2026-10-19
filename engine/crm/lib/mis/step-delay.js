// VERBATIM COPY of CRM lib/mis/step-delay.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/step-delay.js
//
// Which steps run late. A MIS report's listed steps folded per step — each
// step once however many people share it, as the team line counts it — with
// what fell due, what was late or is still open, the older work still open,
// and how late the delayed ones are. The "Delay by step" chart and table of
// the CRM MIS and the Designer MIS read these rows.
//
// Pure; lib/__tests__/mis-step-delay.test.js.

import { reasonText } from './delay-reasons.js';
import { missPct } from './score.js';
import { MIS_OUTCOME } from './types.js';

const MINUTES_PER_HOUR = 60;
const ONE_DECIMAL = 10;

/** Outcomes that are a delay: done late, still open past plan, open from before the period. */
const DELAYED = new Set([MIS_OUTCOME.LATE, MIS_OUTCOME.NOT_DONE, MIS_OUTCOME.CARRIED_OVER]);

const hoursOf = (minutes) => Math.round((minutes / MINUTES_PER_HOUR) * ONE_DECIMAL) / ONE_DECIMAL;

/** A step's own row: its registry step. */
const BY_STEP = (step) => ({ key: step.stepKey, code: step.code, label: step.label });

const emptyRow = (step, group) => ({
  stepKey: group.key,
  code: group.code,
  label: group.label,
  flow: step.flow,
  planned: 0,
  onTime: 0,
  late: 0,
  notDone: 0,
  backlog: 0,
  delayedCount: 0,
  delayMin: 0,
  reasons: new Map(),
  reasonless: 0,
});

/** Adds one step's outcome to its row. */
function tally(row, step) {
  if (step.outcome === MIS_OUTCOME.ON_TIME) row.onTime += 1;
  if (step.outcome === MIS_OUTCOME.LATE) row.late += 1;
  if (step.outcome === MIS_OUTCOME.NOT_DONE) row.notDone += 1;
  if (step.outcome === MIS_OUTCOME.CARRIED_OVER) row.backlog += 1;
  if (step.outcome === MIS_OUTCOME.ON_TIME || step.outcome === MIS_OUTCOME.LATE || step.outcome === MIS_OUTCOME.NOT_DONE) {
    row.planned += 1;
  }
  if (DELAYED.has(step.outcome) && Number.isFinite(step.delayMin) && step.delayMin > 0) {
    row.delayedCount += 1;
    row.delayMin += step.delayMin;
  }
  if (DELAYED.has(step.outcome)) {
    const reason = reasonText(step);
    if (reason) row.reasons.set(reason, (row.reasons.get(reason) ?? 0) + 1);
    else row.reasonless += 1;
  }
}

/** The reason written most on the row's delayed steps; '' when none was written. */
function topReasonOf(reasons) {
  let top = '';
  let most = 0;
  reasons.forEach((count, reason) => {
    if (count > most) {
      top = reason;
      most = count;
    }
  });
  return top;
}

/** The row as the chart and the table read it. */
function finish(row) {
  const missed = row.late + row.notDone;
  return {
    stepKey: row.stepKey,
    code: row.code,
    label: row.label,
    flow: row.flow,
    planned: row.planned,
    onTime: row.onTime,
    late: row.late,
    notDone: row.notDone,
    missed,
    backlog: row.backlog,
    missPct: missPct(missed, row.planned),
    avgDelayHours: row.delayedCount > 0 ? hoursOf(row.delayMin / row.delayedCount) : null,
    totalDelayHours: hoursOf(row.delayMin),
    topReason: topReasonOf(row.reasons),
    reasonless: row.reasonless,
  };
}

/** Most missed first, then the most older work open, then the longest average delay. */
function byWorstFirst(a, b) {
  return b.missed - a.missed || b.backlog - a.backlog || (b.avgDelayHours ?? 0) - (a.avgDelayHours ?? 0) || a.code.localeCompare(b.code);
}

/**
 * @param {ReadonlyArray<import('./types.js').MisReportStep>} steps  A report's (or a search's) listed steps.
 * @param {{ groupOf?: (step: object) => { key: string, code: string, label: string } }} [options]  What a row is:
 *   the registry step by default; the Designer MIS groups its one step by request type.
 * @returns {Array<{ stepKey: string, code: string, label: string, flow: string, planned: number, onTime: number,
 *   late: number, notDone: number, missed: number, backlog: number, missPct: number|null,
 *   avgDelayHours: number|null, totalDelayHours: number, topReason: string, reasonless: number }>}  One row per
 *   step with any listed work, worst first; `topReason` the delay reason written most on it ('' for none),
 *   `reasonless` its delayed steps with no reason written.
 *   `planned` counts what fell due in the period (on time + late + not done); `backlog` is open work planned
 *   before it; the delay hours are working hours over the late, not-done and backlog steps the board measured.
 */
export function stepDelayRows(steps, { groupOf = BY_STEP } = {}) {
  const seen = new Set();
  const rows = new Map();
  (steps ?? []).forEach((step) => {
    if (seen.has(step.stepId)) return;
    seen.add(step.stepId);
    const group = groupOf(step);
    if (!rows.has(group.key)) rows.set(group.key, emptyRow(step, group));
    tally(rows.get(group.key), step);
  });
  return [...rows.values()]
    .map(finish)
    .filter((row) => row.planned > 0 || row.backlog > 0)
    .sort(byWorstFirst);
}

/**
 * The average working hours late over the delayed steps (late, not done, older
 * open) the boards measured, each step once; null when none ran late.
 * @param {ReadonlyArray<import('./types.js').MisReportStep>} steps
 * @returns {number|null}
 */
export function averageDelayHours(steps) {
  const seen = new Set();
  let count = 0;
  let minutes = 0;
  (steps ?? []).forEach((step) => {
    if (seen.has(step.stepId) || !DELAYED.has(step.outcome) || !Number.isFinite(step.delayMin) || step.delayMin <= 0) return;
    seen.add(step.stepId);
    count += 1;
    minutes += step.delayMin;
  });
  return count > 0 ? hoursOf(minutes / count) : null;
}
