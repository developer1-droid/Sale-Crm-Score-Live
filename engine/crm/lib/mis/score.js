// VERBATIM COPY of CRM lib/mis/score.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/score.js
//
// The MIS score — pure. A step counts for the period when its planned time
// falls inside it and has already passed; a step planned later in the period
// is not due yet, so it is listed as upcoming and left out of the score.
//
//   Not done %         = −(planned − done)            ÷ planned × 100
//   Not done on time % = −(planned − done on time)    ÷ planned × 100   ← the score
//
// Done on time means finished with no working minutes of delay beyond the
// board's grace. 0% is best. The backlog — not done plus carried over — is what
// is still pending now.
//
// Ported from hr-erp lib/mis/score.ts. Every default reproduces hr-erp exactly;
// what the CRM adds is taken from the rules registry, never declared here:
//   • graceMin — isOnTime and outcomeOf take the board's grace (StepRule.graceMin,
//     inclusive working minutes); 0 is hr-erp's rule. scoreMis takes a number or
//     a function of the step, since each board has its own.
//   • earlyFinish — bucketOf takes the profile's rule: 'atPlanned' (hr-erp: an
//     early finish counts once its planned time passes) or 'now' (it counts as
//     soon as it is done).
//   • carryOver — outcomeOf takes the profile's rule: 'listed' (hr-erp: open
//     work from before the period is backlog, not scored) or 'scored' (it is
//     scored against the period as not done).
//   • excused — a step the board shows closed or waived with a reason is
//     listed with that outcome, scored to nobody, and not backlog.
//   • misGrade takes the profile's grade bands and rewardedDoers its reward
//     rule; misPolicyOf reads a ScoringProfile into the policy scoreMis takes.

import {
  MIS_BUCKET,
  MIS_CARRY_OVER,
  MIS_DEFAULT_GRADES,
  MIS_DEFAULT_POLICY,
  MIS_EARLY_FINISH,
  MIS_FLOWS,
  MIS_NO_GRADE,
  MIS_OUTCOME,
  misStepLabel,
} from './types.js';

/** Scores at or above this read as amber, below it red; only 0 is green. */
export const MIS_WARN_FLOOR = -10;

const PCT = 100;
const ONE_DECIMAL = 10;
// One multiplication, as hr-erp's score.ts does (x * 1000): multiplying by 100
// and then by 10 lands on the other side of a half at e.g. 23/80 and changes a
// rank. 100 * 10 is the exact double 1000, so this is bit-identical to hr-erp.
const PER_MILLE = PCT * ONE_DECIMAL;

/**
 * A letter for a score, for screens that show one: the first band the score
 * reaches, highest `min` first; the last band for anything below them all;
 * "—" with nothing planned. The bands are the profile's (ScoringProfile.grades);
 * hr-erp's A/B/C/D are the default.
 * @param {number|null} score
 * @param {ReadonlyArray<{ grade: string, min: number }>} [grades]
 */
export function misGrade(score, grades = MIS_DEFAULT_GRADES) {
  if (score === null) return MIS_NO_GRADE;
  // A profile's grades are nullable in the contract; no bands means no letter.
  const bands = grades ?? [];
  // A band with no min (the registry writes null, or −Infinity) takes everything below the others.
  const band = bands.find((g) => g.min === null || g.min === undefined || score >= g.min) ?? bands[bands.length - 1];
  return band ? band.grade : MIS_NO_GRADE;
}

/** −(missed ÷ planned) as a percentage to one decimal; null with nothing planned. Never "−0". */
export function missPct(missed, planned) {
  if (planned <= 0) return null;
  const pct = Math.round((missed / planned) * PER_MILLE) / ONE_DECIMAL;
  return pct === 0 ? 0 : -pct;
}

/** A step the board shows closed or waived, with the reason that needs: an `excuse` with a reason in it. */
export function isExcused(step) {
  const reason = step.excuse?.reason;
  return typeof reason === 'string' && reason.trim() !== '';
}

/**
 * Done, and no later than the board allows.
 * @param {import('./types').MisDoerStep} step
 * @param {number} [graceMin]  Inclusive working minutes; 0 is hr-erp's rule.
 */
export function isOnTime(step, graceMin = MIS_DEFAULT_POLICY.graceMin) {
  return step.actualAt !== null && (step.delayMin ?? 0) <= graceMin;
}

/** The grace a policy gives one step: one number for every board, or each board's own. */
export function graceMinOf(policy, step) {
  const grace = policy?.graceMin ?? MIS_DEFAULT_POLICY.graceMin;
  return typeof grace === 'function' ? grace(step) : grace;
}

/**
 * Where a step falls for the period [start, end) as of now (MIS_BUCKET).
 * An excused step is not open, so it never carries over; it is listed in the
 * period its plan fell in.
 * @param {import('./types').MisDoerStep} step
 * @param {Date} start
 * @param {Date} end
 * @param {Date} now
 * @param {'atPlanned'|'now'} [earlyFinish]
 */
export function bucketOf(step, start, end, now, earlyFinish = MIS_DEFAULT_POLICY.earlyFinish) {
  const planned = Date.parse(step.plannedAt);
  const isOpen = step.actualAt === null && !isExcused(step);
  if (planned >= start.getTime() && planned < end.getTime()) {
    const countsNow = earlyFinish === MIS_EARLY_FINISH.NOW && step.actualAt !== null;
    return planned <= now.getTime() || countsNow ? MIS_BUCKET.DUE : MIS_BUCKET.UPCOMING;
  }
  if (planned < start.getTime() && isOpen) return MIS_BUCKET.CARRYOVER;
  return MIS_BUCKET.OUTSIDE;
}

/**
 * How a step in the period's view stands — see MIS_OUTCOME.
 * @param {import('./types').MisDoerStep} step
 * @param {'due'|'upcoming'|'carryover'} bucket
 * @param {import('./types').MisPolicy} [policy]
 */
export function outcomeOf(step, bucket, policy = MIS_DEFAULT_POLICY) {
  if (isExcused(step)) return MIS_OUTCOME.EXCUSED;
  if (bucket === MIS_BUCKET.UPCOMING) return MIS_OUTCOME.UPCOMING;
  if (bucket === MIS_BUCKET.CARRYOVER) {
    const carryOver = policy?.carryOver ?? MIS_DEFAULT_POLICY.carryOver;
    return carryOver === MIS_CARRY_OVER.SCORED ? MIS_OUTCOME.NOT_DONE : MIS_OUTCOME.CARRIED_OVER;
  }
  if (step.actualAt === null) return MIS_OUTCOME.NOT_DONE;
  return isOnTime(step, graceMinOf(policy, step)) ? MIS_OUTCOME.ON_TIME : MIS_OUTCOME.LATE;
}

function emptyTally() {
  return { planned: 0, done: 0, onTime: 0, late: 0, notDone: 0, carryover: 0, upcoming: 0, excused: 0 };
}

function add(t, outcome) {
  switch (outcome) {
    case MIS_OUTCOME.UPCOMING:
      t.upcoming += 1;
      return;
    case MIS_OUTCOME.CARRIED_OVER:
      t.carryover += 1;
      return;
    case MIS_OUTCOME.EXCUSED:
      t.excused += 1;
      return;
    case MIS_OUTCOME.NOT_DONE:
      t.planned += 1;
      t.notDone += 1;
      return;
    case MIS_OUTCOME.LATE:
      t.planned += 1;
      t.done += 1;
      t.late += 1;
      return;
    case MIS_OUTCOME.ON_TIME:
      t.planned += 1;
      t.done += 1;
      t.onTime += 1;
      return;
    default:
      return;
  }
}

/** @returns {import('./types').MisTally} */
function tallyOf(t) {
  return {
    ...t,
    notDonePct: missPct(t.planned - t.done, t.planned),
    notOnTimePct: missPct(t.planned - t.onTime, t.planned),
    backlog: t.notDone + t.carryover,
  };
}

function newDoer(step) {
  return {
    doer: step.doer,
    doerId: step.doerId,
    total: emptyTally(),
    flows: new Set(),
    steps: new Map(),
    delaySum: 0,
    delayCount: 0,
  };
}

const stepEntryKey = (step) => `${step.flow}|${step.stepKey}`;

function countStep(acc, step, outcome) {
  add(acc.total, outcome);
  acc.flows.add(step.flow);
  const key = stepEntryKey(step);
  const entry = acc.steps.get(key) ?? {
    flow: step.flow, stepKey: step.stepKey, code: step.code, label: step.label, tally: emptyTally(),
  };
  add(entry.tally, outcome);
  acc.steps.set(key, entry);
  const isMissed = outcome === MIS_OUTCOME.LATE || outcome === MIS_OUTCOME.NOT_DONE;
  if (isMissed && (step.delayMin ?? 0) > 0) {
    acc.delaySum += step.delayMin ?? 0;
    acc.delayCount += 1;
  }
}

const FLOW_ORDER = new Map(MIS_FLOWS.map((f, i) => [f.key, i]));

function byFlowThenLabel(a, b) {
  return (FLOW_ORDER.get(a.flow) ?? 0) - (FLOW_ORDER.get(b.flow) ?? 0) || misStepLabel(a).localeCompare(misStepLabel(b));
}

function toScore(acc) {
  return {
    doer: acc.doer,
    doerId: acc.doerId,
    ...tallyOf(acc.total),
    flows: MIS_FLOWS.map((f) => f.key).filter((f) => acc.flows.has(f)),
    avgDelayMin: acc.delayCount > 0 ? Math.round(acc.delaySum / acc.delayCount) : null,
    byStep: [...acc.steps.values()]
      .map((s) => ({ flow: s.flow, stepKey: s.stepKey, code: s.code, label: s.label, ...tallyOf(s.tally) }))
      .sort(byFlowThenLabel),
  };
}

/** Closest to 0 first; nothing planned last. Ties: fewer not done, then more work, then name. */
function byScore(a, b) {
  const scoreA = a.notOnTimePct ?? Number.NEGATIVE_INFINITY;
  const scoreB = b.notOnTimePct ?? Number.NEGATIVE_INFINITY;
  return (
    scoreB - scoreA ||
    (b.notDonePct ?? Number.NEGATIVE_INFINITY) - (a.notDonePct ?? Number.NEGATIVE_INFINITY) ||
    b.planned - a.planned ||
    a.doer.localeCompare(b.doer)
  );
}

/** Who a step is scored to: the person, or the name when nobody is assigned. */
export function doerKeyOf(row) {
  return row.doerId ?? `unassigned:${row.doer}`;
}

/**
 * Score the steps of a period. A step shared by two people counts in full for
 * each of them, and once for the team. Every step in the period's view comes
 * back with its outcome, oldest plan first, so each number on the page can be
 * opened to the steps behind it.
 * @param {ReadonlyArray<import('./types').MisDoerStep>} steps
 * @param {Date} start
 * @param {Date} end
 * @param {Date} now
 * @param {import('./types').MisPolicy} [policy]  hr-erp's rules unless the profile says otherwise.
 * @returns {{ team: import('./types').MisTally, doers: import('./types').MisDoerScore[], steps: import('./types').MisReportStep[] }}
 */
export function scoreMis(steps, start, end, now, policy = MIS_DEFAULT_POLICY) {
  const rules = { ...MIS_DEFAULT_POLICY, ...policy };
  const listed = [];
  for (const step of steps) {
    const bucket = bucketOf(step, start, end, now, rules.earlyFinish);
    if (bucket !== MIS_BUCKET.OUTSIDE) listed.push({ ...step, outcome: outcomeOf(step, bucket, rules) });
  }
  return scoreOutcomes(listed);
}

/**
 * The scoreboard for steps whose outcomes are already decided — a period's,
 * or any slice of one (a flow, a step, a search), so a filtered page counts
 * exactly the steps it lists.
 * @param {ReadonlyArray<import('./types').MisReportStep>} steps
 */
export function scoreOutcomes(steps) {
  const doers = new Map();
  const team = emptyTally();
  const teamSeen = new Set();

  for (const step of steps) {
    const key = doerKeyOf(step);
    const acc = doers.get(key) ?? newDoer(step);
    doers.set(key, acc);
    countStep(acc, step, step.outcome);
    if (!teamSeen.has(step.stepId)) {
      teamSeen.add(step.stepId);
      add(team, step.outcome);
    }
  }

  const ranked = [...doers.values()].map(toScore).sort(byScore);
  return {
    team: tallyOf(team),
    doers: ranked.map((d, i) => ({ ...d, rank: i + 1 })),
    steps: [...steps].sort((a, b) => Date.parse(a.plannedAt) - Date.parse(b.plannedAt)),
  };
}

/**
 * The doers a profile's reward goes to: the top N by rank, and only at the
 * minimum score or better (ScoringProfile.reward); nobody without a rule.
 * @param {ReadonlyArray<import('./types').MisDoerScore>} doers
 * @param {{ topN: number, minScore: number }|null} reward
 */
export function rewardedDoers(doers, reward) {
  if (!reward) return [];
  return doers.filter((d) => d.rank <= reward.topN && d.notOnTimePct !== null && d.notOnTimePct >= reward.minScore);
}

/**
 * The policy a registry profile scores with. The grace is the step's, not the
 * profile's, so it is passed alongside: one number, or a function of the step.
 * @param {{ outcome: { carryOver: string, earlyFinish: string } }} profile
 * @param {number|((step: import('./types').MisDoerStep) => number)} [graceMin]
 * @returns {import('./types').MisPolicy}
 */
export function misPolicyOf(profile, graceMin = MIS_DEFAULT_POLICY.graceMin) {
  return {
    graceMin,
    earlyFinish: profile?.outcome?.earlyFinish ?? MIS_DEFAULT_POLICY.earlyFinish,
    carryOver: profile?.outcome?.carryOver ?? MIS_DEFAULT_POLICY.carryOver,
  };
}
