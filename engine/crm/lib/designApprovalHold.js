// VERBATIM COPY of CRM lib/designApprovalHold.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * Pausing a design-approval step's clock.
 *
 * Every step on the Design Approval screen measures lateness against `now` until
 * its decision lands — so a wait nobody here controls (buyer travelling,
 * management away, a deliberate "hold off until next week") piles up as CRM's
 * delay with no way to stop it. A hold takes that time back out.
 *
 * How the clock actually stops: the delay is not frozen, it is *reduced* by the
 * working minutes the step spent on hold. While a hold is running that reduction
 * grows at exactly the rate the raw delay grows, so the two cancel and the number
 * on screen stands still. When the hold ends the minutes are banked and the delay
 * resumes from where it was — permanently shorter by the length of the hold.
 *
 * Only one step can be held at a time, which is not a restriction: the steps are
 * sequential, so only one of them is ever running. Banked minutes are per step,
 * because a hold on the buyer must not shorten management's delay.
 *
 * Calendar comes from `designApprovalSla` — held time is counted in working
 * minutes, so an overnight or Sunday hold costs nobody anything.
 */

import { parseDT, workingMinutesBetween } from './designApprovalSla.js';

/** The three approval steps a hold can apply to. */
export const HOLD_STEPS = [1, 2, 3];

/** Sheet columns. Deliberately NOT the `Design Hold *` family — those belong to
 *  hr-erp's designer clock, which is a different clock on the same row. */
export const HOLD_COLUMNS = {
  step: 'CRM Hold Step',
  reason: 'CRM Hold Reason',
  startedAt: 'CRM Hold Started At',
  by: 'CRM Hold By',
  minutes: {
    1: 'Step1 Hold Minutes',
    2: 'Step2 Hold Minutes',
    3: 'Step3 Hold Minutes',
  },
};

/** A hold with no reason explains nothing later — the reason is the whole record. */
export const HOLD_REASON_MIN = 3;
export const HOLD_REASON_MAX = 300;

export const isHoldStep = (step) => HOLD_STEPS.includes(Number(step));

/** Minutes already banked against `step` by holds that have finished. */
export const bankedHoldMinutes = (row, step) => {
  if (!row || !isHoldStep(step)) return 0;
  const raw = row[`step${Number(step)}HoldMinutes`];
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The step currently paused, or null. */
export const heldStep = (row) => {
  const n = Number(row?.crmHoldStep);
  return isHoldStep(n) ? n : null;
};

export const isStepHeld = (row, step) => heldStep(row) === Number(step);

/** Any step of this row paused right now? */
export const isRowHeld = (row) => heldStep(row) !== null;

/**
 * Working minutes `step` has spent on hold — banked, plus the running hold when
 * this is the step currently paused. The live part is what freezes the display.
 */
export const heldMinutesForStep = (row, step, now = new Date()) => {
  const banked = bankedHoldMinutes(row, step);
  if (!isStepHeld(row, step)) return banked;
  const startedAt = parseDT(row?.crmHoldStartedAt);
  if (!startedAt) return banked;
  return banked + Math.max(0, workingMinutesBetween(startedAt, now));
};

/**
 * A step's delay with its hold time removed. `null` stays `null` — a step whose
 * clock has not started has no delay to adjust.
 */
export const delayAfterHold = (rawDelayMins, heldMins) => {
  if (rawDelayMins === null || rawDelayMins === undefined) return rawDelayMins;
  return rawDelayMins - (heldMins || 0);
};

/** Convenience for the screen: raw delay in, hold-adjusted delay out. */
export const stepDelayWithHold = (row, step, rawDelayMins, now = new Date()) =>
  delayAfterHold(rawDelayMins, heldMinutesForStep(row, step, now));

/**
 * Minutes to bank when the hold on `step` is released — everything it had, now
 * that the running part has stopped running.
 */
export const bankOnResume = (row, step, now = new Date()) =>
  Math.round(heldMinutesForStep(row, step, now));

/** "2h 45m" from working minutes; "—" when nothing has been held. */
export const formatHeldFor = (minutes) => {
  const total = Math.round(Number(minutes) || 0);
  if (total <= 0) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

/** Why this hold can't be accepted, or null when it can. */
export const holdRejectionReason = ({ row, step, reason }) => {
  if (!isHoldStep(step)) return 'Pick which step to hold.';
  const already = heldStep(row);
  if (already !== null) {
    return already === Number(step)
      ? 'This step is already on hold.'
      : `Step ${already} is already on hold — resume it first.`;
  }
  if (String(reason || '').trim().length < HOLD_REASON_MIN) {
    return 'A hold needs a reason — it is the only record of why the clock stopped.';
  }
  return null;
};
