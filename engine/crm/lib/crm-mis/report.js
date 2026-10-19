// VERBATIM COPY of CRM lib/crm-mis/report.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/crm-mis/report.js
//
// The CRM MIS report: the step feed scored by the MIS engine (lib/mis) under a
// registry profile, for a period. What app/(app)/reports/crm-mis shows.
//
// The engine is hr-erp's; what this adds is the wiring the registry decides:
// which steps the profile counts (lib/crm-mis/steps.js), each step's own board
// grace (StepRule.graceMin), the profile's early-finish and carry-over policy,
// its grade bands and its reward rule, and the duties a person holds, shown
// beside their name. Every step is credited to the person its board names as
// owner. Given the team directory's roles, only the profile's cohort is
// scored, so the CRM Executives' profile lists CRM Executives alone, as the
// Scoreboard ranks them; the Process Coordinator desk's follow-up lens
// (ScoringProfile.params.lens) is the Scoreboard's alone.
//
// A rank and a reward are places among everyone. GET /api/step-feed hands a
// reader without a view-all grant their own steps only, and over those they
// would always be first and always in line for the reward; so the reward is
// worked out only for a feed that holds everyone's steps (`seesEveryone`),
// and the page shows no rank or reward otherwise.
//
// Pure; lib/__tests__/crm-mis-report.test.js.

import { cohortTest } from '../mis/cohort.js';
import { doerStepsOf } from '../mis/doers.js';
import { periodBounds, periodLabel } from '../mis/period.js';
import { doerKeyOf, misGrade, misPolicyOf, rewardedDoers, scoreMis } from '../mis/score.js';
import { MIS_DEFAULT_GRADES, NO_GRACE_MIN } from '../mis/types.js';
import { toMisSteps } from './steps.js';

/** The profiles the page offers, in order, each with the label used when the registry has no such profile. */
export const CRM_MIS_PROFILES = Object.freeze([
  Object.freeze({ key: 'crmExec', fallbackLabel: 'CRM Executives' }),
  Object.freeze({ key: 'pcDesk', fallbackLabel: 'Process Coordinator desk' }),
  Object.freeze({ key: 'deptOther', fallbackLabel: 'Other' }),
]);

/** The page opens on today's CRM Executive cohort. */
export const DEFAULT_CRM_MIS_PROFILE = CRM_MIS_PROFILES[0].key;

/** A profile of the rules by key, or null. */
export const profileOf = (rules, profileKey) =>
  (rules?.profiles && typeof profileKey === 'string' && Object.hasOwn(rules.profiles, profileKey) ? rules.profiles[profileKey] : null);

/** The picker's choices: the registry's label for each profile, the fallback when it has none. */
export function profileOptions(rules) {
  return CRM_MIS_PROFILES.map(({ key, fallbackLabel }) => {
    const label = String(profileOf(rules, key)?.label ?? '').trim();
    return { key, label: label || fallbackLabel };
  });
}

/** The working minutes a step may run late and still be on time: its own rule's grace; none without a rule. */
export function graceOfStep(rules, step) {
  const grace = rules?.steps?.[step?.stepKey]?.graceMin;
  return Number.isFinite(grace) ? grace : NO_GRACE_MIN;
}

/**
 * The grade bands a profile scores on. A profile with none (today's defaults
 * describe the weighted scores, which had no letters) is graded on hr-erp's
 * own bands, the engine's default and owner decision #1.
 */
export const gradesOf = (profile) => (Array.isArray(profile?.grades) && profile.grades.length > 0 ? profile.grades : MIS_DEFAULT_GRADES);

/** The letter for a score under a profile. */
export const gradeFor = (profile, score) => misGrade(score, gradesOf(profile));

/**
 * The doer keys a profile's reward goes to: the engine's rule (top N by rank,
 * at the minimum score or better) over the people alone. "Unassigned" is a gap
 * on the boards, not a person, so it never takes a reward or a place in the
 * top N; the people keep their order.
 * @param {ReadonlyArray<import('../mis/types.js').MisDoerScore>} doers  Ranked.
 * @param {{ topN: number, minScore: number }|null} reward
 * @returns {string[]}
 */
export function rewardedPeople(doers, reward) {
  const people = doers.filter((doer) => doer.doerId !== null).map((doer, i) => ({ ...doer, rank: i + 1 }));
  return rewardedDoers(people, reward).map(doerKeyOf);
}

/**
 * The instant a report is read at: the feed's build time, so what is due
 * agrees with the delays the boards measured then; `fallback` when the feed
 * sent no readable time.
 * @param {string|number|null|undefined} builtAt
 * @param {Date} fallback
 */
export function clockOf(builtAt, fallback) {
  const isStamp = typeof builtAt === 'string' || typeof builtAt === 'number';
  const ms = isStamp ? new Date(builtAt).getTime() : Number.NaN;
  return Number.isFinite(ms) ? new Date(ms) : fallback;
}

/** The duty labels each registry person holds, by lower-case email. */
export function dutiesByEmail(rules) {
  const duties = new Map();
  Object.values(rules?.duties ?? {}).forEach((duty) => {
    (duty?.people ?? []).forEach((person) => {
      const email = String(person?.email ?? '').trim().toLowerCase();
      if (!email) return;
      duties.set(email, [...(duties.get(email) ?? []), String(duty.label ?? '')]);
    });
  });
  return duties;
}

/**
 * @param {object} input
 * @param {object[]} input.items  Feed items (lib/step-feed/client.js rehydrate, or as served).
 * @param {object} input.rules  The resolved rules, whole or as /api/rules/resolved trims them.
 * @param {string} input.profileKey  The profile to score: a key of rules.profiles.
 * @param {import('../mis/types.js').MisPeriod} input.period
 * @param {Date} input.now  The instant the feed's clocks were read at.
 * @param {boolean} [input.seesEveryone]  The items are everyone's steps (a super admin or a
 *   step-feed view-all grant, lib/step-feed/route-logic.js STEP_FEED_VIEW_ALL_SLUGS), not
 *   the reader's own; only then are ranks and the reward places among the team.
 * @param {(email: string) => string|null} [input.roleOf]  The team directory's role of a person
 *   (lib/team-directory.js designationOf). Given, only the profile's cohort is scored — the CRM
 *   Executives' profile lists CRM Executives alone (lib/mis/cohort.js); without it every board
 *   owner is listed.
 * @returns {import('../mis/types.js').MisReport & {
 *   profileKey: string, teamGrade: string, rewarded: string[], seesEveryone: boolean
 * }}  `rewarded` holds the doer keys (doerKeyOf) the profile's reward goes to (rewardedPeople):
 *   none unless `seesEveryone`.
 */
export function buildCrmMisReport({ items, rules, profileKey, period, now, seesEveryone = false, roleOf = null }) {
  const profile = profileOf(rules, profileKey);
  const steps = toMisSteps(items, rules, profileKey);
  const { start, end } = periodBounds(period);
  const policy = misPolicyOf(profile, (step) => graceOfStep(rules, step));
  const inCohort = roleOf ? cohortTest(profile, { rules, roleOf }) : null;
  const doerSteps = inCohort ? doerStepsOf(steps).filter(inCohort) : doerStepsOf(steps);
  const scored = scoreMis(doerSteps, start, end, now, policy);
  const duties = dutiesByEmail(rules);
  const doers = scored.doers.map((doer) => ({
    ...doer,
    duties: doer.doerId ? duties.get(doer.doerId) ?? [] : [],
    grade: gradeFor(profile, doer.notOnTimePct),
  }));
  return {
    profileKey,
    period,
    label: periodLabel(period),
    generatedAt: now.toISOString(),
    team: scored.team,
    teamGrade: gradeFor(profile, scored.team.notOnTimePct),
    doers,
    steps: scored.steps,
    seesEveryone,
    rewarded: seesEveryone ? rewardedPeople(doers, profile?.reward ?? null) : [],
    warnings: profile ? [] : [`The rules have no scoring profile "${profileKey}"; hr-erp's own policy, grades and no reward apply.`],
  };
}
