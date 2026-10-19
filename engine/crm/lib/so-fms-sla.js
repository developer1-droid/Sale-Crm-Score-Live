// VERBATIM COPY of CRM lib/so-fms-sla.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/so-fms-sla.js
//
// The SO FMS board's SLA steps: how long each has after its anchor, and the
// registry step it is.
//
// The board (lib/so-fms-planned.js), its transform (lib/so-fms-transform.js)
// and the Sales Coordinator's planner (lib/so-working-hours.js
// computeSoStepPlanned) each wrote these minutes out as literals, and the rules
// registry wrote them a fourth time. They are written once here: the registry's
// defaults read them (lib/rules/steps-default.js), and the board takes each
// step's time from the registry's plan through soSlaPlannedAt — these minutes
// are what it falls back on while no rules are loaded.
//
// Pure but for the clock it reads (lib/work-clock.js).

import { FLOW } from './rules/names.js';
import { stepPlannedAt } from './work-clock.js';

/** The board's step key ('orderScheduled', 'step11_5') → its code ('SO-0', 'SO-11.5'). */
export const soStepCode = (key) => (key === 'orderScheduled' ? 'SO-0' : `SO-${key.replace('step', '').replace(/_/g, '.')}`);

const HOUR_MIN = 60;
/** The board writes a day-long SLA as N × 8 × 60: an 8-hour office day, 09:30–13:30 + 14:00–18:00. */
const OFFICE_DAY_MIN = 8 * HOUR_MIN;

/**
 * Step-0's plan before a dispatch date is set: the last approval + 3 working
 * days (lib/so-fms-step0.js). The step's plan is the board's own rule in the
 * registry ('authority'), so this is its one statement.
 */
export const ORDER_SCHEDULED_LEAD_MIN = 3 * OFFICE_DAY_MIN;

/** SO FMS due times the board adds to an anchor, in working minutes (lib/so-fms-planned.js). */
export const SO_SLA_MIN = Object.freeze({
  step2: 3 * HOUR_MIN,
  step5: 12 * OFFICE_DAY_MIN,
  step6: 7 * OFFICE_DAY_MIN,
  step7: 1 * OFFICE_DAY_MIN,
  step8: 6 * HOUR_MIN,
  step9: 2 * OFFICE_DAY_MIN,
  step10: 1 * OFFICE_DAY_MIN,
  step11_5: 3 * HOUR_MIN,
  step12: 6 * HOUR_MIN,
  step13: 1 * HOUR_MIN,
  step14: 6 * OFFICE_DAY_MIN,
});

/**
 * When an SO FMS SLA step falls due: its anchor plus the registry's time for
 * the step, on the plan's calendar (the office one). The board's own minutes
 * stand in while no rules are loaded.
 *
 * @param {string} boardKey  'step5', 'step11_5' …
 * @param {Date|null} anchor
 * @returns {Date|null}
 */
export function soSlaPlannedAt(boardKey, anchor) {
  return stepPlannedAt(FLOW.SO_FMS, soStepCode(boardKey), anchor, { minutes: SO_SLA_MIN[boardKey] });
}
