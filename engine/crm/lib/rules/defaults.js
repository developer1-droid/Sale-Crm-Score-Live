// VERBATIM COPY of CRM lib/rules/defaults.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/defaults.js
//
// The report rules as the code applies them TODAY — calendars, cutoffs, every
// step, the fixed duties, the designers and the four scores — in the shape of
// the shared rules contract.
//
// These are not the owner's decisions of 10 Oct 2026 (those are an overlay in
// ./decisions-2026-10-10.js). They are what the reports do now, built from the
// constants they would replace wherever those are exported, so adopting the
// registry changes nothing until a rule is edited. Where two reports disagree
// today, the value here is the board's or the most common one, and the step's
// `source` names where it comes from.
//
// Some values live in Settings (systemSettings/globalCutoffDates). The cutoff
// dates are left '' for the loader to fill from crmFms / soFms / designReq; the
// management reviewer (managementNotifyEmail) leaves the Management duty empty;
// the reward rule holds the values the app uses until Settings sets
// rewardTopN / rewardMinScore.
//
// Pure and Firebase-free.

import { DEFAULT_ORG_CONFIG } from '../org-config.js';
import { profileOfOrgCalendar, profileOfWorkCfg } from './calendar.js';
import { WORK_CFG as DESIGN_APPROVAL_WORK_CFG } from '../designApprovalSla.js';
import { WORK_CFG as DESIGNER_WORK_CFG } from '../workingHours.js';
import { DEFAULT_DESIGNERS, DEFAULT_DUTIES } from './owners-default.js';
import { DEFAULT_PROFILES } from './profiles-default.js';
import { CALENDAR, CUTOFF, DEFAULT_STEPS } from './steps-default.js';

/**
 * @typedef {{ all: Condition[] } | { any: Condition[] } | { not: Condition }
 *   | { fact: string, op: 'eq'|'neq'|'in'|'includes'|'exists'|'before'|'after', value?: * }} Condition
 *
 * @typedef {object} StepRule
 * @property {string} key        registry key, `${flow}:${code}` (see stepKeyOf)
 * @property {'crmFms'|'soFms'|'designApproval'|'designRequest'|'ticket'|'hrerpDesign'|'hrerpCylinder'|'hrerpPurchase'} flow
 * @property {string} code
 * @property {string} label
 * @property {string} authority  the board or desk that runs the step, e.g. 'crm:soBoard'
 * @property {'pi'|'so'|'ci'|'designRow'|'ticket'|'job'} grain
 * @property {{ kind: 'piOwner'|'requester'|'duty'|'designer'|'assignee'|'hrerpDoer'|'management', duty?: string }} owner
 * @property {string} calendar   a key of Rules.calendars
 * @property {number} graceMin
 * @property {string|null} cutoffKey  a key of Rules.cutoffs
 * @property {boolean} chase
 * @property {string[]} scoreIn  keys of Rules.profiles; [] = not scored
 * @property {Condition|null} requiredWhen
 * @property {string[]} exclusions
 * @property {'authority' | { anchor: string, add: { n: number, unit: 'workingMinutes'|'workingDays'|'calendarDays' }, calendar: string }} plan
 * @property {string|null} effectiveFrom  'YYYY-MM-DD'
 * @property {string} source  file:line where today's behaviour comes from
 *
 * @typedef {object} ScoringProfile
 * @property {string} key
 * @property {string} label
 * @property {'crmExecWeighted'|'pcDeskWeighted'|'designerLegacy'|'missPct'} formula
 * @property {object} params
 * @property {'rolling'|'istCalendar'} period
 * @property {{ carryOver: 'scored'|'listed', earlyFinish: 'now'|'atPlanned', freezeOnClose: boolean }} outcome
 * @property {{ topN: number, minScore: number } | null} reward
 * @property {{ grade: string, min: number }[] | null} grades
 * @property {Condition|null} cohort
 *
 * @typedef {object} Rules
 * @property {number} version
 * @property {string} orgId
 * @property {Object<string, { tz: string, windows: { start: string, end: string }[], workingDays: number[], holidays: 'hrerp'|'none' }>} calendars
 * @property {Object<string, { date: string, basis: 'piApproval'|'stepPlanned'|'latestActivity', atIstMidnight: boolean }>} cutoffs
 * @property {Object<string, 'none'|'hasFmsRow'|'hasMasterRow'>} boardBypass
 * @property {Object<string, StepRule>} steps
 * @property {Object<string, { label: string, people: { email: string, name: string }[] }>} duties
 * @property {{ email: string, name: string, hrerpUserId: string|null, aliases: string[] }[]} designers
 * @property {Object<string, ScoringProfile>} profiles
 */

export const RULES_VERSION = 1;

export const HOLIDAYS = Object.freeze({ HRERP: 'hrerp', NONE: 'none' });

export const CUTOFF_BASIS = Object.freeze({
  PI_APPROVAL: 'piApproval',
  STEP_PLANNED: 'stepPlanned',
  LATEST_ACTIVITY: 'latestActivity',
});

export const BOARD_BYPASS = Object.freeze({ NONE: 'none', HAS_FMS_ROW: 'hasFmsRow', HAS_MASTER_ROW: 'hasMasterRow' });

/** The cutoff dates live in Settings; the loader writes them in. */
const DATE_FROM_SETTINGS = '';

const OFFICE = DEFAULT_ORG_CONFIG.calendar;

export const DEFAULT_CALENDARS = {
  // The CRM FMS, SO FMS, ticket and MIS clocks: Mon–Sat 09:30–18:00, lunch
  // 13:30–14:00, Sundays only — no holidays (lib/so-working-hours.js:14-22,
  // lib/so-fms-datetime.js:182-190, app/api/tickets/route.js:31-39,
  // hooks/useMisSteps.js:40-44). lib/org-config.js:25-35 states the same hours.
  [CALENDAR.OFFICE]: profileOfOrgCalendar(OFFICE, HOLIDAYS.NONE),
  // The Design Approval clock: the same hours, skipping HR-ERP's office
  // holidays (lib/designApprovalSla.js:19-41).
  [CALENDAR.OFFICE_DA]: profileOfWorkCfg(DESIGN_APPROVAL_WORK_CFG, HOLIDAYS.HRERP),
  // The designer's clock, 09:45–18:30 with HR-ERP's holidays — HR-ERP's own
  // office calendar (lib/workingHours.js WORK_CFG, whose clock reads this one).
  [CALENDAR.DESIGNER]: profileOfWorkCfg(DESIGNER_WORK_CFG, HOLIDAYS.HRERP),
};

// Every consumer reads a cutoff with `new Date('YYYY-MM-DD')`, which is UTC
// midnight — 05:30 IST — so none is at IST midnight today.
export const DEFAULT_CUTOFFS = {
  // Against the PI's approval date: hooks/useMisSteps.js:457-471,
  // lib/pending-chase.js:59-64,114, lib/reports/deptPerformance.js:72-79 with
  // cutoffRef = approval (lib/crm-fms-clock.js:153-157).
  [CUTOFF.CRM_FMS]: { date: DATE_FROM_SETTINGS, basis: CUTOFF_BASIS.PI_APPROVAL, atIstMidnight: false },
  // Against the PI's approval date: every SCORE that reads this cutoff compares
  // the order's approval (lib/reports/deptPerformance.js:72-79,
  // lib/scoring/crmExecScore.js:169, hooks/useMisSteps.js:377 cutoffRef), and
  // the SO FMS board gates on the CRM FMS date against the PI approval
  // (lib/pending-chase.js:59-64). Only the PC chase list and the MIS KPIs hold
  // this date against the step's plan instead (lib/pending-chase.js:82,
  // lib/reports/misScope.js:71) — the disagreement is noted on each SO step's
  // source, and the owner's overlay retires this cutoff altogether.
  [CUTOFF.SO_FMS]: { date: DATE_FROM_SETTINGS, basis: CUTOFF_BASIS.PI_APPROVAL, atIstMidnight: false },
  // Design, Design Approval and tickets, against the step's plan (or its actual
  // when there is no plan): lib/reports/deptPerformance.js:37-44,72-79,
  // lib/scoring/crmExecScore.js:172-173, app/(app)/pc-report/page.jsx:290,311.
  [CUTOFF.DESIGN_REQ]: { date: DATE_FROM_SETTINGS, basis: CUTOFF_BASIS.STEP_PLANNED, atIstMidnight: false },
  // The Design Approval board's own line: the CRM FMS date against the latest of
  // the PI's approval, the request and the submission (lib/design-visibility.js,
  // lib/rules/scope.js boardCutoffOf). The board reads it; no step does until
  // the owner's overlay cuts Design Approval steps by it (decision 7). The loader
  // fills its date from the CRM FMS setting (lib/rules/resolve.js LEGACY_CUTOFF_SOURCE).
  [CUTOFF.DESIGN_APPROVAL]: { date: DATE_FROM_SETTINGS, basis: CUTOFF_BASIS.LATEST_ACTIVITY, atIstMidnight: false },
};

// The CRM FMS board shows a pre-cutoff PI that has a CRM FMS row
// (app/(app)/pi/fms/page.jsx:3601-3609) and the SO FMS board one with a master
// tracker row (app/(app)/pi/sofms/page.jsx:7276-7286); no report follows them.
export const DEFAULT_BOARD_BYPASS = {
  crmFms: BOARD_BYPASS.NONE,
  soFms: BOARD_BYPASS.NONE,
};

/** Freeze rules data all the way down, so a reader can never edit the shared copy. */
export function freezeRules(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeRules);
    Object.freeze(value);
  }
  return value;
}

/** @type {Readonly<Rules>} */
export const DEFAULT_RULES = freezeRules({
  version: RULES_VERSION,
  orgId: DEFAULT_ORG_CONFIG.orgId,
  calendars: DEFAULT_CALENDARS,
  cutoffs: DEFAULT_CUTOFFS,
  boardBypass: DEFAULT_BOARD_BYPASS,
  steps: DEFAULT_STEPS,
  duties: DEFAULT_DUTIES,
  designers: DEFAULT_DESIGNERS,
  profiles: DEFAULT_PROFILES,
});
