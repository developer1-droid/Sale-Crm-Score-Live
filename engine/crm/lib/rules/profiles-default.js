// VERBATIM COPY of CRM lib/rules/profiles-default.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/profiles-default.js
//
// How each score is worked out today, written down: which formula, with which
// weights, over which window, and who may win the reward.
//
// Four scores: the CRM Executive score (Department Analytics' CRM tab and the
// Scoreboard) and the Process Coordinator desk (the Scoreboard's PC section),
// both over the MIS step feed; the designer score (Scoreboard and Design
// Analytics), over the Design Request rows; and Department Analytics' "Other"
// tab, read by Delay %. The Sales Coordinator score is out of scope and is not
// described here.
//
// Pure and Firebase-free. Weights are imported from the scoring engine where it
// exports them; the CRM cohort tune is copied (with its source) because the
// module that holds it pulls in the Firebase client.

import { ROLE } from '../team-roles.js';
import {
  OVERLOAD_LATE_WEIGHT,
  OVERLOAD_LOAD_WEIGHT,
  OVERLOAD_PENALTY_CAP,
  TIMELINESS_WEIGHTS,
  WINNER_WEIGHTS,
} from '../scoring/winnerScore.js';
import { DUTY } from './owners-default.js';

/** Profile keys a step's `scoreIn` names. */
export const PROFILE = Object.freeze({
  CRM_EXEC: 'crmExec',
  PC_DESK: 'pcDesk',
  DESIGNER: 'designer',
  DEPT_OTHER: 'deptOther',
});

export const FORMULA = Object.freeze({
  CRM_EXEC_WEIGHTED: 'crmExecWeighted',
  PC_DESK_WEIGHTED: 'pcDeskWeighted',
  DESIGNER_LEGACY: 'designerLegacy',
  MISS_PCT: 'missPct',
});

export const PERIOD = Object.freeze({ ROLLING: 'rolling', IST_CALENDAR: 'istCalendar' });

export const CARRY_OVER = Object.freeze({ SCORED: 'scored', LISTED: 'listed' });

export const EARLY_FINISH = Object.freeze({ NOW: 'now', AT_PLANNED: 'atPlanned' });

// lib/scoring/crmExecScore.js:99-101 — the CRM cohort tune: 60/40, a K=6
// shrinkage toward the cohort mean, and at least 3 delivered steps to rank.
const CRM_WEIGHTS = Object.freeze({ timeliness: 0.6, volume: 0.4 });
const CRM_SHRINKAGE_K = 6;
const CRM_MIN_DELIVERED = 3;

// The Scoreboard's reward rule: top N per section AND score >= minimum
// (app/(app)/scoreboard/page.jsx:346-351). Settings can set both
// (systemSettings/globalCutoffDates rewardTopN, rewardMinScore); these are the
// values the app uses when it has not (store/systemSettingsSlice.js:47-50).
export const REWARD_TOP_N = 2;
const REWARD_MIN_SCORE = 50;

// Open work carried into every window regardless of its plan date: overdue and
// held for the CRM and Other reports (lib/reports/deptPerformance.js:153-159),
// overdue only for the PC desk (lib/scoring/crmExecScore.js:190-211).
const OVERDUE = 'OVERDUE';
const HOLD = 'HOLD';

/** Every profile reads today's windows live: nothing is frozen when a period ends. */
const outcome = (carryOver) => ({ carryOver, earlyFinish: EARLY_FINISH.NOW, freezeOnClose: false });

const reward = () => ({ topN: REWARD_TOP_N, minScore: REWARD_MIN_SCORE });

/** Anyone on one of these duties. */
const onDuty = (duties) => ({ any: duties.map((duty) => ({ fact: 'duties', op: 'includes', value: duty })) });

/** The people the PC desk lens credits: order scheduling and the follow-up coordinator. */
const PC_DESK_DUTIES = [DUTY.ORDER_SCHEDULING, DUTY.FOLLOW_UP_COORDINATOR];

/**
 * The Process Coordinator lens (lib/scoring/crmExecScore.js:139-188): SO-0
 * stays with order scheduling, and every other step, in every department, is
 * the follow-up coordinator's to chase. SO-0 is the only step the order
 * scheduling duty owns, so naming the duty names the step.
 */
export const PC_DESK_LENS = Object.freeze({
  keepOwnerWhenDuty: Object.freeze([DUTY.ORDER_SCHEDULING]),
  everyOtherStepTo: DUTY.FOLLOW_UP_COORDINATOR,
});

/** A copy of the lens a profile's params can carry (params are replaced whole, never shared). */
const pcDeskLens = () => ({ ...PC_DESK_LENS, keepOwnerWhenDuty: [...PC_DESK_LENS.keepOwnerWhenDuty] });

/**
 * Department Analytics' Other tab reads the PC desk through the same lens
 * (lib/reports/deptPerformance.js:114-136 scopeOtherSteps over
 * lib/scoring/crmExecScore.js scopePcSteps):
 * SO-0 is order scheduling's and every other step in the business is the
 * follow-up coordinator's. Her lens rows make up her own row only — marked
 * isFollowUp and kept out of the team totals (deptPerformance.js:126,151), which
 * would otherwise be the whole company's delay. Order scheduling's SO-0 rows
 * are its own work and count in the totals.
 */
const LENS_ROWS_IN_TEAM_TOTALS = false;

/** The Other tab's lens params, as a fresh copy for one profile's params. */
export const deptOtherLensParams = () => ({ lens: pcDeskLens(), lensRowsInTeamTotals: LENS_ROWS_IN_TEAM_TOTALS });

/** @type {Object<string, object>} ScoringProfile by key (the shared rules contract). */
export const DEFAULT_PROFILES = {
  [PROFILE.CRM_EXEC]: {
    key: PROFILE.CRM_EXEC,
    label: 'CRM Executives',
    // lib/scoring/crmExecScore.js:118-137 over lib/reports/deptPerformance.js:91-101.
    formula: FORMULA.CRM_EXEC_WEIGHTED,
    params: {
      weights: { ...CRM_WEIGHTS },
      timelinessWeights: { ...TIMELINESS_WEIGHTS },
      shrinkageK: CRM_SHRINKAGE_K,
      minDelivered: CRM_MIN_DELIVERED,
      overload: false,
      carriedStatuses: [OVERDUE, HOLD],
    },
    period: PERIOD.ROLLING,
    outcome: outcome(CARRY_OVER.SCORED),
    reward: reward(),
    grades: null,
    cohort: { fact: 'role', op: 'eq', value: ROLE.CRM },
  },
  [PROFILE.PC_DESK]: {
    key: PROFILE.PC_DESK,
    label: 'Process Coordinators',
    // lib/scoring/crmExecScore.js:157-211: the winner score's 70/30 default, no
    // shrinkage, ranked as soon as the desk holds any step.
    formula: FORMULA.PC_DESK_WEIGHTED,
    params: {
      weights: { ...WINNER_WEIGHTS },
      timelinessWeights: { ...TIMELINESS_WEIGHTS },
      shrinkageK: 0,
      minDelivered: 0,
      rankedWhen: 'holdsAnyStep',
      overload: false,
      carriedStatuses: [OVERDUE],
      lens: pcDeskLens(),
    },
    period: PERIOD.ROLLING,
    outcome: outcome(CARRY_OVER.SCORED),
    reward: reward(),
    grades: null,
    cohort: onDuty(PC_DESK_DUTIES),
  },
  [PROFILE.DESIGNER]: {
    key: PROFILE.DESIGNER,
    label: 'Designers',
    // lib/scoring/designerScore.js:59-143 — raw Design Request rows, the
    // overload penalty on, a designer counted once a design was judged.
    formula: FORMULA.DESIGNER_LEGACY,
    params: {
      weights: { ...WINNER_WEIGHTS },
      timelinessWeights: { ...TIMELINESS_WEIGHTS },
      shrinkageK: 0,
      minDelivered: 0,
      rankedWhen: 'judgedAny',
      overload: {
        cap: OVERLOAD_PENALTY_CAP,
        loadWeight: OVERLOAD_LOAD_WEIGHT,
        lateWeight: OVERLOAD_LATE_WEIGHT,
      },
      // A designer is the free-text 'Assigned Designer' (lib/scoring/designerScore.js:62).
      designerIdentity: 'assignedDesignerName',
      // A design belongs to the window holding its 'Design Due At'
      // (app/(app)/scoreboard/page.jsx:421-423).
      windowBy: 'plannedAt',
    },
    period: PERIOD.ROLLING,
    // Windowed by due date only, so an open design due before the window is
    // not scored against it (app/(app)/scoreboard/page.jsx:422).
    outcome: outcome(CARRY_OVER.LISTED),
    reward: reward(),
    grades: null,
    cohort: null,
  },
  [PROFILE.DEPT_OTHER]: {
    key: PROFILE.DEPT_OTHER,
    label: 'Other (Delay %)',
    // Delay % = (late done + overdue) / every step in the window x 100, 0 best
    // (lib/reports/deptPerformance.js:162-164). The contract has no Delay %
    // formula: it is the miss share read over the whole window, unsigned.
    formula: FORMULA.MISS_PCT,
    params: {
      variant: 'delayPct',
      missed: ['lateDone', 'overdue'],
      denominator: 'allStepsInWindow',
      sign: 1,
      decimals: 0,
      carriedStatuses: [OVERDUE, HOLD],
      ...deptOtherLensParams(),
    },
    period: PERIOD.ROLLING,
    outcome: outcome(CARRY_OVER.SCORED),
    reward: null,
    grades: null,
    // lib/reports/deptPerformance.js:32,114-136: Process Coordinators, every
    // unrecognised role, and the PC desk lens.
    cohort: {
      any: [{ fact: 'role', op: 'in', value: [ROLE.PC, ROLE.OTHER] }, onDuty(PC_DESK_DUTIES)],
    },
  },
};
