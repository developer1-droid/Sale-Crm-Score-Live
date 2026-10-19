// VERBATIM COPY of CRM lib/mis/board.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/board.js
//
// A scoring profile's leaderboard on the MIS engine: what the Scoreboard's
// CRM, Process Coordinator and Designers sections, Department Analytics and
// Score Live's CRM board show when the profile scores on the engine
// (lib/mis/profile-engine.js scoresOnMisEngine). One builder per source, so
// every one of those surfaces gives the same score, grade, rank and reward for
// the same person and period:
//
//   buildMisBoard    the step feed, scored by the CRM MIS's own report
//                    (lib/crm-mis/report.js buildCrmMisReport), with the
//                    profile's desk lens and cohort applied
//   designerBoardOf  the Designer MIS's report (lib/designer-mis/report.js
//                    buildDesignerMisReport), with the profile's cohort applied
//
// The lens (ScoringProfile.params.lens, lib/mis/lens.js) decides whose a step
// is; the cohort (lib/mis/cohort.js) decides who is on the board. With
// `params.lensRowsInTeamTotals: false` (Department Analytics' Other tab) the
// lens is a view beside everyone's own work: its people's rows are the lens's
// and stay out of the team totals. Otherwise (the Process Coordinator desk)
// the lens is the whole view. A person's score is the engine's over their own
// steps, so the cohort changes who is listed and the ranks, never a score.
//
// A rank and a reward are places among everyone, so only a reader who sees
// everyone's steps (`seesEveryone`) gets them. The reward goes to people only,
// the top N at the profile's minimum score or better (decision #1).
//
// Pure; lib/__tests__/mis-board.test.js.

import { buildCrmMisReport, gradeFor, profileOf, rewardedPeople } from '../crm-mis/report.js';
import { DESIGNER_PROFILE } from '../designer-mis/types.js';
import { cohortTest } from './cohort.js';
import { boardInsights } from './insights.js';
import { fmtPct } from './format.js';
import { lensItems, lensPeople } from './lens.js';
import { periodLabel } from './period.js';
import { doerKeyOf, scoreOutcomes } from './score.js';
import { rewardRuleOf } from './profile-engine.js';

/**
 * @typedef {object} MisBoardRow  One person on a board.
 * @property {string} key        doerKeyOf: their email.
 * @property {string} name
 * @property {string} doerId
 * @property {number|null} rank  From 1 among the ranked; null for a reader who sees only their own steps.
 * @property {number|null} score The signed miss % (notOnTimePct), 0 best; null with nothing planned.
 * @property {string} scoreText  "−12.5%", "0%", "—".
 * @property {string} grade
 * @property {boolean} isRewarded
 * @property {boolean} isLens    The row is a desk lens's view of the business, not the person's own work.
 * @property {number} planned
 * @property {number} done
 * @property {number} onTime
 * @property {number} late
 * @property {number} notDone
 * @property {number} carryover
 * @property {number} upcoming
 * @property {number} excused
 * @property {number} backlog
 * @property {number|null} avgDelayMin
 *
 * @typedef {object} MisBoard
 * @property {string} profileKey
 * @property {string} label           The profile's label.
 * @property {import('./types.js').MisPeriod} period
 * @property {string} periodLabel
 * @property {string} generatedAt     The instant the steps were read at, ISO.
 * @property {MisBoardRow[]} rows     The ranked: everyone in the cohort with something planned, best first.
 * @property {MisBoardRow[]} benched  The cohort's people with nothing planned in the period.
 * @property {import('./types.js').MisTally} team  The cohort's own work, each step once.
 * @property {string} teamGrade
 * @property {{ topN: number, minScore: number }|null} reward
 * @property {boolean} seesEveryone
 * @property {string[]} warnings
 * @property {ReturnType<typeof import('./insights.js').boardInsights>} insights  The steps that miss most and the
 *   delay reasons written most, over the team's own steps.
 */

const lensOf = (profile) => {
  const lens = profile?.params?.lens;
  return lens && typeof lens === 'object' ? lens : null;
};

/** The lens people's rows are part of the team's own work (the PC desk), unless the profile keeps them out. */
const isLensInTotals = (profile) => profile?.params?.lensRowsInTeamTotals !== false;

/**
 * The scored steps a board is made of: everyone's own (no lens), the lens's
 * whole view, or everyone's own with the lens people's rows the lens's.
 * `lensKeys` are the lens people whose rows stay out of the team totals.
 */
function boardSteps({ items, rules, profile, score }) {
  const lens = lensOf(profile);
  if (!lens) return { steps: score(items).steps, lensKeys: new Set() };
  const people = lensPeople(lens, rules);
  const views = (people.length > 0 ? people : [null]).map((person) => ({
    person,
    steps: score(lensItems(items, lens, rules, person)).steps,
  }));
  const lensKeys = new Set(people.map((person) => person.email));
  const lensRows = views.flatMap(({ person, steps }) => (person ? steps.filter((step) => step.doerId === person.email) : []));
  const notLens = (step) => !lensKeys.has(step.doerId);
  if (isLensInTotals(profile)) return { steps: [...views[0].steps.filter(notLens), ...lensRows], lensKeys: new Set() };
  return { steps: [...score(items).steps.filter(notLens), ...lensRows], lensKeys };
}

/**
 * The name a row goes by: the engine's, unless it knows the person only by
 * their address — then the team directory's display name, when it has one.
 */
const displayName = (doer, nameOf) => (doer.doer === doer.doerId && nameOf ? nameOf(doer.doerId) || doer.doer : doer.doer);

function rowOf(doer, { rank, grade, isRewarded, isLens, nameOf }) {
  return {
    key: doerKeyOf(doer),
    name: displayName(doer, nameOf),
    doerId: doer.doerId,
    rank,
    score: doer.notOnTimePct,
    scoreText: fmtPct(doer.notOnTimePct),
    grade,
    isRewarded,
    isLens,
    planned: doer.planned,
    done: doer.done,
    onTime: doer.onTime,
    late: doer.late,
    notDone: doer.notDone,
    carryover: doer.carryover,
    upcoming: doer.upcoming,
    excused: doer.excused,
    backlog: doer.backlog,
    avgDelayMin: doer.avgDelayMin,
  };
}

/**
 * The cohort's people, ranked as the engine ordered them: those with work
 * planned get a place (when the reader sees everyone), the rest are benched.
 */
function placeRows(people, { seesEveryone, rewarded, gradeOf, lensKeys, nameOf }) {
  const ranked = people.filter((doer) => doer.planned > 0);
  const rowFor = (doer, rank) => rowOf(doer, {
    rank,
    grade: gradeOf(doer),
    isRewarded: seesEveryone && rewarded.has(doerKeyOf(doer)),
    isLens: lensKeys.has(doer.doerId),
    nameOf,
  });
  return {
    rows: ranked.map((doer, i) => rowFor(doer, seesEveryone ? i + 1 : null)),
    benched: people.filter((doer) => doer.planned <= 0).map((doer) => rowFor(doer, null)),
  };
}

/**
 * @param {object} input
 * @param {object[]} input.items  Step-feed items, served or rehydrated.
 * @param {object} input.rules  The resolved rules, whole or as GET /api/rules/resolved trims them.
 * @param {string} input.profileKey  A key of rules.profiles scored on the step feed.
 * @param {import('./types.js').MisPeriod} input.period
 * @param {Date} input.now  The instant the feed's clocks were read at (lib/crm-mis/report.js clockOf).
 * @param {boolean} input.seesEveryone  The items are everyone's steps, not the reader's own.
 * @param {(email: string) => string|null} input.roleOf  The team directory's role of a person.
 * @param {(email: string) => string} [input.nameOf]  The team directory's display name of a person.
 * @returns {MisBoard}
 */
export function buildMisBoard({ items, rules, profileKey, period, now, seesEveryone, roleOf, nameOf }) {
  const profile = profileOf(rules, profileKey);
  const warnings = new Set();
  const score = (feedItems) => {
    const report = buildCrmMisReport({ items: feedItems, rules, profileKey, period, now, seesEveryone });
    report.warnings.forEach((warning) => warnings.add(warning));
    return report;
  };
  const { steps, lensKeys } = boardSteps({ items, rules, profile, score });
  const inCohort = cohortTest(profile, { rules, roleOf });
  const people = scoreOutcomes(steps).doers.filter(inCohort);
  const reward = rewardRuleOf(profile);
  const rewarded = new Set(seesEveryone ? rewardedPeople(people.filter((doer) => doer.planned > 0), reward) : []);
  const teamSteps = steps.filter((step) => inCohort(step) && !lensKeys.has(step.doerId));
  const team = scoreOutcomes(teamSteps).team;
  return {
    profileKey,
    label: profile?.label ?? profileKey,
    period,
    periodLabel: periodLabel(period),
    generatedAt: now.toISOString(),
    ...placeRows(people, { seesEveryone, rewarded, gradeOf: (doer) => gradeFor(profile, doer.notOnTimePct), lensKeys, nameOf }),
    team,
    teamGrade: gradeFor(profile, team.notOnTimePct),
    reward,
    seesEveryone,
    warnings: [...warnings],
    insights: boardInsights(teamSteps),
  };
}

/**
 * The Designers' board from the Designer MIS's report: its grades and its
 * reward (the registry's designers only), with the designer profile's cohort.
 *
 * @param {ReturnType<typeof import('../designer-mis/report.js').buildDesignerMisReport>} report
 * @param {{ rules: object, roleOf?: (email: string) => string|null, seesEveryone: boolean }} deps
 * @returns {MisBoard & { error: string|null }}
 */
export function designerBoardOf(report, { rules, roleOf, seesEveryone }) {
  const profile = profileOf(rules, DESIGNER_PROFILE);
  const inCohort = cohortTest(profile, { rules, roleOf });
  const people = report.doers.filter(inCohort);
  const rewarded = new Set(people.filter((doer) => doer.isRewarded).map(doerKeyOf));
  return {
    profileKey: DESIGNER_PROFILE,
    label: report.profile.label,
    period: report.period,
    periodLabel: report.label,
    generatedAt: report.generatedAt,
    ...placeRows(people, { seesEveryone, rewarded, gradeOf: (doer) => doer.grade, lensKeys: new Set() }),
    team: report.team,
    teamGrade: report.teamGrade,
    reward: rewardRuleOf(profile),
    seesEveryone,
    warnings: report.warnings,
    error: report.error,
    insights: boardInsights(report.steps.filter(inCohort)),
  };
}
