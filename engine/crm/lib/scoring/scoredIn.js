// VERBATIM COPY of CRM lib/scoring/scoredIn.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/scoring/scoredIn.js
//
// Whether a score counts a step, by the rules registry: the step's rule
// (`stepKey`, as the step feed names it) lists the scoring profiles that count
// it in `scoreIn`. Under lib/rules/defaults.js every step the desks read is in
// their profiles, so today's counts stand; the owner's decision #9 takes SO-4,
// SO-11.5 and SO-13 out of every score by emptying their `scoreIn`.
//
// A step the registry has no rule for — or rules not given at all — keeps its
// place: a report never loses a step because the registry is behind the board
// (lib/step-feed/registry.js). What that place is, is the reader's:
// isScoredIn keeps the step, and a reader with a list of its own asks
// scoredInRuleOf and falls back to that list.
//
// Pure.

/**
 * What the rules say: whether the step's rule names the profile in its
 * `scoreIn` — or null when they say nothing, having no rule for the step (or
 * no rules at all) or a rule with no `scoreIn`.
 *
 * @param {{ steps?: Object<string, { scoreIn?: string[] }> }|null} rules  Resolved rules, whole or trimmed.
 * @param {{ stepKey?: string }} step  A step-feed item.
 * @param {string} profileKey  A ScoringProfile key: 'crmExec', 'pcDesk', 'deptOther' …
 * @returns {boolean|null}
 */
export function scoredInRuleOf(rules, step, profileKey) {
  const steps = rules?.steps;
  const key = step?.stepKey;
  const rule = steps && typeof key === 'string' && key && Object.hasOwn(steps, key) ? steps[key] : null;
  return Array.isArray(rule?.scoreIn) ? rule.scoreIn.includes(profileKey) : null;
}

/**
 * Whether the profile counts the step: the rules' word, else yes — a step the
 * registry has no rule for keeps its place.
 *
 * @param {{ steps?: Object<string, { scoreIn?: string[] }> }|null} rules  Resolved rules, whole or trimmed.
 * @param {{ stepKey?: string }} step  A step-feed item.
 * @param {string} profileKey  A ScoringProfile key: 'crmExec', 'pcDesk', 'deptOther' …
 */
export const isScoredIn = (rules, step, profileKey) => scoredInRuleOf(rules, step, profileKey) ?? true;
