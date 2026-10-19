// VERBATIM COPY of CRM lib/rules/resolve.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/resolve.js
//
// The rule set a report actually runs on: the built-in defaults, what has been
// stored for the org laid over them, and — until the rules editor owns them —
// the values the Settings page still writes to systemSettings/globalCutoffDates:
// the cutoff dates, the Scoreboard's reward rule and the management approval
// hours. With nothing stored, the result is exactly what the reports do today.
//
// A Settings value fills a field only when the rules editor has not set that
// field itself; the editor is the newer source and wins. A Settings value that
// cannot be read is ignored with a warning, never allowed to break the rule set.
//
// Like lib/org-config.js it never half-applies. A merged rule set that does not
// validate is dropped whole and the defaults run instead, with a warning that
// says why: one step's owner from the stored copy and its calendar from the
// defaults would score people on a rule nobody wrote.
//
// Pure. The result is deep-frozen, because one resolved rule set is shared by
// every request that loads it within the cache window.

import { PLAN_ADD_MAX, PLAN_UNIT, RULES_KEYS, STEP_KEY_SEPARATOR } from './contract.js';
import { validateRules } from './schema.js';
import { isIsoDay } from './time.js';
import { cloneData, deepFreeze, isPlainObject, ownValue } from './util.js';

/**
 * Which Settings date fills each rules cutoff, by cutoff key. The Design
 * Approval board reads the CRM FMS date (app/(app)/design/approval/page.jsx
 * boardCutoffLine), so its own `designApproval` cutoff (lib/rules/defaults.js)
 * takes that date too — under the owner's decisions as well, which move that
 * cutoff to IST midnight and leave its date to Settings.
 */
export const LEGACY_CUTOFF_SOURCE = Object.freeze({
  crmFms: 'crmFms',
  soFms: 'soFms',
  designReq: 'designReq',
  designApproval: 'crmFms',
});

/** systemSettings/globalCutoffDates date fields: the Settings page's three cutoff inputs, named once above. */
export const LEGACY_CUTOFF_KEYS = Object.freeze([...new Set(Object.values(LEGACY_CUTOFF_SOURCE))]);

/**
 * The profiles the Scoreboard's reward rule (Settings rewardTopN / rewardMinScore)
 * applies to today: its CRM, Process Coordinator and Designer sections
 * (app/(app)/scoreboard/page.jsx:503,514,541 isRewarded). Sales has its own
 * rule and purchase carries no reward.
 */
export const LEGACY_REWARD_PROFILES = Object.freeze(['crmExec', 'pcDesk', 'designer']);

/**
 * Settings managementPlannedHours is the Design Approval management step's
 * plan: its anchor plus that many working hours (lib/designApprovalClock.js:147-148).
 */
export const LEGACY_MANAGEMENT_PLAN_STEP = ['designApproval', 'DA-S3'].join(STEP_KEY_SEPARATOR);

const MINUTES_PER_HOUR = 60;
const SETTINGS_DOC = 'systemSettings/globalCutoffDates';

const CONTRACT_KEYS = new Set(RULES_KEYS);

/** Bookkeeping a stored rules document may carry beside the rules themselves. */
const STORED_BOOKKEEPING_KEYS = new Set(['updatedAt', 'updatedBy', 'reason']);

/**
 * Fields replaced whole rather than merged field by field, per section. A
 * condition merged into another is a third condition nobody wrote; an owner
 * { kind: 'piOwner' } merged over { kind: 'duty', duty } keeps a stray duty;
 * `plan` is either a word or an object; formula params belong together.
 */
const REPLACED_WHOLE = new Map([
  ['steps', new Set(['requiredWhen', 'owner', 'plan'])],
  ['profiles', new Set(['cohort', 'params'])],
]);

/** How many validation errors a warning spells out before counting the rest. */
const ERRORS_IN_WARNING = 5;

const isReplacedWhole = (path) => path.length === 3 && Boolean(REPLACED_WHOLE.get(path[0])?.has(path[2]));

/**
 * `patch` laid over `base`: records merge key by key, everything else —
 * arrays included — is replaced. Steps and profiles therefore patch by key.
 * Exported so the rules editor's merge can be proven to be this one.
 */
export function mergeAt(base, patch, path) {
  if (patch === undefined) return cloneData(base);
  if (isReplacedWhole(path) || !isPlainObject(base) || !isPlainObject(patch)) return cloneData(patch);
  const keys = new Set([...Object.keys(base), ...Object.keys(patch)]);
  return Object.fromEntries([...keys].map((key) => [key, mergeAt(base[key], patch[key], [...path, key])]));
}

function describeErrors(errors) {
  const shown = errors.slice(0, ERRORS_IN_WARNING).map(({ path, message }) => (path ? `${path}: ${message}` : message));
  const more = errors.length - shown.length;
  return more > 0 ? `${shown.join('; ')}; and ${more} more` : shown.join('; ');
}

/** The contract fields of a stored document; anything else is noted and left out. */
function storedRulesOf(stored, warnings) {
  if (stored === null || stored === undefined) return {};
  if (!isPlainObject(stored)) {
    warnings.push('the stored rules are not an object and were ignored');
    return {};
  }
  const unread = Object.keys(stored).filter((key) => !CONTRACT_KEYS.has(key) && !STORED_BOOKKEEPING_KEYS.has(key));
  if (unread.length > 0) warnings.push(`the stored rules carry fields the engine does not read, ignored: ${unread.join(', ')}`);
  return Object.fromEntries(Object.entries(stored).filter(([key]) => CONTRACT_KEYS.has(key)));
}

/* ----------------------- the Settings page's values ----------------------- */

/** Has the rules editor set this field itself? Then Settings does not touch it. */
const isStoredField = (storedRules, section, key, field) =>
  isPlainObject(storedRules[section]) && isPlainObject(storedRules[section][key]) && storedRules[section][key][field] !== undefined;

const ignoredWarning = (field, value, problem) => `${SETTINGS_DOC}.${field} "${value}" is ${problem} and was ignored`;

/**
 * The Settings dates that can be used, by field. '' is a real value there —
 * "no cutoff" — and is kept as one; anything that is not a day is left out,
 * with one warning per field however many cutoffs read it.
 */
function legacyDates(legacySettings, warnings) {
  const dates = {};
  new Set(Object.values(LEGACY_CUTOFF_SOURCE)).forEach((field) => {
    const value = legacySettings[field];
    if (typeof value !== 'string') return;
    const date = value.trim();
    if (date === '' || isIsoDay(date)) dates[field] = date;
    else warnings.push(ignoredWarning(field, value, 'not a YYYY-MM-DD date'));
  });
  return dates;
}

/** The Settings page's cutoff dates, for every cutoff the rules editor has not dated itself. */
function withLegacyCutoffs(rules, storedRules, legacySettings, warnings) {
  if (!isPlainObject(rules.cutoffs)) return rules;
  const dates = legacyDates(legacySettings, warnings);
  const cutoffs = { ...rules.cutoffs };
  Object.entries(LEGACY_CUTOFF_SOURCE).forEach(([key, field]) => {
    if (!isPlainObject(cutoffs[key]) || dates[field] === undefined || isStoredField(storedRules, 'cutoffs', key, 'date')) return;
    cutoffs[key] = { ...cutoffs[key], date: dates[field] };
  });
  return { ...rules, cutoffs };
}

/**
 * A Settings number as the app reads it, Number(value) (store/systemSettingsSlice.js:47-50):
 * null when the field is not set, NaN when it is set to something that is not a number.
 */
function legacyNumber(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : Number(value);
  return typeof value === 'number' ? value : NaN;
}

/** The parts of the reward rule Settings has set and the schema would accept. */
function legacyReward(legacySettings, warnings) {
  const reward = {};
  const topN = legacyNumber(legacySettings.rewardTopN);
  if (topN !== null) {
    if (Number.isInteger(topN) && topN >= 1) reward.topN = topN;
    else warnings.push(ignoredWarning('rewardTopN', legacySettings.rewardTopN, 'not a whole number, 1 or more'));
  }
  const minScore = legacyNumber(legacySettings.rewardMinScore);
  if (minScore !== null) {
    if (Number.isFinite(minScore)) reward.minScore = minScore;
    else warnings.push(ignoredWarning('rewardMinScore', legacySettings.rewardMinScore, 'not a number'));
  }
  return reward;
}

/**
 * The Scoreboard's reward rule over the profiles it rewards today, for every
 * profile whose reward the rules editor has not set itself. A profile with no
 * reward (null) is left without one: Settings adjusts the rule, it does not add it.
 */
function withLegacyReward(rules, storedRules, legacySettings, warnings) {
  if (!isPlainObject(rules.profiles)) return rules;
  const reward = legacyReward(legacySettings, warnings);
  if (Object.keys(reward).length === 0) return rules;
  const profiles = { ...rules.profiles };
  LEGACY_REWARD_PROFILES.forEach((key) => {
    const profile = profiles[key];
    if (!isPlainObject(profile) || !isPlainObject(profile.reward) || isStoredField(storedRules, 'profiles', key, 'reward')) return;
    profiles[key] = { ...profile, reward: { ...profile.reward, ...reward } };
  });
  return { ...rules, profiles };
}

/**
 * Settings managementPlannedHours as the management step's plan length, unless
 * the rules editor has set that plan itself. The app falls back to its default
 * for a missing or zero value (`Number(hours ?? 1) || 1`, hooks/useMisSteps.js:387),
 * and the step's default plan already carries that hour, so only a positive
 * number is laid over it.
 */
function withLegacyManagementPlan(rules, storedRules, legacySettings, warnings) {
  const hours = legacyNumber(legacySettings.managementPlannedHours);
  if (hours === null) return rules;
  const key = LEGACY_MANAGEMENT_PLAN_STEP;
  const step = ownValue(rules.steps, key);
  const plan = isPlainObject(step) ? step.plan : null;
  if (!isPlainObject(plan) || plan.add?.unit !== PLAN_UNIT.WORKING_MINUTES || isStoredField(storedRules, 'steps', key, 'plan')) return rules;
  if (!(Number.isFinite(hours) && hours > 0)) {
    warnings.push(ignoredWarning('managementPlannedHours', legacySettings.managementPlannedHours, 'not a number of hours above 0'));
    return rules;
  }
  // The Settings page clamps only the floor; a value past the schema's cap
  // would make the merged set and the fallback both invalid.
  const n = hours * MINUTES_PER_HOUR;
  if (n > PLAN_ADD_MAX[PLAN_UNIT.WORKING_MINUTES]) {
    warnings.push(ignoredWarning('managementPlannedHours', legacySettings.managementPlannedHours, 'more than a year of working time'));
    return rules;
  }
  const add = { ...plan.add, n };
  return { ...rules, steps: { ...rules.steps, [key]: { ...step, plan: { ...plan, add } } } };
}

/** Every Settings value laid over the rules, in one pass. */
function withLegacySettings(rules, storedRules, legacySettings, warnings) {
  if (!isPlainObject(rules) || !isPlainObject(legacySettings)) return rules;
  const withCutoffs = withLegacyCutoffs(rules, storedRules, legacySettings, warnings);
  const withReward = withLegacyReward(withCutoffs, storedRules, legacySettings, warnings);
  return withLegacyManagementPlan(withReward, storedRules, legacySettings, warnings);
}

const forOrg = (rules, orgId) => (orgId && isPlainObject(rules) ? { ...rules, orgId } : rules);

/**
 * @param {object} input
 * @param {import('./contract.js').Rules} input.defaults  The built-in rules (lib/rules/defaults.js).
 * @param {object|null} [input.stored]  orgConfig/{orgId}/rules/current: a partial rule set.
 * @param {object|null} [input.legacySettings]  systemSettings/globalCutoffDates: the cutoff
 *   dates, rewardTopN / rewardMinScore and managementPlannedHours.
 * @param {string|null} [input.orgId]  The org being resolved; wins over any orgId in the
 *   defaults or the stored copy, so a fallback never answers for the wrong company.
 * @returns {{ rules: import('./contract.js').Rules, warnings: string[] }}  Never throws.
 */
export function resolveRules({ defaults, stored = null, legacySettings = null, orgId = null } = {}) {
  const warnings = [];
  if (!isPlainObject(defaults)) return { rules: deepFreeze(cloneData(defaults)), warnings: ['no default rules were given'] };

  const storedRules = storedRulesOf(stored, warnings);
  if (orgId && storedRules.orgId !== undefined && storedRules.orgId !== orgId) {
    warnings.push(`the stored rules name org "${storedRules.orgId}" but were read for "${orgId}"; "${orgId}" is used`);
  }
  const merged = forOrg(withLegacySettings(mergeAt(defaults, storedRules, []), storedRules, legacySettings, warnings), orgId);
  const verdict = validateRules(merged);
  if (verdict.ok) return { rules: deepFreeze(merged), warnings };

  const fallback = forOrg(withLegacySettings(cloneData(defaults), {}, legacySettings, []), orgId);
  const fallbackVerdict = validateRules(fallback);
  warnings.push(fallbackVerdict.ok
    ? `the stored rules were not used, the defaults run instead — ${describeErrors(verdict.errors)}`
    : `the default rules do not validate — ${describeErrors(fallbackVerdict.errors)}`);
  return { rules: deepFreeze(fallback), warnings };
}

/**
 * A named decision overlay laid over a rule set — the owner's decisions as one
 * patch, so a report can show "today" and "as decided" side by side. An overlay
 * that would leave the rules invalid is not applied.
 *
 * @param {import('./contract.js').Rules} rules
 * @param {{ name: string, patch: object }} overlay  `patch` merges as stored rules do.
 * @returns {{ rules: import('./contract.js').Rules, warnings: string[] }}
 */
export function applyOverlay(rules, overlay) {
  const name = typeof overlay?.name === 'string' && overlay.name.trim() ? overlay.name : '(unnamed)';
  if (!isPlainObject(overlay) || !isPlainObject(overlay.patch)) {
    return { rules, warnings: [`overlay "${name}" has no patch and was not applied`] };
  }
  const merged = mergeAt(rules, overlay.patch, []);
  const verdict = validateRules(merged);
  if (!verdict.ok) return { rules, warnings: [`overlay "${name}" was not applied — ${describeErrors(verdict.errors)}`] };
  return { rules: deepFreeze(merged), warnings: [] };
}
