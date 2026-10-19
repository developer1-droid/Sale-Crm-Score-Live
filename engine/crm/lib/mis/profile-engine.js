// VERBATIM COPY of CRM lib/mis/profile-engine.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/profile-engine.js
//
// Which engine a scoring profile of the rules registry scores on, read off the
// profile alone, so every surface that shows a profile's score — the
// Scoreboard, Department Analytics, Score Live and the frozen period records —
// switches on the same fields and on nothing else.
//
// Owner decision #1: a profile whose formula is the miss % (FORMULA.MISS_PCT)
// is scored by HR-ERP's MIS engine (lib/mis). Department Analytics' Other tab
// reads today's Delay % through that same formula with the 'delayPct' variant
// (lib/rules/profiles-default.js), so that variant stays on today's code path.
// Under lib/rules/defaults.js no profile scores on the engine, and every
// surface keeps today's numbers until an admin applies the decisions.
//
// Pure.

import { CARRY_OVER, FORMULA, PERIOD } from '../rules/profiles-default.js';

/** The params variant Department Analytics' Other tab reads today's Delay % with (lib/rules/profiles-default.js). */
export const DELAY_PCT_VARIANT = 'delayPct';

/**
 * The Purchase Coordinators' profile, as the owner's decision #22 adds it
 * (lib/rules/decisions-2026-10-10.js); today's defaults have none.
 */
export const PURCHASE_PROFILE = 'purchase';

/** The profile scores on HR-ERP's MIS engine: the miss % formula, not today's Delay % variant of it. */
export const scoresOnMisEngine = (profile) =>
  profile?.formula === FORMULA.MISS_PCT && profile?.params?.variant !== DELAY_PCT_VARIANT;

/** Its periods are IST Monday–Sunday weeks and calendar months (decision #2), not the surface's own windows. */
export const usesIstCalendar = (profile) => profile?.period === PERIOD.IST_CALENDAR;

/**
 * What the profile does with work still open from before the period (decision
 * #3): CARRY_OVER.LISTED lists it as backlog, out of the period's numbers;
 * CARRY_OVER.SCORED — today's rule, and a profile that names neither — counts
 * it against the period.
 */
export const carryOverOf = (profile) =>
  (profile?.outcome?.carryOver === CARRY_OVER.LISTED ? CARRY_OVER.LISTED : CARRY_OVER.SCORED);

/** A closed period's scores are read from a frozen record (decision #4). */
export const freezesOnClose = (profile) => profile?.outcome?.freezeOnClose === true;

/**
 * The profile's reward rule — a top N of one or more and a finite minimum
 * score — or null when it rewards nobody.
 * @returns {{ topN: number, minScore: number }|null}
 */
export function rewardRuleOf(profile) {
  const reward = profile?.reward;
  if (!reward || !Number.isInteger(reward.topN) || reward.topN < 1 || !Number.isFinite(reward.minScore)) return null;
  return { topN: reward.topN, minScore: reward.minScore };
}
