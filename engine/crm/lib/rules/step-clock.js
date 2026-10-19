// VERBATIM COPY of CRM lib/rules/step-clock.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/step-clock.js
//
// What a board's clock reads off the rules: a step's due-time rule, its grace
// and the calendars, and the one "due today" every clock shares.
//
// A step rule's `plan` is { anchor, add: { n, unit }, calendar } for an SLA
// step — due a fixed time after its anchor — or 'authority' when its board
// decides the due time some other way (a dispatch date, a payment term). The
// anchor stays the board's to find: each board already reads it off its own
// rows (lib/crm-fms-clock.js, lib/so-fms-planned.js, lib/designApprovalClock.js)
// and the rule's anchor names the same moment in words. What the rules decide
// is how long the step has and on which working calendar, so a TAT or a window
// edited in Settings > Report Rules moves the board and every report together.
//
// Pure. lib/work-clock.js holds the rules a process runs on and builds the
// calendars' clocks; this file only reads rules it is handed.

import { PLAN_UNIT } from './contract.js';
import { publicDutiesOf } from './duties.js';
import { FLOW } from './names.js';
import { DUTY } from './owners-default.js';
import { DAY_MS, IST_OFFSET_MS, toEpochMs } from './time.js';
import { cloneData, isPlainObject } from './util.js';

/** The flows whose steps a board's own clock computes — and so a browser board reads. */
export const BOARD_FLOWS = Object.freeze([FLOW.CRM_FMS, FLOW.SO_FMS, FLOW.DESIGN_APPROVAL, FLOW.TICKET]);

/** A step rule's fields a board's clock reads. */
export const CLOCK_STEP_FIELDS = Object.freeze(['flow', 'code', 'calendar', 'graceMin', 'cutoffKey', 'plan', 'requiredWhen']);

/** The duties a board names on its own: the SO FMS board's Step-0 header names the order scheduling duty's holder. */
export const BOARD_DUTIES = Object.freeze([DUTY.ORDER_SCHEDULING]);

/* ── finding a step ──────────────────────────────────────────────────────── */

/** Each rule set's steps by flow and code, built once per rule set. */
const indexes = new WeakMap();

function stepIndex(rules) {
  let index = indexes.get(rules);
  if (!index) {
    index = new Map();
    Object.values(isPlainObject(rules.steps) ? rules.steps : {}).forEach((rule) => {
      if (isPlainObject(rule)) index.set(`${rule.flow}|${rule.code}`, rule);
    });
    indexes.set(rules, index);
  }
  return index;
}

/**
 * The rule of a board's step, found by its flow and board code — 'soFms',
 * 'SO-11.5' — as lib/step-feed/registry.js meets a feed item with its rule.
 *
 * @param {object|null} rules  Resolved rules, or the browser's clock rules (clockRulesOf).
 * @returns {object|null}  null without rules, or when they hold no such step.
 */
export function stepRuleOf(rules, flow, code) {
  if (!isPlainObject(rules)) return null;
  return stepIndex(rules).get(`${flow}|${code}`) || null;
}

/** The step's plan when it is "anchor + time"; null for 'authority' or no rule. */
export const slaPlanOf = (rule) => (isPlainObject(rule?.plan) && isPlainObject(rule.plan.add) ? rule.plan : null);

/**
 * The grace of a board that floors its delays to whole working hours — CRM FMS
 * and SO FMS: anything under an hour late reads on time.
 */
export const HOUR_FLOOR_GRACE_MIN = 59;

/** The step's grace in working minutes, or `fallback` when no rule says. */
export const graceOf = (rule, fallback) => (Number.isFinite(rule?.graceMin) ? rule.graceMin : fallback);

/* ── a plan's due time ───────────────────────────────────────────────────── */

/** The working minutes a plan adds on its calendar's clock. */
export function planMinutes(plan, clock) {
  const { n, unit } = plan.add;
  return unit === PLAN_UNIT.WORKING_DAYS ? n * clock.minutesPerDay : n;
}

/**
 * When an SLA plan falls due from its anchor, on its calendar's clock
 * (lib/rules/calendar.js createWorkCalendar). Working minutes and working days
 * count working time; calendar days count whole days and then move to the next
 * working moment, as a deadline nobody is at a desk for is not one.
 *
 * @param {{ add: { n: number, unit: string } }} plan
 * @param {Date|number|string} anchor
 * @param {ReturnType<import('./calendar.js').createWorkCalendar>} clock
 * @returns {Date|null}
 */
export function planDueAt(plan, anchor, clock) {
  if (plan.add.unit !== PLAN_UNIT.CALENDAR_DAYS) return clock.addWorkingMinutes(anchor, planMinutes(plan, clock));
  const at = toEpochMs(anchor);
  return at === null ? null : clock.addWorkingMinutes(at + plan.add.n * DAY_MS, 0);
}

/* ── due today ───────────────────────────────────────────────────────────── */

const istDay = (ms) => Math.floor((ms + IST_OFFSET_MS) / DAY_MS);

/**
 * Is a step that is not overdue due today: planned on or before the end of
 * now's IST calendar day? A plan tonight is today's; one at 09:30 tomorrow is
 * not, however close. One already past but still inside its grace is today's
 * too. Every board clock's TODAY is this one rule (decision 5).
 *
 * @param {Date|number|string} planned
 * @param {Date|number|string} now
 */
export function isDueToday(planned, now) {
  const plannedMs = toEpochMs(planned);
  const nowMs = toEpochMs(now);
  return plannedMs !== null && nowMs !== null && istDay(plannedMs) <= istDay(nowMs);
}

/* ── the rules as a browser board's clock reads them ─────────────────────── */

const pick = (record, fields) => Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, cloneData(record[field])]));

/**
 * The resolved rules trimmed to what a board's clock reads in the browser:
 * the calendars, the cutoffs and the board bypass, and each board step's
 * calendar, grace, cutoff, plan and condition — and the duties a board names
 * (BOARD_DUTIES), each its label and people by email and name. GET
 * /api/work-calendar sends it to any signed-in user beside the holidays, since
 * every board runs a clock.
 *
 * @param {import('./contract.js').Rules|null} rules
 * @returns {object|null}  null without rules.
 */
export function clockRulesOf(rules) {
  if (!isPlainObject(rules)) return null;
  const steps = Object.entries(isPlainObject(rules.steps) ? rules.steps : {})
    .filter(([, rule]) => isPlainObject(rule) && BOARD_FLOWS.includes(rule.flow))
    .map(([key, rule]) => [key, pick(rule, CLOCK_STEP_FIELDS)]);
  return {
    version: rules.version ?? null,
    orgId: String(rules.orgId ?? ''),
    calendars: cloneData(isPlainObject(rules.calendars) ? rules.calendars : {}),
    cutoffs: cloneData(isPlainObject(rules.cutoffs) ? rules.cutoffs : {}),
    boardBypass: cloneData(isPlainObject(rules.boardBypass) ? rules.boardBypass : {}),
    steps: Object.fromEntries(steps),
    duties: publicDutiesOf(rules, BOARD_DUTIES),
  };
}
