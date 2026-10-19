// VERBATIM COPY of CRM lib/mis/insights.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/insights.js
//
// A board's two findings beside its ranking: the steps that miss most and the
// delay reasons written most, over the team's own scored steps. The
// Scoreboard and Score Live show them under a section; the frozen record of a
// closed period keeps them with the scores. Plain data, so it stores as is.
//
// Pure; lib/__tests__/mis-insights.test.js.

import { delayReasonRows } from './delay-reasons.js';
import { stepDelayRows } from './step-delay.js';

export const INSIGHT_LIMIT = 5;

/**
 * @param {ReadonlyArray<import('./types.js').MisReportStep>} steps  The team's scored steps.
 * @param {{ limit?: number }} [options]
 * @returns {{ steps: ReturnType<typeof stepDelayRows>, moreSteps: number,
 *   reasons: ReturnType<typeof delayReasonRows>['rows'], delayed: number }}
 *   `steps`: the worst steps that missed or hold older open work; `moreSteps` how many more did;
 *   `reasons`: the delay reasons (the tail folded into one row); `delayed`: the delayed steps they cover.
 */
export function boardInsights(steps, { limit = INSIGHT_LIMIT } = {}) {
  const missing = stepDelayRows(steps).filter((row) => row.missed > 0 || row.backlog > 0);
  const reasons = delayReasonRows(steps, { limit });
  return {
    steps: missing.slice(0, limit),
    moreSteps: Math.max(0, missing.length - limit),
    reasons: reasons.rows,
    delayed: reasons.total,
  };
}
