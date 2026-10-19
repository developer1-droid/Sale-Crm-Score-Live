// VERBATIM COPY of CRM lib/rules/decisions-2026-10-10.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/decisions-2026-10-10.js
//
// The owner's decisions of 10 Oct 2026 (docs/reports-rules-decisions.md) as an
// overlay on DEFAULT_RULES. Every decision that is a rule becomes the registry
// fields it sets; the ones that need code as well are in NON_CONFIG_DECISIONS,
// with what that code does now, where, and what is still open.
//
// One list is the source of truth: DECISION_FIELDS, a row per field a decision
// sets. The overlay object and its change list are both built from it, so they
// cannot disagree. A row that only restates today's value stays in the change
// list, marked `restated`, but is left OUT of the overlay: the overlay replaces
// arrays and values whole, so restating a duty's people, a calendar's windows
// or a step's grace would undo an edit made to them since — and decisions 5, 6
// and 12 make exactly those fields editable.
//
// The overlay is applied with lib/rules/resolve.js applyOverlay, the same merge
// the resolver lays stored rules with.
//
// Pure and Firebase-free.

import { CI_STEP_KEYS, soStepCode } from '../so-fms-step-feed.js';
import { ON_TIME_GRACE_MIN as DA_GRACE_MIN } from '../designApprovalClock.js';
import { DONE_FROM } from './contract.js';
import { BOARD_BYPASS, CUTOFF_BASIS, DEFAULT_CALENDARS, DEFAULT_RULES, HOLIDAYS, freezeRules } from './defaults.js';
import { DEFAULT_DESIGNERS, DEFAULT_DUTIES, DUTY, OWNER_KIND } from './owners-default.js';
import {
  CARRY_OVER, EARLY_FINISH, FORMULA, PC_DESK_LENS, PERIOD, PROFILE, REWARD_TOP_N, deptOtherLensParams,
} from './profiles-default.js';
import { applyOverlay } from './resolve.js';
import {
  AUTHORITY, CALENDAR, CUTOFF, EXCLUSION, FLOW, GRAIN, UNDER_AN_HOUR_GRACE_MIN, stepKeyOf,
} from './steps-default.js';
import { cloneData, isPlainObject } from './util.js';

/* ── reading today's value of a field ────────────────────────────────────── */

const valueAt = (source, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), source);

function isSameData(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => isSameData(item, b[i]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => isSameData(a[key], b[key]));
  }
  return a === b;
}

/** Does the row only say what the defaults already say? */
const isRestated = ({ path, value }) => isSameData(valueAt(DEFAULT_RULES, path), value);

/* ── what the decisions set ──────────────────────────────────────────────── */

// HR-ERP's MIS score (hr-erp lib/mis/score.ts:14-46): −(planned − done on time)
// ÷ planned × 100 over the steps due so far, to one decimal, 0 best; ties broken
// by score, then not-done %, then the more planned, then name (:171-180).
const MIS_PARAMS = Object.freeze({
  variant: 'hrerpMis',
  denominator: 'plannedToDate',
  sign: -1,
  decimals: 1,
  tieBreak: Object.freeze(['score', 'notDonePct', 'planned', 'name']),
});

/**
 * Decision 1's grade bands (hr-erp lib/mis/score.ts:28-38). D is "else": its
 * min is null, the contract's open-ended last grade, so a score below −100 —
 * possible when more was planned than done — is still a D rather than ungraded.
 */
export const MIS_GRADES = Object.freeze([
  { grade: 'A', min: -5 },
  { grade: 'B', min: -15 },
  { grade: 'C', min: -30 },
  { grade: 'D', min: null },
]);

/** Decision 1's reward bar: the top N, and only at −10% or better. */
export const MIS_REWARD_MIN_SCORE = -10;

const MIS_PROFILES = [PROFILE.CRM_EXEC, PROFILE.PC_DESK, PROFILE.DESIGNER, PROFILE.DEPT_OTHER];
// Department Analytics' Other tab carries no reward today, and #1 adds none.
const REWARDED_PROFILES = [PROFILE.CRM_EXEC, PROFILE.PC_DESK, PROFILE.DESIGNER];
const PURCHASE_PROFILE = 'purchase';

/**
 * The MIS engine's params, with the lens a desk profile reads through: the
 * Process Coordinator desk keeps its follow-up lens, and the Other tab keeps
 * the same lens with the follow-up rows out of its team totals.
 */
function misParamsFor(profile) {
  if (profile === PROFILE.PC_DESK) return { ...cloneData(MIS_PARAMS), lens: cloneData(PC_DESK_LENS) };
  if (profile === PROFILE.DEPT_OTHER) return { ...cloneData(MIS_PARAMS), ...deptOtherLensParams() };
  return cloneData(MIS_PARAMS);
}

const stepKeysOf = (flow) => Object.values(DEFAULT_RULES.steps).filter((step) => step.flow === flow).map((step) => step.key);
const CRM_FMS_KEYS = stepKeysOf(FLOW.CRM_FMS);
const SO_FMS_KEYS = stepKeysOf(FLOW.SO_FMS);
const DESIGN_APPROVAL_KEYS = stepKeysOf(FLOW.DESIGN_APPROVAL);
const soKey = (code) => stepKeyOf(FLOW.SO_FMS, code);
const daKey = (code) => stepKeyOf(FLOW.DESIGN_APPROVAL, code);
const D2_KEY = stepKeyOf(FLOW.HRERP_DESIGN, 'D2');
const D3_KEY = stepKeyOf(FLOW.HRERP_DESIGN, 'D3');
const C1_KEY = stepKeyOf(FLOW.HRERP_CYLINDER, 'C1');

/** Invoice-level steps: the ones the feed already labels by Commercial Invoice, SO-9 to SO-14. */
const INVOICE_LEVEL_KEYS = [...CI_STEP_KEYS].map((boardKey) => soKey(soStepCode(boardKey)));

// Request types raised through Design Request (app/api/design-requests/route.js:152-161,
// lib/designExhibitionSheet.js:27). #17 counts help tickets and exhibition posters too.
const COUNTED_REQUEST_TYPES = { fact: 'requestType', op: 'in', value: ['PI Request', 'Help Ticket', 'Exhibition'] };

/**
 * #17: the hand-over is C1 when HR-ERP opened a cylinder job for the design,
 * and D3 otherwise — decided by the fact HR-ERP sends, not by restating its
 * eligibility here. Packaging and category alone are not that rule: HR-ERP also
 * wants the design buyer-approved, linked to a PI item and backed by an
 * approved cylinder packaging PO (hr-erp lib/cylinder/eligibility.ts:50-61,
 * lib/cylinder/design-source.ts:97-106), so an unlinked pouch help ticket has
 * no cylinder job and hands over its CDR like any other design. D3 is the exact
 * complement of C1 — `neq true` rather than `eq false` — so no design is counted
 * twice, and one HR-ERP sends without the flag is a D3, its own rule for every
 * buyer-approved finished design (lib/design/cdr-handover.ts:55-65), instead
 * of quietly dropping out of both.
 */
const HAS_CYLINDER_JOB = { fact: 'cylinderJob', op: 'eq', value: true };
const NO_CYLINDER_JOB = { fact: 'cylinderJob', op: 'neq', value: true };

/**
 * #12: the board steps the PI's CRM owns — every CRM FMS and SO FMS step but
 * SO-0, the order scheduling duty's. Each stays with whoever held the PI when
 * it fell due. Design Approval's DA-S1 and DA-S2 follow #10's own words, the
 * PI's current CRM.
 */
const PI_OWNED_BOARD_KEYS = [...CRM_FMS_KEYS, ...SO_FMS_KEYS]
  .filter((key) => DEFAULT_RULES.steps[key].owner.kind === OWNER_KIND.PI_OWNER);

const SIGNED_PI_KEY = stepKeyOf(FLOW.CRM_FMS, 'S2');

const LEFT_OUT_DESIGNS = [EXCLUSION.BUYER_PROVIDED_DESIGN, EXCLUSION.REJECTED_PI];
const LEFT_OUT_DESIGN_ROUNDS = [...LEFT_OUT_DESIGNS, EXCLUSION.REDO_NOT_DESIGNER_FAULT];

/** A condition with one fact read in place of another, the rest of it as it stands. */
function withFactRenamed(cond, from, to) {
  if (!isPlainObject(cond)) return cloneData(cond);
  if (Array.isArray(cond.all)) return { all: cond.all.map((child) => withFactRenamed(child, from, to)) };
  if (Array.isArray(cond.any)) return { any: cond.any.map((child) => withFactRenamed(child, from, to)) };
  if (Object.hasOwn(cond, 'not')) return { not: withFactRenamed(cond.not, from, to) };
  return cond.fact === from ? { ...cloneData(cond), fact: to } : cloneData(cond);
}

/**
 * #14: Step-3 runs for a deposit as the PI form states it — the same rule, its
 * deposits read PI form first (lib/crm-fms-clock.js crmFmsFacts piFormDeposits).
 */
const S3_KEY = stepKeyOf(FLOW.CRM_FMS, 'S3');
const S3_ON_PI_FORM_DEPOSITS = withFactRenamed(DEFAULT_RULES.steps[S3_KEY].requiredWhen, 'deposits', 'piFormDeposits');

/** #18: C1 is due 1 office hour after the later of buyer approval and packaging-PO approval. */
export const C1_DUE_MIN = 60;

const row = (decision, path, value, why) => ({ decision, path, value, why });
const stepRows = (decision, keys, field, value, why) => keys.map((key) => row(decision, `steps.${key}.${field}`, value, why));
const profileRows = (decision, keys, field, valueOf, why) =>
  keys.map((key) => row(decision, `profiles.${key}.${field}`, typeof valueOf === 'function' ? valueOf(key) : valueOf, why));
const calendarRows = (decision, field, valueOf, why) =>
  Object.values(CALENDAR).map((name) => row(decision, `calendars.${name}.${field}`, valueOf(name), why));

/** One row per registry field a decision sets: { decision, path, value, why }. */
const DECISION_FIELDS = [
  ...profileRows(1, MIS_PROFILES, 'formula', FORMULA.MISS_PCT,
    "Score = −(planned − done on time) ÷ planned × 100, as HR-ERP's MIS; 0% is best."),
  ...profileRows(1, MIS_PROFILES, 'params', misParamsFor,
    "HR-ERP's miss-% engine replaces the weighted 0–100 scores and Delay %; the Process Coordinator desk and the Other tab keep their follow-up lens."),
  ...profileRows(1, MIS_PROFILES, 'grades', () => cloneData(MIS_GRADES), 'Grades A ≥ −5%, B ≥ −15%, C ≥ −30%, else D.'),
  ...profileRows(1, REWARDED_PROFILES, 'reward', { topN: REWARD_TOP_N, minScore: MIS_REWARD_MIN_SCORE },
    'Reward: top N and a score of −10% or better.'),

  ...profileRows(2, MIS_PROFILES, 'period', PERIOD.IST_CALENDAR,
    'IST Monday–Sunday weeks and calendar months, running up to now.'),

  ...profileRows(3, MIS_PROFILES, 'outcome.carryOver', CARRY_OVER.LISTED,
    'Work still open from before the period is listed as backlog, not scored against it.'),
  ...profileRows(3, MIS_PROFILES, 'outcome.earlyFinish', EARLY_FINISH.AT_PLANNED,
    'A step finished early counts once its planned time is reached.'),

  ...profileRows(4, MIS_PROFILES, 'outcome.freezeOnClose', true,
    "A period's scores are frozen when it closes, so a paid reward can be reproduced."),

  ...stepRows(5, [...CRM_FMS_KEYS, ...SO_FMS_KEYS], 'graceMin', UNDER_AN_HOUR_GRACE_MIN,
    'On time is under 1 hour late on CRM FMS and SO FMS, as the boards read it.'),
  ...stepRows(5, DESIGN_APPROVAL_KEYS, 'graceMin', DA_GRACE_MIN,
    'On time is within 5 minutes on Design Approval, as the board reads it.'),

  ...calendarRows(6, 'holidays', () => HOLIDAYS.HRERP,
    "HR-ERP's office holidays pause every clock: CRM FMS, SO FMS, tickets and the design clocks."),
  ...calendarRows(6, 'windows', (name) => cloneData(DEFAULT_CALENDARS[name].windows),
    'Hours stay 09:30–18:00 for CRM work and 09:45–18:30 for designers, both editable.'),

  row(7, `cutoffs.${CUTOFF.CRM_FMS}.basis`, CUTOFF_BASIS.PI_APPROVAL,
    "One cutoff for every PI-based step: the PI's approval date against the CRM FMS cutoff."),
  ...[CUTOFF.CRM_FMS, CUTOFF.SO_FMS, CUTOFF.DESIGN_REQ, CUTOFF.DESIGN_APPROVAL].map((key) => row(7, `cutoffs.${key}.atIstMidnight`, true,
    'Cutoff dates are IST midnight.')),
  // The board's own cutoff is today's rule already (lib/rules/defaults.js), its date the CRM FMS one
  // the loader fills in: the decision restates its basis and only moves its day to IST midnight.
  row(7, `cutoffs.${CUTOFF.DESIGN_APPROVAL}.basis`, CUTOFF_BASIS.LATEST_ACTIVITY,
    "Design Approval keeps the board's own rule: the CRM FMS cutoff date against the latest of PI approval, request and submission."),
  ...stepRows(7, [...CRM_FMS_KEYS, ...SO_FMS_KEYS], 'cutoffKey', CUTOFF.CRM_FMS,
    'SO FMS steps are cut by the PI approval against the CRM FMS cutoff; the SO FMS cutoff is retired.'),
  ...stepRows(7, DESIGN_APPROVAL_KEYS, 'cutoffKey', CUTOFF.DESIGN_APPROVAL,
    "Design Approval keeps the board's own cutoff rule."),

  ...['crmFms', 'soFms'].map((board) => row(8, `boardBypass.${board}`, BOARD_BYPASS.NONE,
    'A pre-cutoff PI a board still shows is chased by no report, as today, behind this flag.')),

  ...stepRows(9, [soKey('SO-4'), soKey('SO-11.5'), soKey('SO-13')], 'scoreIn', [],
    'SO-4, SO-11.5 and SO-13 are not scored.'),

  ...stepRows(10, [daKey('DA-S1'), daKey('DA-S2')], 'owner', { kind: OWNER_KIND.PI_OWNER },
    "Design Approval CRM review and buyer approval belong to the PI's current CRM."),

  ...stepRows(11, [SIGNED_PI_KEY], 'scoreIn', [PROFILE.CRM_EXEC, PROFILE.PC_DESK, PROFILE.DEPT_OTHER],
    'CRM FMS Step-2 (signed PI) counts in the CRM MIS.'),

  ...stepRows(12, [daKey('DA-S3')], 'owner', { kind: OWNER_KIND.DUTY, duty: DUTY.MANAGEMENT },
    'Management is a duty on the editable duty list.'),
  ...[DUTY.ORDER_SCHEDULING, DUTY.FOLLOW_UP_COORDINATOR, DUTY.MANAGEMENT].map((duty) => row(12, `duties.${duty}`,
    cloneData(DEFAULT_DUTIES[duty]), 'The fixed duties move into an editable duty list.')),
  ...stepRows(12, PI_OWNED_BOARD_KEYS, 'owner', { kind: OWNER_KIND.PI_OWNER_AT_DUE },
    'A step stays with whoever held the PI when it fell due: a PI transfer hands over the steps still to come, never the history.'),

  ...stepRows(13, INVOICE_LEVEL_KEYS, 'grain', GRAIN.CI, 'Invoice-level SO steps count once per invoice in every report.'),

  row(14, `steps.${S3_KEY}.requiredWhen`, S3_ON_PI_FORM_DEPOSITS,
    "For deposits the PI form's answers win over the board's Step-2 charge cells."),
  row(14, `steps.${SIGNED_PI_KEY}.doneFrom`, [DONE_FROM.APPROVED_PI_LIST],
    'A signed PI uploaded from the Approved PI list completes Step-2 on the board too.'),

  ...stepRows(17, [D2_KEY, D3_KEY, C1_KEY], 'scoreIn', [PROFILE.DESIGNER],
    "Designer steps: D2 design work, C1 cylinder design upload, D3 CDR handover (HR-ERP's; no page reads them since #27)."),
  row(17, `steps.${D2_KEY}.requiredWhen`, COUNTED_REQUEST_TYPES,
    'Exhibition posters and help tickets raised through Design Request are counted.'),
  row(17, `steps.${C1_KEY}.requiredWhen`, HAS_CYLINDER_JOB, 'C1 when HR-ERP opened a cylinder job for the design.'),
  row(17, `steps.${D3_KEY}.requiredWhen`, NO_CYLINDER_JOB, 'D3 for the rest: one hand-over is never scored twice.'),
  ...stepRows(17, [D2_KEY, C1_KEY], 'exclusions', LEFT_OUT_DESIGN_ROUNDS,
    "Buyer-provided designs and rejected PIs are left out; a redo counts only when the revision is the designer's fault."),
  ...stepRows(17, [D3_KEY], 'exclusions', LEFT_OUT_DESIGNS, 'Buyer-provided designs and rejected PIs are left out.'),

  row(18, `steps.${C1_KEY}.plan`, {
    anchor: 'latest(buyerApprovedAt,packagingPoApprovedAt)',
    add: { n: C1_DUE_MIN, unit: 'workingMinutes' },
    calendar: CALENDAR.DESIGNER,
  }, 'C1 is due 1 office hour after the later of buyer approval and packaging-PO approval, editable.'),

  row(21, 'designers', DEFAULT_DESIGNERS.map((designer) => ({ ...cloneData(designer), aliases: [] })),
    "The designers are Arun, Manoj and Rishabh Rawat, identified by their HR-ERP user (email), not the free-text 'Assigned Designer'."),

  row(22, `profiles.${PURCHASE_PROFILE}`, {
    key: PURCHASE_PROFILE,
    label: 'Purchase Coordinators',
    formula: FORMULA.MISS_PCT,
    params: { ...cloneData(MIS_PARAMS), computedBy: AUTHORITY.HRERP_PURCHASE },
    period: PERIOD.IST_CALENDAR,
    outcome: { carryOver: CARRY_OVER.LISTED, earlyFinish: EARLY_FINISH.AT_PLANNED, freezeOnClose: true },
    reward: { topN: REWARD_TOP_N, minScore: MIS_REWARD_MIN_SCORE },
    grades: cloneData(MIS_GRADES),
    cohort: null,
  }, "The Scoreboard shows HR-ERP's purchase score and grade as sent; the reward rule of #1 applies."),
];

/* ── the overlay, built from the rows ────────────────────────────────────── */

function setAtPath(target, [head, ...rest], value) {
  if (rest.length === 0) {
    target[head] = cloneData(value);
    return;
  }
  if (!isPlainObject(target[head])) target[head] = {};
  setAtPath(target[head], rest, value);
}

const overlaps = (a, b) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

/**
 * The rows as one partial rule set. Every row is checked for a clash — two
 * decisions on one field would leave the overlay's meaning to row order — but
 * only the rows that change something are written (see the note at the top).
 */
function composeOverlay(rows) {
  const overlay = {};
  const written = [];
  rows.forEach((decisionRow) => {
    const { path, value } = decisionRow;
    const clash = written.find((done) => overlaps(done, path));
    if (clash) throw new Error(`rules: '${path}' and '${clash}' are both set by the decisions`);
    written.push(path);
    if (!isRestated(decisionRow)) setAtPath(overlay, path.split('.'), value);
  });
  return overlay;
}

/** The decisions as a partial rule set in the contract's shape, applied with resolve.js applyOverlay. */
export const OWNER_DECISIONS_2026_10_10 = freezeRules(composeOverlay(DECISION_FIELDS));

/** The same overlay as a named patch, the form applyOverlay takes. */
export const OWNER_DECISIONS_2026_10_10_OVERLAY = Object.freeze({
  name: 'Owner decisions, 10 Oct 2026',
  patch: OWNER_DECISIONS_2026_10_10,
});

/**
 * Rules with the decisions laid over them — today's defaults unless told
 * otherwise. An overlay the rules refuse is a defect in this file, not a
 * runtime condition, so it throws rather than handing back the base unchanged.
 */
export function withOwnerDecisions(base = DEFAULT_RULES) {
  const { rules, warnings } = applyOverlay(base, OWNER_DECISIONS_2026_10_10_OVERLAY);
  if (warnings.length > 0) throw new Error(`rules: ${warnings.join('; ')}`);
  return rules;
}

/* ── what each entry changes ─────────────────────────────────────────────── */

/**
 * One line per decision field: the decision, the field, today's value, the
 * decided value, and whether it only restates today's (and so is not in the
 * overlay).
 *
 * @type {ReadonlyArray<{decision: number, path: string, from: *, to: *, restated: boolean, why: string}>}
 */
export const OWNER_DECISIONS_2026_10_10_CHANGES = freezeRules(DECISION_FIELDS.map((decisionRow) => {
  const { decision, path, value, why } = decisionRow;
  const today = valueAt(DEFAULT_RULES, path);
  return {
    decision,
    path,
    from: today === undefined ? null : cloneData(today),
    to: cloneData(value),
    restated: isRestated(decisionRow),
    why,
  };
}));

/* ── the code behind the decisions ───────────────────────────────────────── */

/**
 * The code each decision needs beyond the rules above — to hold, or for those
 * rules to be read at all: what that code does now (`change`), and where. A
 * part not done yet follows 'Still open:'. A pointer is a path in this repo
 * with the names to look for in brackets, or an 'hr-erp …' path in the HR-ERP
 * repo, which carries #17–#20 and #25. Rules that are pure configuration are
 * not repeated here.
 *
 * @type {ReadonlyArray<{decision: number, change: string, where: string[]}>}
 */
export const NON_CONFIG_DECISIONS = freezeRules([
  {
    decision: 1,
    change: "One port of HR-ERP's miss-% engine scores every profile the rules put on it (scoresOnMisEngine): the CRM MIS, the Designer MIS, the Scoreboard's CRM, Process Coordinator and Designer sections, and Score Live's CRM board; today's rules keep the weighted 0–100 scores and Delay %. Grades and the reward rule are each profile's in the registry (rewardRuleOf), edited in Settings > Report Rules, which takes a negative minimum; Settings' Scoreboard Reward Rule is laid over a profile only while the stored rules leave its reward unset. Still open: that Settings input still clamps its minimum to 0–100.",
    where: [
      'lib/mis/score.js (missPct, misGrade, scoreMis, rewardedDoers)',
      'lib/mis/profile-engine.js (scoresOnMisEngine, rewardRuleOf)',
      'lib/mis/board.js (buildMisBoard, designerBoardOf)',
      'lib/crm-mis/report.js (buildCrmMisReport)',
      'lib/designer-mis/report.js (buildDesignRequestMisReport)',
      'app/(app)/scoreboard/useMisSections.js (useMisSections)',
      'score-live/engine/crmMisBoard.js (misBoardFor)',
      'lib/rules/resolve.js (withLegacyReward)',
      'app/(app)/settings/report-rules/ProfileDrawer.jsx (reward.minScore)',
      'app/(app)/settings/ScoreboardRewardRule.jsx (rewardMinScore)',
    ],
  },
  {
    decision: 2,
    change: "One IST period module — Monday–Sunday weeks and calendar months, running up to now — gives every profile on IST calendar periods its periods: the CRM MIS and Designer MIS pickers (presetPeriod), Department Analytics and the MIS Performance Report (useReportWindow; the MIS Performance Report reads the Process Coordinator desk's profile) and Score Live (windowPeriodOf), the Scoreboard's MIS and Purchase sections (scoreboardPeriodOf, purchasePlan) and the Design analytics presets (datePresetsFor). A Scoreboard custom range with a day cleared or half typed reads as the period the board opens on, this month (DEFAULT_BOARD_MODE), never an error. Today's rules keep the rolling and browser-local windows (rangeOf), and periodKeyFor stays for the Sales report.",
    where: [
      'lib/mis/period.js (presetPeriod, periodBounds)',
      'lib/mis/board-period.js (windowPeriodOf, scoreboardPeriodOf, DEFAULT_BOARD_MODE)',
      'hooks/useReportWindow.js (windowPeriodOf)',
      'score-live/engine/crmPeriods.js (windowPeriodOf)',
      'lib/scoring/misLeaderboard.js (scoreboardMisPlan, purchasePlan)',
      'lib/reports/designDatePresets.js (datePresetsFor, presetRange)',
      'lib/scoring/period.js (rangeForPeriod, periodKeyFor)',
      'app/(app)/pc-report/mis/page.jsx (rangeOf, useReportWindow, REPORT_PROFILE)',
      'app/(app)/scoreboard/page.jsx (DEFAULT_BOARD_MODE)',
    ],
  },
  {
    decision: 3,
    change: "A profile that lists carried-over work (carryOverOf) shows work still open from before the period as backlog, out of the period's score: the engine's carry-over bucket (bucketOf), and the department lists beside the period (inPeriod marks it isBacklog; periodWork keeps it out of every total, Delay % and the weighted score). Under EARLY_FINISH.AT_PLANNED the engine counts an early finish once its plan passes. Today's rules still carry every overdue or held step into every window. Still open: Score Live's weighted CRM board and the weighted Process Coordinator score keep today's carry-over whatever the profile says; under the decisions neither is used.",
    where: [
      'lib/mis/score.js (bucketOf, outcomeOf)',
      'lib/mis/profile-engine.js (carryOverOf)',
      'lib/reports/deptPerformance.js (inPeriod, periodWork, summarize)',
      'score-live/engine/crmBoard.js (inPeriod)',
      'lib/scoring/crmExecScore.js (scorePc)',
    ],
  },
  {
    decision: 4,
    change: "A closed IST week or month of a profile that freezes on close is read from a record, not recomputed: its first read writes one record per profile under orgConfig/{orgId}/misPeriods — every step-feed profile from the same build, Purchase as HR-ERP sent it with the reward rule of the day — and a record is never rewritten. The Scoreboard, Department Analytics (view-all readers), the CRM MIS (readers who rank everyone) and the Designer MIS read it back, with a note of when it was frozen and under which rules version. Score Live has no closed period to read: every period it shows holds now (today, this week, up to this year; crmMisPeriod), so it never recomputes one. Still open: a reader without a view-all grant sees live numbers for a closed period in Department Analytics and the CRM MIS.",
    where: [
      'lib/mis/frozen.js (readsFrozen, feedSiblingsOf, frozenRecordOf, purchaseBoardOf)',
      'lib/mis/frozen.server.js (readOrFreezePeriod)',
      'app/api/mis/periods/route.js (frozenGrantsOf)',
      'lib/scoring/purchaseScores.server.js (fetchPurchaseScores)',
      'hooks/useFrozenBoards.js (useFrozenBoards)',
      'hooks/useFrozenBoard.js (useFrozenBoard)',
      'components/mis/FrozenNote.jsx (FrozenNote)',
      'lib/designer-mis/report.js (frozenDesignerReportOf)',
      'score-live/engine/crmPeriods.js (crmMisPeriod)',
    ],
  },
  {
    decision: 5,
    change: "'Due today' is one rule on every clock — planned on or before the end of now's IST calendar day, not within the next 24 hours (isDueToday) — on the CRM FMS, SO FMS, Design Approval and ticket clocks; each step's grace is the registry's (stepGraceMin).",
    where: [
      'lib/rules/step-clock.js (isDueToday)',
      'lib/crm-fms-clock.js (isDueToday)',
      'lib/so-fms-step-feed.js (isDueToday)',
      'lib/designApprovalClock.js (isDueToday)',
      'lib/step-feed/ticket-steps.js (isDueToday)',
      'lib/work-clock.js (stepGraceMin)',
    ],
  },
  {
    decision: 6,
    change: "Every clock reads the registry's calendars (lib/work-clock.js) and skips HR-ERP's holidays where its calendar says so — the boards and the step feed, tickets (the route's stamp and the page's due-date preview), the settlement lane, the CRM FMS sheet's Step-4 plan, the legacy PC report's delay and the designer's clock — with the rules and the holidays loaded before any clock runs: ensureClocks on the server, useWorkCalendar in the browser. The overlay turns the office calendar's holidays on; the designer and approval calendars skip them already. The Sales Coordinator's planner stays on the built-in calendar (PINNED_OFFICE), as the Scope line requires; the dues HR-ERP computes itself are HR-ERP's to keep in step.",
    where: [
      'lib/work-clock.js (calendarClock, officeClock)',
      'lib/work-calendar-source.js (ensureClocks)',
      'hooks/useWorkCalendar.js (useWorkCalendar)',
      'lib/so-fms-datetime.js (officeClock)',
      'lib/so-working-hours.js (PINNED_OFFICE)',
      'lib/payment-settlement.js (addWorkingMinutes)',
      'lib/ticket-due.js (ticketDueAt)',
      'app/api/tickets/route.js (ensureClocks, ticketDueAt)',
      'app/(app)/tickets/page.jsx (useWorkCalendar, ticketDueAt)',
      'lib/crm-fms-step4-planned.js (step4PlannedCell)',
      'app/api/crmData/route.js (ensureClocks, step4PlannedCell)',
      'lib/pc-report/step-verdict.js (pcStepVerdict)',
      'app/api/pc-report/route.js (ensureClocks, pcStepVerdict)',
      'lib/workingHours.js (designerClock)',
      'app/api/design-approval/route.js (ensureClocks)',
    ],
  },
  {
    decision: 7,
    change: "Cutoff dates are IST midnight once the rules say so; Settings marks the SO FMS cutoff input retired once no step's rule reads it. Every cutoff reader takes its line from the rules (cutoffOf, boardCutoffOf, the step's cutoffKey) — the boards, the chase list and the digest, the step feed, Department Analytics' step lists and the Process Coordinator lens (isBeforeCutoff), the MIS's approved-PI gate, the MIS Performance Report's SO FMS and ticket gates (misCountedSteps: an SO step's plan against the SO FMS date while a step reads it, as the chase list holds it, soPlanCutoffOf; a ticket against its own step's cutoff), the Design Requests board (a PI's rows by the CRM FMS boards' line, a help ticket by the design request date) and the PI tracker's list (boardCutoffLine) — so a 'YYYY-MM-DD' is UTC midnight only while the rules say so, and the retired SO FMS input moves nothing. The Design Approval board's own cutoff is one of today's rules, dated from the CRM FMS setting (LEGACY_CUTOFF_SOURCE); the overlay only moves it to IST midnight. The board shows its help tickets past its PI gate and its cutoff, and so does every reader: board truth, not a rule — the feed keeps them in scope by the board's bypass (scopeVerdict's isHelpTicket fact, isKeptByItsBoard).",
    where: [
      'lib/rules/scope.js (parseCutoffDay, scopeVerdict, cutoffOf, boardCutoffOf, isCutoffInUse, soPlanCutoffOf, isKeptByItsBoard)',
      'lib/rules/defaults.js (CUTOFF.DESIGN_APPROVAL)',
      'lib/rules/resolve.js (LEGACY_CUTOFF_SOURCE)',
      'lib/work-clock.js (boardCutoffLine)',
      'lib/reports/deptPerformance.js (isBeforeCutoff)',
      'lib/scoring/crmExecScore.js (scopePcSteps)',
      'lib/step-feed/consumer.js (approvedPiSet)',
      'hooks/useMisSteps.js (boardCutoffLine, piApprovedSet)',
      'lib/pending-chase.js (chaseCutoffsOf)',
      'lib/pending-digest/board-items.js (chaseRules)',
      'app/(app)/settings/page.jsx (isSoFmsCutoffRetired)',
      'app/(app)/design/approval/page.jsx (designCutoffMs)',
      'app/(app)/pi/fms/page.jsx (crmCutoffMs)',
      'app/(app)/pi/sofms/page.jsx (crmCutoffMs)',
      'lib/reports/misScope.js (misCountedSteps, soPlanCutoffOf, isBeforeCutoff)',
      'app/(app)/pc-report/mis/page.jsx (misCountedSteps)',
      'app/(app)/design/page.jsx (boardCutoffLine, crmCutoffMs, designCutoffMs)',
      'app/(app)/pi/tracker/page.jsx (boardCutoffLine, crmCutoffMs)',
      'lib/step-feed/adapters/design-approval.js (isHelpTicket)',
    ],
  },
  {
    decision: 9,
    change: "Every score takes the steps it counts from the registry's scoreIn (isScoredIn): the Process Coordinator lens, Department Analytics' Other tab and the MIS engine's CRM and designer steps; the old SO step list (SCORED_SO_STEPS) is gone. SO-4, SO-11.5 and SO-13 are counted today only by the Process Coordinator lens (scopePcSteps) and the Other tab it feeds (scopeOtherSteps); the CRM score never had them, and the decisions empty their scoreIn, so nothing scores them. Owners come from the registry's owner rules and duty list (ownerOf). Department Analytics' CRM tab and the weighted CRM score take the CRM's work from the crmExec profile's scoreIn too (isCrmWork, scoredInRuleOf), so an edit there reaches them as it reaches the MIS engine; today's SO list (CRM_SO_STEPS), from which the registry's default scoreIn is built, stands only for a step the rules have no rule for.",
    where: [
      'lib/scoring/scoredIn.js (isScoredIn)',
      'lib/scoring/crmExecScore.js (scopePcSteps)',
      'lib/reports/deptPerformance.js (scopeOtherSteps, CRM_SO_STEPS)',
      'lib/reports/deptPerformance.js (isCrmWork, scoredInRuleOf)',
      'lib/crm-mis/steps.js (toMisSteps)',
      'lib/designer-mis/steps.js (toDesignerMisSteps)',
      'lib/step-feed/owners.js (ownerOf)',
    ],
  },
  {
    decision: 10,
    change: "The step feed offers each Design Approval CRM review and buyer approval both owners — its requester and its PI's current CRM — and the registry's owner rule picks one: the requester today, the PI's current CRM under the decisions, as the PC report already lists them; a help ticket with no PI keeps its requester. The PI's CRM rides beside the step (withPiCrm), so the CRM's own scope lists it either way. A help ticket is in the feed as its board shows it — with a PI or none, a rejected one included, past the PI gate and any cutoff (in scope by the board's bypass) — so its review reaches the PC report, the digest, the MIS and Department Analytics.",
    where: [
      'lib/step-feed/adapters/design-approval.js (OWNER_KIND.PI_OWNER, isHelpTicket)',
      'lib/rules/scope.js (isShownHelpTicket)',
      'lib/step-feed/owners.js (ownerOf)',
      'lib/step-feed/build.js (withPiCrm)',
      'lib/step-feed/route-logic.js (scopeItems)',
    ],
  },
  {
    decision: 12,
    change: "A step stays with whoever held its PI when it fell due (OWNER_KIND.PI_OWNER_AT_DUE): the feed reads each PI's transfers from the log the transfer route writes, and still chases an open step to the PI's current CRM (chaseOwner) — the PC report and the digest send it there, while the MIS, Department Analytics and the Scoreboard keep it out of that CRM's score (asPiCrm). The duties are one editable list with one reader (dutyPeople, dutyHolder): Step-0's owner in the feed, the chase list and /api/pc-report, the follow-up coordinator in the Process Coordinator lens and its weighted score, and the Management duty, whose steps go to Settings' management reviewer (managementNotifyEmail) while nobody is on it. The Process Coordinator desk has an MIS score through its lens. The SO FMS board's Step-0 column header names the order scheduling duty's holder too (soStepsFor), from the duties the boards' clock rules carry (BOARD_DUTIES).",
    where: [
      'lib/step-feed/owners.js (piOwnerAtDue, chaseCandidate, withChaseOwner, dutyOwner)',
      'lib/step-feed/pi-transfers.js (transfersFromLogs, holderAt)',
      'app/api/pi-transfer/route.js (PI_TRANSFER_ACTION)',
      'lib/step-feed/route-logic.js (scopeItems, asPiCrm)',
      'lib/rules/duties.js (dutyPeople, dutyHolder)',
      'lib/mis/lens.js (lensPeople, lensItems)',
      'lib/scoring/crmExecScore.js (followUpCoordinatorOf)',
      'lib/pending-chase.js (soChaseItems)',
      'app/api/pc-report/route.js (dutyHolder)',
      'lib/so-fms-catalog.js (soStepsFor)',
      'lib/rules/step-clock.js (BOARD_DUTIES)',
      'app/(app)/pi/sofms/page.jsx (soStepsFor)',
    ],
  },
  {
    decision: 13,
    change: "Invoice-level SO steps count once per invoice in every report: the step feed folds its SO items (invoiceSteps), and every report, score and chase list collapses invoice-level siblings per owner, step and invoice — collapseCiSiblings, keyed owner|step|CI — after its own gates; an invoice step done on one order leaves no open copy on the others (closeDoneCiSiblings). Per owner, not per invoice: an invoice spanning the PIs of two CRMs keeps one row for each, so each CRM is chased for it.",
    where: [
      'lib/so-fms-step-feed.js (collapseCiSiblings, closeDoneCiSiblings)',
      'lib/step-feed/build.js (invoiceSteps)',
      'lib/reports/deptPerformance.js (collapseCiSiblings)',
      'lib/scoring/crmExecScore.js (collapseCiSiblings)',
      'lib/pending-chase.js (soChaseItems, collapseCiSiblings)',
      'lib/pending-digest/feed-items.js (collapseCiSiblings)',
      'app/(app)/pc-report/page.jsx (rehydrate)',
    ],
  },
  {
    decision: 14,
    change: "Once the rules say so (Step-2's doneFrom), a signed PI uploaded from the Approved PI list completes CRM FMS Step-2 on the board too: the upload route — signed in, holding the Approved PI page's permission, on a PI that list shows them (its CRM, or every PI under the list's view-all grant) — writes the board's Step-2 and says so, the list sends the board's own Step-2 notification, and a stale board tab can no longer save its old pending Step-2 over it (mergeStep2Save). For deposits the PI form's answers win over the board's Step-2 charge cells (piFormDeposits). Still open: nothing on the Approved PI list opens the upload (SignedPIUploadModal is mounted but never shown), so the list's upload cannot be reached from the app.",
    where: [
      'app/api/pi-data/[piId]/upload-signed-pi/route.js (completeStep2OnBoard, signedPiUploadAccess, signedPiOwnerAccess)',
      'lib/crm-fms-signed-pi.js (listUploadCompletesStep2, step2CompletionOf, mergeStep2Save, listUploadNotificationOf)',
      'lib/signed-pi-upload-access.js (signedPiUploadAccess, signedPiOwnerAccess)',
      'lib/pi-list-scope.js (seesEveryPi, isPiCrm)',
      'app/api/crmData/route.js (mergeStep2Save)',
      'components/SignedPIUploadModal.jsx (triggerNotification)',
      'lib/crm-fms-clock.js (crmFmsFacts, piFormDeposits)',
      'components/ApprovedPITable.jsx (setShowSignedUploadModal)',
    ],
  },
  {
    decision: 15,
    change: "Every chase list follows the board's Step-11 through one rule (boardStep11ByInvoice): done, paid or closed is never pending — the step feed, the chase list and Arrived Payment Pending — and an invoice step done on one sales order closes its open siblings (closeDoneCiSiblings). The Client Wallet and Client Ledger show accounts-confirmed money and mark an invoice the board shows closed or paid (step11MarkOf).",
    where: [
      'lib/so-fms-step11-board.js (boardStep11ByInvoice, step11MarkOf)',
      'lib/so-fms-step-feed.js (closeDoneCiSiblings)',
      'lib/so-fms-feed-server.js (step11DoneInvoices)',
      'app/api/reports/arrived-payment-pending/route.js (step11DoneInvoices)',
      'lib/buyer-outstanding.js (step11MarkOf)',
      'app/(app)/buyers/ledger/useClientLedger.js (step11MarkOf)',
      'app/(app)/buyers/wallet/OutstandingBreakdown.jsx (step11MarkNote)',
    ],
  },
  {
    decision: 16,
    change: "The assignee is scored on 'Resolved At', written once per round — the first resolve, or a close with no resolve before it — and a reopen clears 'Resolved At' and 'Closed At', so the resolve that counts is the one after the last reopen (completionStamps, applied by the tickets route). The Sales Coordinator report reads the same 'Resolved At' column, so its Tickets category moves with it: a known and accepted consequence of fixing the column — the report's formula is unchanged, as the owner's Scope line requires.",
    where: [
      'lib/ticket-resolution.js (completionStamps)',
      'app/api/tickets/route.js (completionStamps)',
      'lib/step-feed/ticket-steps.js (isFinished)',
      'app/api/sales-coordinator-report/route.js (cResolved)',
    ],
  },
  {
    decision: 17,
    change: "The Designer MIS reads HR-ERP's D2, D3 and C1 rows into the facts the registry's conditions read — request type, help ticket, exhibition poster, design category, packaging, buyer-provided, cylinder job, the fault behind a redo round, PI status (designerStepFacts) — and applies the decided exclusions (toDesignerMisSteps). Sending those rows and facts is HR-ERP's side, in the HR-ERP repo.",
    where: [
      'lib/designer-mis/facts.js (designerStepFacts)',
      'lib/designer-mis/steps.js (toDesignerMisSteps)',
      'lib/design-fault.js (FAULT_DESIGNER)',
      'hr-erp lib/pc-report/design-flow.ts:164-262',
      'hr-erp lib/cylinder/list.ts',
      'hr-erp lib/cylinder/eligibility.ts:50-61',
    ],
  },
  {
    decision: 18,
    change: "HR-ERP's side, in the HR-ERP repo: its C1 anchor takes the pouch/BOPP line's packaging-PO approval, not the earliest line's, and its due time comes from the registry's C1 plan (1 office hour, editable, set above). The Designer MIS takes C1's plan as HR-ERP sends it.",
    where: [
      'lib/designer-mis/steps.js (plannedAt)',
      'hr-erp lib/cylinder/anchor.ts:7-15',
      'hr-erp lib/cylinder/po-index.ts:136-155',
      'hr-erp lib/cylinder/db.ts:326-327,351-352,365-369',
    ],
  },
  {
    decision: 19,
    change: "The Designer MIS lives in the CRM on the same engine. The CRM proxies HR-ERP's designer and cylinder steps with a signed embed token, a timeout, a per-window cache and a visible error (/api/designer-steps); the protected endpoint it calls is HR-ERP's side, in the HR-ERP repo.",
    where: [
      'lib/designer-mis/hrerp-steps.server.js (signEmbedToken)',
      'lib/designer-mis/proxy.js (hrerpDesignerStepsUrl, createWindowCache, failureMessageOf, HRERP_TIMEOUT_MS)',
      'lib/designer-mis/report.js (buildDesignerMisReport)',
      'app/(app)/reports/designer-mis/DesignerMisReport.jsx (DesignerMisReport)',
      'hr-erp app/embed',
    ],
  },
  {
    decision: 20,
    change: "HR-ERP's side, in the HR-ERP repo: it reads 'Buyer Approved At' as the CRM writes it and repairs the stored cylinder dates after a dry run, adds the designer-steps endpoint, stops report reads writing to its database, keeps every cylinder round, and commits its delay-reasons work first. Nothing in the CRM.",
    where: ['hr-erp lib/cylinder/list.ts:40', 'hr-erp lib/cylinder/db.ts:351,368', 'hr-erp lib/purchase/design-anchor.ts:76'],
  },
  {
    decision: 21,
    change: "The designers are the registry's list (rules.designers: Arun, Manoj and Rishabh Rawat), and the Designer MIS matches each step to one by the HR-ERP user's email, by name or alias only for a row HR-ERP could only name (designerRosterOf, createDesignerMatcher); sending the user with every step is HR-ERP's side. Still open: Design Analytics' designer scorecard, the Scoreboard's designer section under today's rules and the design-approval route's notification map still go by the free-text 'Assigned Designer'.",
    where: [
      'lib/designer-mis/designers.js (designerRosterOf, createDesignerMatcher)',
      'lib/rules/owners-default.js (DEFAULT_DESIGNERS)',
      'app/(app)/design/report/analytics/page.jsx (buildDesignerScorecard)',
      'app/(app)/scoreboard/useLegacyDesigners.js (scoreDesigners)',
      'app/api/design-approval/route.js (DESIGNER_EMAIL_MAP)',
    ],
  },
  {
    decision: 22,
    change: "The Scoreboard shows HR-ERP's purchase score and grade as HR-ERP sends them (scorePurchase: a negative miss %, A–D), over the purchase profile's IST week or month (purchasePlan), and rewards its top N at −10% or better by the registry's purchase reward (purchaseRewarded); a closed period is the frozen record (purchaseBoardOf). One server read of HR-ERP serves the proxy route and the freeze (fetchPurchaseScores).",
    where: [
      'lib/scoring/purchaseScore.js (scorePurchase, purchaseRewarded)',
      'lib/scoring/misLeaderboard.js (purchasePlan, purchaseRewardLine)',
      'app/(app)/scoreboard/usePurchaseSection.js (rewardRuleOf)',
      'lib/scoring/purchaseScores.server.js (fetchPurchaseScores)',
      'app/api/purchase-mis-score/route.js (fetchPurchaseScores)',
      'lib/mis/frozen.js (purchaseBoardOf)',
    ],
  },
  {
    decision: 23,
    change: "Rules are stored per company at orgConfig/{orgId}/rules/current and read through one cached loader. GET and PUT /api/rules are gated on rules.manage (a Super Admin passes), refuse a change without a reason, and write the new copy and its history entry in one transaction; Settings > Report Rules is the editor. rules.manage is declared in lib/roles.js, and its seed script backfills existing holders when run with --apply.",
    where: [
      'lib/rules/load.server.js (ORG_CONFIG_COLLECTION)',
      'app/api/rules/route.js (historyRef)',
      'lib/roles.js (MANAGE_RULES)',
      'scripts/seed-rules-manage-rbac.mjs',
      'app/(app)/settings/report-rules',
    ],
  },
  {
    decision: 24,
    change: "Score Live runs the CRM's own lib — the rules, the step feed's consumers and the MIS engine — through its module hook (registerCrmModules); its hand-copied engine is retired. The Overview page and its analytics route show only what they measure: the invented latency, uptime and error-rate figures are gone.",
    where: [
      'score-live/lib/crmModules.js (registerCrmModules)',
      'score-live/engine/crmBoard.js (scopeCrmExecutiveSteps)',
      'app/(app)/overview/page.jsx',
      'app/api/dashboard-analytics/route.js (systemHealth, calculateDataQuality)',
    ],
  },
  {
    decision: 25,
    change: "HR-ERP's side, in the HR-ERP repo: its report APIs that answered without a login are locked. The CRM calls none of them; its own HR-ERP reads carry a signed embed token.",
    where: ['hr-erp app/api/crm-app', 'hr-erp app/api/po/po-data', 'hr-erp app/api/sales-order', 'hr-erp app/api/indent', 'hr-erp app/api/quotes', 'hr-erp app/api/material-rec'],
  },
]);
