// VERBATIM COPY of CRM lib/rules/steps-default.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/steps-default.js
//
// Every step the reports read today, as data: who owns it, when it is due, how
// late still reads on time, whether the PC report and the digest chase it, and
// which scores count it.
//
// These are TODAY's rules, read off the code that applies them; each step's
// `source` names the file:line it comes from. Nothing here changes behaviour —
// the registry only describes the boards until they are wired to read it.
//
// Reading a step:
//   graceMin  a step done (or open) this many working minutes late, or less,
//             is on time.
//   plan      { anchor, add, calendar } is the step's due-time rule — the base
//             its board applies before its own extensions, manual dates and
//             hold time. 'authority' means the rule is not "anchor + time" (a
//             dispatch date, a payment term, a desk queue) and stays with the
//             board or desk that runs the step.
//   anchor    a timestamp fact (PLAN_ANCHOR_FACTS), or `<code>.actual`,
//             `<code>.planned`, `<code>.extended` of another step of the same
//             flow; `a|b` takes the first one present; `latest(a,b)` the later
//             of those present.
//   chase     the PC report and the pending digest list it while it is open.
//   scoreIn   the scores that count it, each still limited by its own cohort.
//
// Pure and Firebase-free.

import { CRM_FMS_SLA_MINUTES, CRM_FMS_STEP_NAMES } from '../crm-fms-clock.js';
import { SO_STEPS, SO_STEP_LABELS } from '../so-fms-catalog.js';
import { CI_STEP_KEYS, soStepCode } from '../so-fms-step-feed.js';
import { SO_SLA_MIN } from '../so-fms-sla.js';
import { SLA_MINUTES as DA_REVIEW_SLA_MIN } from '../designApprovalSla.js';
import { ON_TIME_GRACE_MIN as DA_GRACE_MIN, WORKING_DAY_MINS } from '../designApprovalClock.js';
import { MANAGEMENT_CATEGORIES, MANAGEMENT_STEP_LIVE_AT } from '../designManagementApproval.js';
import { CRM_SO_STEPS } from '../reports/deptPerformance.js';
import { CUTOFF, PLAN_UNIT, STEP_KEY_DOT, STEP_KEY_SEPARATOR } from './contract.js';
import { CALENDAR, FLOW } from './names.js';
import { DUTY, OWNER_KIND } from './owners-default.js';
import { HOUR_FLOOR_GRACE_MIN } from './step-clock.js';
import { PROFILE } from './profiles-default.js';

/* ── names the steps reference ───────────────────────────────────────────── */

// The flow and calendar names live in ./names.js, which the clocks read too.
export { FLOW };

export const AUTHORITY = Object.freeze({
  CRM_FMS: 'crm:crmFms',
  SO_BOARD: 'crm:soBoard',
  DESIGN_APPROVAL: 'crm:designApproval',
  TICKETS: 'crm:tickets',
  HRERP_DESIGN: 'hrerp:design',
  HRERP_CYLINDER: 'hrerp:cylinder',
  HRERP_PURCHASE: 'hrerp:purchase',
});

export const GRAIN = Object.freeze({
  PI: 'pi', SO: 'so', CI: 'ci', DESIGN_ROW: 'designRow', TICKET: 'ticket', JOB: 'job',
});

export { CALENDAR };

// The cutoff keys belong to the contract; re-exported for the readers of this module.
export { CUTOFF };

export const PLAN_BY_AUTHORITY = 'authority';

const WORKING_MINUTES = PLAN_UNIT.WORKING_MINUTES;

/**
 * Registry key of a step, in the contract's format: '<flow>:<code>' with the
 * code's '.' written as '_' (SO-11.5 → 'soFms:SO-11_5'), so a key never reads
 * as a nested field path when the rules are stored.
 */
export const stepKeyOf = (flow, code) => `${flow}${STEP_KEY_SEPARATOR}${String(code).replace(/\./g, STEP_KEY_DOT)}`;

/* ── what a step is judged against ───────────────────────────────────────── */

/**
 * The CRM FMS and SO FMS boards floor a delay to whole working hours
 * (lib/crm-fms-clock.js:76-85, lib/so-fms-planned.js:289-291 read through
 * lib/so-fms-step-feed.js:36-37), so anything under an hour late is on time.
 */
export const UNDER_AN_HOUR_GRACE_MIN = HOUR_FLOOR_GRACE_MIN;

/** Tickets, the legacy design rows and the designer score allow no grace (hooks/useMisSteps.js:232-233, lib/scoring/designerScore.js:84-86). */
export const NO_GRACE_MIN = 0;

const HOUR_MIN = 60;

/**
 * Management approval is due this many working hours after its anchor unless
 * Settings says otherwise (managementPlannedHours, store/systemSettingsSlice.js:17,59
 * and hooks/useMisSteps.js:387 default to 1). lib/rules/resolve.js lays the
 * Settings value over this plan.
 */
export const MANAGEMENT_DEFAULT_HOURS = 1;

/** SO FMS due times the board adds to an anchor, written once in lib/so-fms-sla.js. */
export { SO_SLA_MIN };

const planOn = (calendar) => (anchor, minutes) => ({ anchor, add: { n: minutes, unit: WORKING_MINUTES }, calendar });
const officePlan = planOn(CALENDAR.OFFICE);
const daPlan = planOn(CALENDAR.OFFICE_DA);

/** The timestamp facts a plan anchor may name. */
export const PLAN_ANCHOR_FACTS = Object.freeze({
  piApprovedAt: "PI Data 'Approval Timestamp' (lib/crm-fms-clock.js:105)",
  stuffingFormAt: 'Container stuffing form timestamp (lib/so-fms-planned.js:138)',
  sobFormAt: 'SOB confirmation form timestamp, read day-first (lib/so-fms-planned.js:147-151)',
  docsScanFormAt: 'Final docs scan form timestamp (lib/so-fms-planned.js:158)',
  latestPaymentAt: 'The newest payment or advance entry on Step-11 (lib/so-fms-planned.js:208-213)',
  arrivalAt: "The container's actual arrival date (lib/so-fms-planned.js:220)",
  telexRequestAt: 'The CRM telex request form timestamp (lib/so-fms-planned.js:229)',
  designSubmittedAt: "Design Requests 'Design Submitted At' (lib/designApprovalClock.js:59)",
  managementSentAt: "Design Requests 'Management Sent At', else the approval that opens the management step — CRM approval for private-label-regular, buyer approval for private-label-new — and never before the step went live on 5 Aug 2026 (lib/designApprovalClock.js:128-143)",
  buyerApprovedAt: "Design Requests 'Buyer Approved At'",
  packagingPoApprovedAt: "The packaging PO's approval, from HR-ERP (hr-erp lib/cylinder/anchor.ts:7-15)",
});

/** Named exclusions a step may carry, and where each is applied today. */
export const EXCLUSION = Object.freeze({
  REJECTED_PI: 'rejectedPi',
  HELD: 'held',
  WAITING_APPROVALS: 'waitingApprovals',
  TELEX_ACKNOWLEDGED: 'telexAcknowledged',
  CLOSED_REQUEST: 'closedRequest',
  UNASSIGNED: 'unassigned',
  BUYER_PROVIDED_DESIGN: 'buyerProvidedDesign',
  REDO_NOT_DESIGNER_FAULT: 'redoNotDesignerFault',
});

export const EXCLUSION_MEANING = Object.freeze({
  [EXCLUSION.REJECTED_PI]: 'The PI was rejected: none of its steps are listed or scored (hooks/useMisSteps.js:359-364, lib/pending-chase.js:61).',
  [EXCLUSION.HELD]: 'On hold: the clock is paused, so the step is neither chased nor late (lib/crm-fms-clock.js:84, lib/so-fms-step-feed.js:38, lib/designApprovalClock.js:211).',
  [EXCLUSION.WAITING_APPROVALS]: 'Step-0 waits for the design and SO approvals: no plan yet (lib/so-fms-step-feed.js:39).',
  [EXCLUSION.TELEX_ACKNOWLEDGED]: 'A telex parked on "Proceed upon Acknowledgement" waits on accounts (lib/so-fms-step-feed.js:64).',
  [EXCLUSION.CLOSED_REQUEST]: 'A closed design request is abandoned work (app/api/pc-report/route.js:634-637, app/(app)/scoreboard/page.jsx:422).',
  [EXCLUSION.UNASSIGNED]: 'A design with no assigned designer is not ranked (lib/scoring/designerScore.js:121).',
  [EXCLUSION.BUYER_PROVIDED_DESIGN]: "The buyer supplied the artwork (design category 'buyer provided', lib/so-fms-transform.js:261).",
  [EXCLUSION.REDO_NOT_DESIGNER_FAULT]: "A redo round whose revision was the buyer's or the CRM's fault, not the designer's (lib/design-fault.js:27-31).",
});

/* ── conditions ──────────────────────────────────────────────────────────── */

// Conditions read the facts as the rows carry them. Text compares trimmed and
// case-blind, but the sheets also write one category three ways — 'our brand',
// 'our_brand', 'Our-Brand' — which the boards fold before comparing
// (lib/designManagementApproval.js:15-19, lib/designRequestHelpers.js:35-49),
// so each name is listed in every spelling.

const factIs = (fact, op, value) => ({ fact, op, value });
const includesAny = (fact, values) => ({ any: values.map((value) => factIs(fact, 'includes', value)) });

/** 'our brand' → 'our brand', 'our_brand', 'our-brand'. */
export const spellingsOf = (phrase) => [...new Set([phrase, phrase.replace(/ /g, '_'), phrase.replace(/ /g, '-')])];

const ADVANCE = 'advance';
const LC_AT_SIGHT = 'lc at sight';
const EGYPT = 'egypt';
export const OUR_BRAND = 'our brand';
// Packaging that carries printed branding, so even an our-brand item needs a
// designer and the buyer's approval (lib/designRequestHelpers.js:47-49).
const PRINTED_PACKAGING = ['jute', 'hdpe', 'nonwoven', ...spellingsOf('non woven')];

/** S3 runs for an advance, an LC at sight or a deposit (lib/crm-fms-clock.js:59-63). */
const S3_REQUIRED = {
  any: [factIs('paymentTerms', 'includes', ADVANCE), factIs('paymentTerms', 'includes', LC_AT_SIGHT), { fact: 'deposits', op: 'exists' }],
};
/** S4 confirms an advance only (lib/crm-fms-clock.js:62). */
const S4_REQUIRED = factIs('paymentTerms', 'includes', ADVANCE);
/** Step-10 is the Egypt-only legalisation leg (lib/so-fms-planned.js:166-179). */
const EGYPT_ONLY = factIs('country', 'includes', EGYPT);
/**
 * Our-brand designs need neither a designer nor the buyer, except on printed
 * packaging (lib/designRequestHelpers.js:56-57, app/api/pc-report/route.js:856).
 */
const NEEDS_DESIGN_SIGN_OFF = {
  not: { all: [factIs('designCategory', 'in', spellingsOf(OUR_BRAND)), { not: includesAny('packagingType', PRINTED_PACKAGING) }] },
};
/** Management approves private-label designs only (lib/designManagementApproval.js:6,22-25). */
const MANAGEMENT_REVIEWED = factIs(
  'designCategory',
  'in',
  MANAGEMENT_CATEGORIES.flatMap((category) => spellingsOf(category.replace(/_/g, ' '))),
);

/* ── shared parts ────────────────────────────────────────────────────────── */

const owner = (kind, duty) => (duty ? { kind, duty } : { kind });
const SCORED_BY_CRM_AND_DESKS = Object.freeze([PROFILE.CRM_EXEC, PROFILE.PC_DESK, PROFILE.DEPT_OTHER]);
const SCORED_BY_DESKS = Object.freeze([PROFILE.PC_DESK, PROFILE.DEPT_OTHER]);

const pad2 = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const SCORED_SOURCE = 'scored lib/reports/deptPerformance.js:59-63,91-101 and lib/scoring/crmExecScore.js:157-188';

/* ── CRM FMS: S2 signed PI, S3 advance / LC / deposits, S4 advance confirmation ── */

function crmFmsStep(code, { requiredWhen, plan, planSource, scoreIn = SCORED_BY_CRM_AND_DESKS, stepOwner = owner(OWNER_KIND.PI_OWNER) }) {
  return {
    key: stepKeyOf(FLOW.CRM_FMS, code),
    flow: FLOW.CRM_FMS,
    code,
    label: CRM_FMS_STEP_NAMES[code],
    authority: AUTHORITY.CRM_FMS,
    grain: GRAIN.PI,
    owner: stepOwner,
    calendar: CALENDAR.OFFICE,
    graceMin: UNDER_AN_HOUR_GRACE_MIN,
    cutoffKey: CUTOFF.CRM_FMS,
    chase: true,
    scoreIn: [...scoreIn],
    requiredWhen,
    exclusions: [EXCLUSION.REJECTED_PI, EXCLUSION.HELD],
    plan,
    effectiveFrom: null,
    source: [
      planSource,
      'owner lib/crm-fms-clock.js:143',
      'on time lib/crm-fms-clock.js:76-85',
      'cut by PI approval lib/crm-fms-clock.js:153-157',
      'chased lib/pending-chase.js:107-131',
      SCORED_SOURCE,
    ].join('; '),
  };
}

const CRM_FMS_STEPS = [
  crmFmsStep('S2', {
    requiredWhen: null,
    plan: officePlan('piApprovedAt', CRM_FMS_SLA_MINUTES.S2),
    planSource: 'lib/crm-fms-clock.js:28,203,211-215',
  }),
  crmFmsStep('S3', {
    requiredWhen: S3_REQUIRED,
    plan: officePlan('S2.actual|S2.extended|S2.planned', CRM_FMS_SLA_MINUTES.S3),
    planSource: 'lib/crm-fms-clock.js:28,59-63,204-208',
  }),
  // Confirming the advance is accounts' work, not the CRM's (owner, 16 Oct 2026, decision 30): the
  // accounts desk owns it and is chased for it, it is never scored to a CRM Executive, the desks count it.
  crmFmsStep('S4', {
    requiredWhen: S4_REQUIRED,
    plan: officePlan('S3.actual', CRM_FMS_SLA_MINUTES.S4),
    planSource: 'lib/crm-fms-clock.js:28,59-63,195-201,209',
    scoreIn: SCORED_BY_DESKS,
    stepOwner: owner(OWNER_KIND.DUTY, DUTY.ACCOUNTS),
  }),
];

/* ── SO FMS: Step-0 to Step-14, Step-11.5 included ────────────────────────── */

const SO_COMMON_SOURCE = [
  'on time lib/so-fms-step-feed.js:35-41',
  'chased lib/pending-chase.js:74-101',
  'cut by PI approval in every score (lib/reports/deptPerformance.js:72-79 and lib/scoring/crmExecScore.js:169 over hooks/useMisSteps.js:378 cutoffRef) and on the board (lib/pending-chase.js:59-64)',
  'the PC chase list and the MIS KPIs also drop a step planned before the SO FMS date (lib/pending-chase.js:82, lib/reports/misScope.js:71) — a disagreement the overlay retires with that cutoff',
  SCORED_SOURCE,
].join('; ');
const PI_OWNER_SOURCE = 'owner hooks/useMisSteps.js:245,372';
const CI_GRAIN_SOURCE = 'once per invoice lib/reports/deptPerformance.js:100,135 (collapseCiSiblings) and lib/pending-digest/board-items.js:124-138';

/** Per board step key: what today's code does that the catalog does not say. */
const SO_STEP_SPEC = {
  orderScheduled: {
    owner: owner(OWNER_KIND.DUTY, DUTY.ORDER_SCHEDULING),
    ownerSource: 'owner lib/so-fms-catalog.js:44-46',
    plan: PLAN_BY_AUTHORITY,
    planSource: 'lib/so-fms-step0.js:7-15,25,63,98 (last approval + 3 working days, or a scheduled dispatch date at 18:00)',
    exclusions: [EXCLUSION.WAITING_APPROVALS],
  },
  step1: { plan: PLAN_BY_AUTHORITY, planSource: 'lib/so-fms-planned.js:56-71 (first dispatch date - 10 working days, at 18:00)' },
  step2: { plan: officePlan('SO-1.actual', SO_SLA_MIN.step2), planSource: 'lib/so-fms-planned.js:104-110' },
  step3: { plan: PLAN_BY_AUTHORITY, planSource: 'lib/so-fms-planned.js:112-121 (latest dispatch date - 2 working days)' },
  step4: { plan: PLAN_BY_AUTHORITY, planSource: 'lib/so-fms-transform.js:650-668 (expected dispatch - 1 working day)' },
  step5: { plan: officePlan('SO-4.actual|SO-4.planned', SO_SLA_MIN.step5), planSource: 'lib/so-fms-planned.js:123-128' },
  step6: { plan: officePlan('SO-5.actual|SO-5.planned', SO_SLA_MIN.step6), planSource: 'lib/so-fms-planned.js:130-135' },
  step7: { plan: officePlan('stuffingFormAt', SO_SLA_MIN.step7), planSource: 'lib/so-fms-planned.js:137-144' },
  step8: { plan: officePlan('sobFormAt', SO_SLA_MIN.step8), planSource: 'lib/so-fms-planned.js:146-155' },
  step9: { plan: officePlan('docsScanFormAt', SO_SLA_MIN.step9), planSource: 'lib/so-fms-planned.js:157-164' },
  step10: {
    plan: officePlan('SO-9.actual|SO-9.planned', SO_SLA_MIN.step10),
    requiredWhen: EGYPT_ONLY,
    planSource: 'lib/so-fms-planned.js:166-179',
  },
  step11: { plan: PLAN_BY_AUTHORITY, planSource: 'lib/so-fms-planned.js:181-205 and lib/so-fms-step11-planned.js (one rule per payment term)' },
  step11_5: {
    plan: officePlan('latestPaymentAt', SO_SLA_MIN.step11_5),
    planSource: 'lib/so-fms-planned.js:207-217; not chased lib/pending-chase.js:20-21,78',
    chase: false,
  },
  step12: { plan: officePlan('arrivalAt', SO_SLA_MIN.step12), planSource: 'lib/so-fms-planned.js:219-226' },
  step13: {
    plan: officePlan('telexRequestAt', SO_SLA_MIN.step13),
    planSource: 'lib/so-fms-planned.js:228-235; parked telex lib/so-fms-step-feed.js:64',
    exclusions: [EXCLUSION.TELEX_ACKNOWLEDGED],
  },
  step14: { plan: officePlan('SO-12.actual', SO_SLA_MIN.step14), planSource: 'lib/so-fms-planned.js:237-244' },
};

function soStep({ key: boardKey }) {
  const spec = SO_STEP_SPEC[boardKey];
  // A board step with no rule here is a step no report would know how to read.
  if (!spec) throw new Error(`rules: SO FMS step '${boardKey}' has no default rule`);
  const code = soStepCode(boardKey);
  const isInvoiceStep = CI_STEP_KEYS.has(boardKey);
  return {
    key: stepKeyOf(FLOW.SO_FMS, code),
    flow: FLOW.SO_FMS,
    code,
    label: SO_STEP_LABELS[boardKey],
    authority: AUTHORITY.SO_BOARD,
    grain: isInvoiceStep ? GRAIN.CI : GRAIN.SO,
    owner: spec.owner || owner(OWNER_KIND.PI_OWNER),
    calendar: CALENDAR.OFFICE,
    graceMin: UNDER_AN_HOUR_GRACE_MIN,
    cutoffKey: CUTOFF.SO_FMS,
    chase: spec.chase ?? true,
    scoreIn: [...(CRM_SO_STEPS.has(code) ? SCORED_BY_CRM_AND_DESKS : SCORED_BY_DESKS)],
    requiredWhen: spec.requiredWhen || null,
    exclusions: [EXCLUSION.REJECTED_PI, EXCLUSION.HELD, ...(spec.exclusions || [])],
    plan: spec.plan,
    effectiveFrom: null,
    source: [
      spec.planSource,
      spec.ownerSource || PI_OWNER_SOURCE,
      ...(isInvoiceStep ? [CI_GRAIN_SOURCE] : []),
      SO_COMMON_SOURCE,
    ].join('; '),
  };
}

const SO_FMS_STEPS = SO_STEPS.map(soStep);

/* ── Design Approval: CRM review, buyer approval, management approval ─────── */

const DA_COMMON_SOURCE = [
  'on time lib/designApprovalClock.js:194,208-213',
  'chased app/(app)/pc-report/page.jsx:273-296',
  'cut by plan date lib/reports/deptPerformance.js:37-44,72-79 and app/(app)/pc-report/page.jsx:290',
  SCORED_SOURCE,
].join('; ');

function daStep(code, label, { stepOwner, plan, requiredWhen = null, effectiveFrom = null, planSource }) {
  return {
    key: stepKeyOf(FLOW.DESIGN_APPROVAL, code),
    flow: FLOW.DESIGN_APPROVAL,
    code,
    label,
    authority: AUTHORITY.DESIGN_APPROVAL,
    grain: GRAIN.DESIGN_ROW,
    owner: stepOwner,
    calendar: CALENDAR.OFFICE_DA,
    graceMin: DA_GRACE_MIN,
    cutoffKey: CUTOFF.DESIGN_REQ,
    chase: true,
    scoreIn: [...SCORED_BY_CRM_AND_DESKS],
    requiredWhen,
    exclusions: [EXCLUSION.REJECTED_PI, EXCLUSION.HELD],
    plan,
    effectiveFrom,
    source: `${planSource}; ${DA_COMMON_SOURCE}`,
  };
}

const DESIGN_APPROVAL_STEPS = [
  daStep('DA-S1', 'Design Approval — CRM Approval', {
    stepOwner: owner(OWNER_KIND.REQUESTER),
    plan: daPlan('designSubmittedAt', DA_REVIEW_SLA_MIN),
    planSource: 'lib/designApprovalClock.js:59-64,235 and lib/designApprovalSla.js:31; owner hooks/useMisSteps.js:398',
  }),
  daStep('DA-S2', 'Design Approval — Buyer Approval', {
    stepOwner: owner(OWNER_KIND.REQUESTER),
    plan: daPlan('DA-S1.actual', WORKING_DAY_MINS),
    requiredWhen: NEEDS_DESIGN_SIGN_OFF,
    planSource: 'lib/designApprovalClock.js:95-110,240; owner hooks/useMisSteps.js:398',
  }),
  // Due the configured management hours after the later of the moment the design
  // was sent to management and its latest (re)submission, so a redo restarts the
  // clock (lib/designApprovalClock.js:143-148).
  daStep('DA-S3', 'Design Approval — Management Approval', {
    stepOwner: owner(OWNER_KIND.MANAGEMENT),
    plan: daPlan('latest(managementSentAt,designSubmittedAt)', MANAGEMENT_DEFAULT_HOURS * HOUR_MIN),
    requiredWhen: MANAGEMENT_REVIEWED,
    effectiveFrom: localYmd(MANAGEMENT_STEP_LIVE_AT),
    planSource: 'lib/designApprovalClock.js:112-156,245 (anchor + Settings managementPlannedHours, hooks/useMisSteps.js:387, laid over this plan by lib/rules/resolve.js); live from lib/designManagementApproval.js:11; owner hooks/useMisSteps.js:390,399',
  }),
];

/* ── Help tickets ────────────────────────────────────────────────────────── */

const TICKET_STEP = {
  key: stepKeyOf(FLOW.TICKET, 'TK'),
  flow: FLOW.TICKET,
  code: 'TK',
  label: 'Help Ticket',
  authority: AUTHORITY.TICKETS,
  grain: GRAIN.TICKET,
  owner: owner(OWNER_KIND.ASSIGNEE),
  calendar: CALENDAR.OFFICE,
  graceMin: NO_GRACE_MIN,
  cutoffKey: CUTOFF.DESIGN_REQ,
  chase: true,
  scoreIn: [...SCORED_BY_CRM_AND_DESKS],
  requiredWhen: null,
  exclusions: [],
  // Due 30 working minutes after it is raised for High, 120 for everything else,
  // stamped on the ticket at creation; an approved extension moves it.
  plan: PLAN_BY_AUTHORITY,
  effectiveFrom: null,
  source: [
    'app/api/tickets/route.js:131-135,517-523',
    'owner and done hooks/useMisSteps.js:402-426',
    'chased app/(app)/pc-report/page.jsx:301-321 and lib/pending-digest/sources.js:252-278',
    'cut by plan date lib/reports/deptPerformance.js:37-44 and app/(app)/pc-report/mis/page.jsx:170',
    SCORED_SOURCE,
  ].join('; '),
};

/* ── The legacy Design Request steps, and today's designer score ──────────── */

// D1/D2 are read by /api/pc-report from Design Requests columns. They are being
// retired, so no score counts them here — although today the Process
// Coordinator lens still sweeps them in (lib/scoring/crmExecScore.js:157-188) —
// and the PC report and the digest chase them as they do today.
function legacyDesignStep(code, label, { authority, planSource }) {
  return {
    key: stepKeyOf(FLOW.DESIGN_REQUEST, code),
    flow: FLOW.DESIGN_REQUEST,
    code,
    label,
    authority,
    grain: GRAIN.DESIGN_ROW,
    owner: owner(OWNER_KIND.REQUESTER),
    calendar: CALENDAR.OFFICE,
    graceMin: NO_GRACE_MIN,
    cutoffKey: CUTOFF.DESIGN_REQ,
    chase: true,
    scoreIn: [],
    requiredWhen: NEEDS_DESIGN_SIGN_OFF,
    exclusions: [EXCLUSION.REJECTED_PI, EXCLUSION.CLOSED_REQUEST],
    plan: PLAN_BY_AUTHORITY,
    effectiveFrom: null,
    source: [
      planSource,
      'owner app/api/pc-report/route.js:873',
      'chased app/(app)/pc-report/page.jsx:228-262 and lib/pending-digest/sources.js:238 (owners there app/api/pc-report/route.js:650-660)',
    ].join('; '),
  };
}

const LEGACY_DESIGN_STEPS = [
  legacyDesignStep('D1', 'Design: CRM Submission', {
    authority: AUTHORITY.HRERP_DESIGN,
    planSource: "app/api/pc-report/route.js:818-911 (planned = the request's 'Deadline')",
  }),
  legacyDesignStep('D2', 'Design: Buyer Approval', {
    authority: AUTHORITY.DESIGN_APPROVAL,
    planSource: "app/api/pc-report/route.js:877-880,914-930 (planned = 'Buyer Sent At' / 'Approved At')",
  }),
];

/** Today's designer score: each design request against its stored 'Design Due At'. */
const DESIGNER_SCORE_STEP = {
  key: stepKeyOf(FLOW.DESIGN_REQUEST, 'DW'),
  flow: FLOW.DESIGN_REQUEST,
  code: 'DW',
  label: 'Design work (stored Design Due At)',
  authority: AUTHORITY.HRERP_DESIGN,
  grain: GRAIN.DESIGN_ROW,
  owner: owner(OWNER_KIND.DESIGNER),
  calendar: CALENDAR.DESIGNER,
  graceMin: NO_GRACE_MIN,
  cutoffKey: null,
  chase: false,
  scoreIn: [PROFILE.DESIGNER],
  requiredWhen: null,
  exclusions: [EXCLUSION.CLOSED_REQUEST, EXCLUSION.UNASSIGNED],
  plan: PLAN_BY_AUTHORITY,
  effectiveFrom: null,
  source: 'lib/scoring/designerScore.js:59-95,120-129; app/(app)/scoreboard/page.jsx:421-423',
};

/* ── HR-ERP's design desk and cylinder workflow (read-only here) ──────────── */

// HR-ERP stays the authority: it plans these steps on its own office calendar
// (09:45–18:30 with its holidays, the same as lib/workingHours.js). No CRM score
// counts them today.
const HRERP_DESIGN_SINCE_CDR = '2026-08-06'; // hr-erp lib/design/cdr-handover.ts:16
const HRERP_CYLINDER_SINCE = '2026-08-10'; // hr-erp lib/cylinder/since.ts:12

function hrerpStep({
  flow, authority, code, label, grain, stepOwner, effectiveFrom = null, source, scoreIn = [], requiredWhen = null, exclusions = [],
}) {
  return {
    key: stepKeyOf(flow, code),
    flow,
    code,
    label,
    authority,
    grain,
    owner: stepOwner,
    calendar: CALENDAR.DESIGNER,
    graceMin: NO_GRACE_MIN,
    cutoffKey: null,
    chase: false,
    scoreIn,
    requiredWhen,
    exclusions,
    plan: PLAN_BY_AUTHORITY,
    effectiveFrom,
    source,
  };
}

/** A fresh copy of a scoring block, so no two rules share one array or condition. */
const cloneScoring = ({ scoreIn, requiredWhen, exclusions }) => ({
  scoreIn: [...scoreIn], requiredWhen: { ...requiredWhen }, exclusions: [...exclusions],
});

const HRERP_DESIGN_STEPS = [
  hrerpStep({
    flow: FLOW.HRERP_DESIGN, authority: AUTHORITY.HRERP_DESIGN, code: 'D2', label: 'Design work',
    grain: GRAIN.DESIGN_ROW, stepOwner: owner(OWNER_KIND.DESIGNER),
    source: "hr-erp lib/pc-report/design-flow.ts:44,167-235 (planned = the desk's queue due, frozen at submit)",
  }),
  hrerpStep({
    flow: FLOW.HRERP_DESIGN, authority: AUTHORITY.HRERP_DESIGN, code: 'D3', label: 'CDR handover',
    grain: GRAIN.DESIGN_ROW, stepOwner: owner(OWNER_KIND.DESIGNER), effectiveFrom: HRERP_DESIGN_SINCE_CDR,
    source: 'hr-erp lib/pc-report/design-flow.ts:45,239-262; lib/design/cdr-handover.ts:8,16,55-65,78-81 (buyer approval + 1 office hour)',
  }),
];

/**
 * hr-erp lib/cylinder/workflow.ts:124-134, in order: C1 is the designer's
 * upload, C2–C5 are the cylinder team's (scored by HR-ERP's own MIS only,
 * lib/mis/steps.ts:112-136).
 */
const CYLINDER_STEPS = [
  {
    label: 'Design Upload (CDR + GPG)',
    source: 'hr-erp lib/cylinder/workflow.ts:125; lib/cylinder/db.ts:326-327,351-352,365-369 (later of buyer approval and PO approval + 1 business hour); not scored there either, lib/mis/steps.ts:26,112-118',
  },
  { label: 'Send Files to Vendor', source: 'hr-erp lib/cylinder/workflow.ts:126; lib/mis/steps.ts:112-136' },
  { label: 'Verify Cylinder Proof', source: 'hr-erp lib/cylinder/workflow.ts:127-131; lib/mis/steps.ts:112-136' },
  { label: 'Management Approval', source: 'hr-erp lib/cylinder/workflow.ts:132; lib/mis/steps.ts:112-136' },
  { label: 'Vendor Printing', source: 'hr-erp lib/cylinder/workflow.ts:133; lib/mis/steps.ts:112-136' },
];

/**
 * C1, the designer's cylinder design upload, counts in the Designer MIS beside
 * the design requests' own design work (owner, 16 Oct 2026; decisions #17, #27):
 * only where HR-ERP opened a cylinder job, and never for a buyer-provided
 * design, a rejected PI or a redo round that was not the designer's fault.
 */
const DESIGNER_UPLOAD_SCORING = Object.freeze({
  scoreIn: [PROFILE.DESIGNER],
  requiredWhen: { fact: 'cylinderJob', op: 'eq', value: true },
  exclusions: [EXCLUSION.BUYER_PROVIDED_DESIGN, EXCLUSION.REJECTED_PI, EXCLUSION.REDO_NOT_DESIGNER_FAULT],
});

const HRERP_CYLINDER_STEPS = CYLINDER_STEPS.map(({ label, source }, index) => hrerpStep({
  flow: FLOW.HRERP_CYLINDER,
  authority: AUTHORITY.HRERP_CYLINDER,
  code: `C${index + 1}`,
  label,
  grain: GRAIN.JOB,
  stepOwner: owner(index === 0 ? OWNER_KIND.DESIGNER : OWNER_KIND.HRERP_DOER),
  effectiveFrom: HRERP_CYLINDER_SINCE,
  source,
  ...(index === 0 ? cloneScoring(DESIGNER_UPLOAD_SCORING) : {}),
}));

/** Every step, keyed by its registry key. */
export const DEFAULT_STEPS = Object.fromEntries(
  [
    ...CRM_FMS_STEPS,
    ...SO_FMS_STEPS,
    ...DESIGN_APPROVAL_STEPS,
    TICKET_STEP,
    ...LEGACY_DESIGN_STEPS,
    DESIGNER_SCORE_STEP,
    ...HRERP_DESIGN_STEPS,
    ...HRERP_CYLINDER_STEPS,
  ].map((step) => [step.key, step])
);
