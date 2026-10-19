// VERBATIM COPY of CRM lib/crm-fms-clock.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/crm-fms-clock.js
//
// The CRM FMS board's step clock — planned, hold, extension, status and delay
// for Step-2 (signed PI), Step-3 (advance / LC / deposits) and Step-4 (advance
// confirmation) — as one pure function, so every report reads a PI's steps the
// way app/(app)/pi/fms/page.jsx shows them.
//
// The board does not use the planned times stored in the sheet; it works them
// out again on every load (recomputePlannedForPI):
//   S2 = approval + 3 working days
//   S3 = S2 actual (else the date S2 was extended to, else the S2 plan)
//        + 3 working days — only when required
//   S4 = S3 actual + 3 working hours — only for an advance, and only once S3 is done
// A step's 'Extended DateTime' replaces its plan outright. Otherwise the plan
// moves forward by the PI's hold time (banked minutes plus, while held, the
// working minutes since the hold began). A step at or after the held step shows
// On Hold with no delay. Delay is whole working hours; a step no more than its
// grace late (by default under an hour, the board's pill) reads as on time.
//
// Everything the rules registry decides is read from it (lib/work-clock.js):
// each step's time after its anchor and its calendar (rules.steps[key].plan),
// its grace, whether a PI needs it (requiredWhen) and the office calendar the
// delays are counted on. With no rules loaded the built-in values below run,
// and they are the registry's defaults.
//
// Pure: dates come in parsed (the caller owns the sheet's text formats).

import { addWorkingMinutes, workingMinutesBetween } from './so-working-hours.js';
import { parseSheetDate } from './sheet-date.js';
import { step4ActualFrom } from './crm-fms-advance-confirm.js';
import { evaluate } from './rules/conditions.js';
import { FLOW } from './rules/names.js';
import { HOUR_FLOOR_GRACE_MIN } from './rules/step-clock.js';
import { clockStepRule, isDueToday, stepGraceMin, stepPlannedAt } from './work-clock.js';

/** Each step's time after its anchor, in working minutes: the registry's default plans. */
export const CRM_FMS_SLA_MINUTES = { S2: 3 * 8 * 60, S3: 3 * 8 * 60, S4: 3 * 60 };

/** The sheet's 'Hold Step' keys, in step order. */
const HOLD_STEP_KEYS = ['step5', 'step6', 'step7'];
const STEP_CODES = ['S2', 'S3', 'S4'];

export const CRM_FMS_STEP_NAMES = {
  S2: 'Signed PI Upload',
  S3: 'Advance Payment / LC Upload',
  S4: 'Advance Payment Confirmation',
};

const COMPLETED = 'completed';
const YES = 'yes';
const MINUTES_PER_HOUR = 60;
const DEPOSIT = Object.freeze({ CYLINDER: 'cylinder', SECURITY: 'security' });

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Advance or LC-at-sight in the payment terms. */
export function paymentNeeds(paymentTerms) {
  const terms = lower(paymentTerms);
  return { advance: terms.includes('advance'), lcAtSight: terms.includes('lc at sight') };
}

/** The deposits charged: 'cylinder', 'security' — each answered 'Yes'. */
const depositsOf = (cylinder, security) =>
  [[cylinder, DEPOSIT.CYLINDER], [security, DEPOSIT.SECURITY]].filter(([answer]) => lower(answer) === YES).map(([, name]) => name);

/**
 * The facts the registry's conditions read about a PI (lib/rules/conditions.js
 * FACT_CATALOGUE.crmFms). The deposits come two ways, because two answers can
 * disagree: the board's Step-2 cells, which the charge form writes, and the PI
 * form's own cylinder / bag-security answers.
 *   deposits        the board's cells, the PI form where a cell is blank — the
 *                   board's rule today;
 *   piFormDeposits  the PI form's answers, the board's cells where the form is
 *                   blank — the PI form wins (decision 14).
 *
 * @param {{ paymentTerms?: string, cylinderCharge?: string, securityCharge?: string,
 *   piCylinderCharge?: string, piSecurityCharge?: string }} pi
 */
export function crmFmsFacts({ paymentTerms, cylinderCharge, securityCharge, piCylinderCharge, piSecurityCharge }) {
  return {
    paymentTerms: String(paymentTerms ?? ''),
    deposits: depositsOf(cylinderCharge || piCylinderCharge, securityCharge || piSecurityCharge),
    piFormDeposits: depositsOf(piCylinderCharge || cylinderCharge, piSecurityCharge || securityCharge),
  };
}

/**
 * Which steps a PI needs, built in: S3 also runs for a deposit (cylinder / bag
 * security) alone. S4 confirms an advance only: an LC at sight ends at its S3
 * upload. The Client Wallet, where Step-4 is decided, holds no advance for an LC
 * to confirm, and no LC PI ever had Step-4 closed — 25656 read 194 days late on
 * it (decided 29 Sep 2026). The registry's defaults state the same as conditions.
 */
function builtInRequired(facts) {
  const { advance, lcAtSight } = paymentNeeds(facts.paymentTerms);
  return { S2: true, S3: advance || lcAtSight || facts.deposits.length > 0, S4: advance };
}

/**
 * Which steps a PI needs: each step's `requiredWhen` in the rules, over the
 * PI's facts (crmFmsFacts); the built-in rule while no rules are loaded.
 *
 * @param {Parameters<typeof crmFmsFacts>[0]} pi
 * @returns {{ S2: boolean, S3: boolean, S4: boolean }}
 */
export function requiredSteps(pi) {
  const facts = crmFmsFacts(pi);
  const builtIn = builtInRequired(facts);
  return Object.fromEntries(STEP_CODES.map((code) => {
    const rule = clockStepRule(FLOW.CRM_FMS, code);
    return [code, rule ? evaluate(rule.requiredWhen ?? null, facts) : builtIn[code]];
  }));
}

function holdState(hold, now) {
  const isHeld = lower(hold?.status) === YES;
  const banked = parseInt(hold?.totalMinutes || '0', 10) || 0;
  const running = isHeld && hold?.since && hold.since < now ? workingMinutesBetween(hold.since, now) : 0;
  const heldFrom = HOLD_STEP_KEYS.indexOf(hold?.step || HOLD_STEP_KEYS[0]);
  return {
    minutes: banked + running,
    isStepHeld: (code) => isHeld && heldFrom >= 0 && STEP_CODES.indexOf(code) >= heldFrom,
  };
}

const hourFloor = (minutes) => Math.floor(minutes / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;

/**
 * A step's status, delay (whole working hours, as the board shows it) and
 * verdict. On time is no more than `graceMin` working minutes late; an open
 * step is overdue past it, and due today on its IST calendar day or before.
 */
function clockOf({ planned, actual, done, held, graceMin }, now) {
  if (!planned) return { status: done ? 'DONE' : 'NOPLAN', delayMin: 0, onTime: done };
  if (done) {
    const late = actual && actual > planned ? workingMinutesBetween(planned, actual) : 0;
    return { status: 'DONE', delayMin: hourFloor(late), onTime: late <= graceMin };
  }
  if (held) return { status: 'HOLD', delayMin: 0, onTime: false };
  const late = planned < now ? workingMinutesBetween(planned, now) : 0;
  if (late > graceMin) return { status: 'OVERDUE', delayMin: hourFloor(late), onTime: false };
  return { status: isDueToday(planned, now) ? 'TODAY' : 'UPCOMING', delayMin: 0, onTime: false };
}

/**
 * A cell read the way the board reads it — the sheet's 'MM/DD/YYYY HH:mm:ss'
 * as local (IST) time, ISO-Z as the true instant (lib/sheet-date.js).
 */
export function boardDate(value) {
  return parseSheetDate(value);
}

/**
 * The feed's CRM FMS steps for one PI from /api/pc-report's `crmFmsPis` entry.
 * A step not required is left out; one waiting on an earlier step carries no plan.
 */
export function crmFmsFeedSteps(entry, now) {
  // The board drops a PI whose approval time it cannot read.
  const approvedAt = boardDate(entry.approvedAt);
  if (!approvedAt) return [];
  const fms = entry.fms || {};
  const cell = (name) => fms[name] || '';
  const stepCells = (n) => ({
    status: cell(`Step${n} Status`),
    actual: boardDate(cell(`Step${n} Actual DateTime`)),
    extended: boardDate(cell(`Step${n} Extended DateTime`)),
  });
  const steps = crmFmsSteps({
    approvedAt,
    paymentTerms: entry.paymentTerms,
    cylinderCharge: cell('Step2 Cylinder Charge'),
    securityCharge: cell('Step2 Security Charge'),
    piCylinderCharge: entry.piCylinderCharge,
    piSecurityCharge: entry.piBagSecurityCharge,
    signedPiUploaded: !!cell('Step2 Signed PI URL'),
    steps: { S2: stepCells(2), S3: stepCells(3), S4: stepCells(4) },
    hold: {
      status: cell('Hold Status'),
      step: cell('Hold Step'),
      since: boardDate(cell('Hold Date')),
      totalMinutes: cell('Total Hold Minutes'),
    },
    walletAdvanceAt: boardDate(entry.walletAdvanceAt),
    walletAdvanceConfirmed: entry.walletAdvanceConfirmed || null,
  }, now);

  const stepNumber = { S2: 2, S3: 3, S4: 4 };
  return steps.filter((s) => s.required).map((s) => ({
    id: `${entry.piNumber}-${s.code}`,
    indentNo: entry.piNumber,
    piNo: entry.piNumber,
    buyerName: entry.buyerName,
    brand: entry.brand,
    paymentTerms: entry.paymentTerms,
    country: entry.country,
    stepCode: s.code,
    stepName: `Step ${stepNumber[s.code]}: ${CRM_FMS_STEP_NAMES[s.code]}`,
    tab: 'CRM FMS',
    owner: entry.ownerEmail || entry.owner,
    delayReason: cell(`Step${stepNumber[s.code]} Delay Reason`),
    planned: s.plannedAt ? s.plannedAt.toISOString() : '',
    planDate: s.plannedAt,
    actual: s.actualAt ? s.actualAt.toISOString() : '',
    actDate: s.actualAt,
    status: s.status,
    delayMin: s.delayMin,
    onTime: s.onTime,
    isHeld: s.status === 'HOLD',
    // Reports cut a PI by its approval date, never a step's plan. The board still
    // shows an older PI once it has a CRM FMS row, but no report chases it:
    // 26061 (approved 8 May, cutoff 13 May) was a shipped, paid order read 117
    // days late.
    cutoffRef: approvedAt,
    clockFromBoard: true,
  }));
}

/**
 * A step's plan from its anchor: the registry's time for it on its calendar
 * (CRM_FMS_SLA_MINUTES built in). The board page plans with it too.
 *
 * @param {'S2'|'S3'|'S4'} code
 * @param {Date|null} anchor
 * @returns {Date|null}
 */
export const crmFmsPlannedAt = (code, anchor) =>
  stepPlannedAt(FLOW.CRM_FMS, code, anchor, { minutes: CRM_FMS_SLA_MINUTES[code] });
const planOf = crmFmsPlannedAt;

/** The board page's step keys ('step5' … 'step7', the sheet's Hold Step values) → codes. */
export const CRM_FMS_CODE_OF_BOARD_STEP = Object.freeze(Object.fromEntries(HOLD_STEP_KEYS.map((key, i) => [key, STEP_CODES[i]])));

/**
 * The delay the board shows for a step, in whole working hours: none while the
 * step is no more than its grace late (the rules' — under an hour by default,
 * where flooring alone gives 0), the floored hours past it.
 *
 * @param {'S2'|'S3'|'S4'} code
 * @param {number} minutesLate  Working minutes past the plan.
 */
export function boardDelayHours(code, minutesLate) {
  const late = Math.max(0, minutesLate || 0);
  return late > stepGraceMin(FLOW.CRM_FMS, code, HOUR_FLOOR_GRACE_MIN) ? Math.floor(late / MINUTES_PER_HOUR) : 0;
}

/**
 * The board's three steps for one PI.
 *
 * @param {object} pi
 * @param {Date}   pi.approvedAt      PI Data 'Approval Timestamp'
 * @param {string} pi.paymentTerms
 * @param {string} pi.cylinderCharge  sheet 'Step2 Cylinder Charge'
 * @param {string} pi.securityCharge  sheet 'Step2 Security Charge'
 * @param {string} [pi.piCylinderCharge]  the PI form's cylinder-charge answer
 * @param {string} [pi.piSecurityCharge]  the PI form's bag-security answer
 * @param {object} pi.steps           { S2|S3|S4: { status, actual: Date|null, extended: Date|null } }
 * @param {boolean} pi.signedPiUploaded  a Step-2 Signed PI URL exists (the board then counts S2 done)
 * @param {object} pi.hold            { status, step, since: Date|null, totalMinutes }
 * @param {Date|null} pi.walletAdvanceAt  advance the Client Wallet already holds for this PI
 * @param {object|null} pi.walletAdvanceConfirmed  the wallet's { confirmedAt, onReceipt } for this PI's advance
 * @param {Date} now
 * @returns {{code: string, required: boolean, plannedAt: Date|null, actualAt: Date|null,
 *            status: string, delayMin: number, onTime: boolean}[]}
 */
export function crmFmsSteps(pi, now) {
  const required = requiredSteps(pi);
  const hold = holdState(pi.hold, now);
  const step = (code) => pi.steps?.[code] || {};

  const s2 = { ...step('S2'), done: lower(step('S2').status) === COMPLETED || !!pi.signedPiUploaded };
  const s3 = { ...step('S3'), done: lower(step('S3').status) === COMPLETED };
  const s4 = { ...step('S4'), done: lower(step('S4').status) === COMPLETED };

  // A Client Wallet advance closes Step-3 the board's way: only for an advance
  // PI, and never over a step already completed with its own actual.
  if (required.S3 && paymentNeeds(pi.paymentTerms).advance && pi.walletAdvanceAt && !(s3.done && s3.actual)) {
    s3.done = true;
    s3.actual = s3.actual || pi.walletAdvanceAt;
  }

  // Step-4 is decided in the Client Wallet. Its confirmation closes the step
  // even when the sheet mirror was lost, and a later sheet stamp does not make
  // it late (lib/crm-fms-advance-confirm.js).
  if (required.S4 && pi.walletAdvanceConfirmed) {
    s4.actual = step4ActualFrom(pi.walletAdvanceConfirmed, s3.actual, s4.done ? s4.actual : null);
    s4.done = true;
  }

  const plan2 = planOf('S2', pi.approvedAt);
  // Until the signed PI arrives, S3 runs from the date S2 was extended to: the
  // advance is not due before the PI it follows. 26025's S2 moved to 24 Sep, yet
  // S3 still counted from May and read 111 days late.
  const s3Base = s2.actual || s2.extended || plan2;
  const plan3 = required.S3 ? planOf('S3', s3Base) : null;
  const plan4 = required.S4 ? planOf('S4', s3.actual) : null;

  const effective = (planned, extended) => {
    if (extended) return extended;
    if (!planned || hold.minutes <= 0) return planned;
    return addWorkingMinutes(planned, hold.minutes);
  };

  return [
    ['S2', s2, plan2],
    ['S3', s3, plan3],
    ['S4', s4, plan4],
  ].map(([code, st, planned]) => {
    if (!required[code]) {
      return { code, required: false, plannedAt: null, actualAt: null, status: 'NOT_REQUIRED', delayMin: 0, onTime: false };
    }
    const plannedAt = effective(planned, st.extended);
    const graceMin = stepGraceMin(FLOW.CRM_FMS, code, HOUR_FLOOR_GRACE_MIN);
    const clock = clockOf({ planned: plannedAt, actual: st.actual, done: st.done, held: hold.isStepHeld(code), graceMin }, now);
    return { code, required: true, plannedAt, actualAt: st.done ? st.actual || null : null, ...clock };
  });
}
