// VERBATIM COPY of CRM lib/rules-public.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules-public.js
//
// The resolved report rules as the browser may read them: what a report page
// needs to score, label and explain, and nothing a reader has no business
// with. GET /api/rules/resolved (any signed-in holder of a report permission)
// answers with this shape; GET /api/rules (rules.manage) answers with the whole
// registry, its defaults, its overlay and its history.
//
// Trimmed on purpose. A step's owner rule, plan, conditions, exclusions and
// `source` line are the editor's concern; a designer's HR-ERP user id and
// aliases are matching details; a stored copy's bookkeeping (who saved it and
// why) never gets this far. What stays is what lib/crm-mis reads (scoreIn,
// graceMin, flow, code, label) and what a report's "how the score is
// calculated" panel shows (profiles, calendars, cutoffs, duties).
//
// One exception: the steps a page decides on itself. The Designer MIS turns
// hr-erp's D2 / D3 / C1 rows into scored steps in the browser
// (lib/designer-mis/steps.js): `requiredWhen` decides C1 or D3 for a
// hand-over, `exclusions` what is left out or excused, and its panel shows
// `plan`. Without them it scores nothing rather than count a hand-over twice,
// so those steps keep the three fields (DECIDED_IN_BROWSER_FLOWS).
//
// Firebase-free; lib/__tests__/rules-public.test.js. publicRules is pure;
// publicRulesOf holds what it shaped for as long as the loader holds the rules.

import { DESIGNER_FLOW_OF } from './designer-mis/types.js';
import { PERMISSIONS } from './roles.js';
import { publicDutiesOf, publicPersonOf } from './rules/duties.js';
import { cloneData, isPlainObject } from './rules/util.js';

/**
 * The report permissions any one of which opens the resolved rules, in the
 * order a route asks about them. A super admin holds every one.
 */
export const PUBLIC_RULES_PERMISSIONS = Object.freeze([
  PERMISSIONS.VIEW_PC_REPORT,
  PERMISSIONS.VIEW_MIS_REPORT,
  PERMISSIONS.VIEW_DEPT_ANALYTICS,
  PERMISSIONS.VIEW_SCOREBOARD,
  PERMISSIONS.VIEW_ADVANCE_PENDING,
  PERMISSIONS.VIEW_DESIGNER_MIS,
]);

/** The fields of a step rule a report reads. */
export const PUBLIC_STEP_FIELDS = Object.freeze([
  'flow', 'code', 'label', 'authority', 'grain', 'graceMin', 'chase', 'scoreIn', 'cutoffKey', 'effectiveFrom',
]);

/** The flows whose steps a page converts in the browser: the Designer MIS's hr-erp design and cylinder steps. */
export const DECIDED_IN_BROWSER_FLOWS = Object.freeze(Object.values(DESIGNER_FLOW_OF));

/** What such a step keeps besides PUBLIC_STEP_FIELDS: the fields that decide which of its rows count, and its plan. */
export const DECIDING_STEP_FIELDS = Object.freeze(['requiredWhen', 'exclusions', 'plan']);

const BROWSER_DECIDED_STEP_FIELDS = Object.freeze([...PUBLIC_STEP_FIELDS, ...DECIDING_STEP_FIELDS]);

const entriesOf = (map) => (isPlainObject(map) ? Object.entries(map) : []);
const listOf = (value) => (Array.isArray(value) ? value : []);

const pick = (record, fields) => Object.fromEntries(fields.map((field) => [field, cloneData(record?.[field])]));

/** A step rule as the browser gets it: the public fields, and the deciding ones for a step it converts itself. */
const publicStepOf = (step) => pick(step, DECIDED_IN_BROWSER_FLOWS.includes(step?.flow) ? BROWSER_DECIDED_STEP_FIELDS : PUBLIC_STEP_FIELDS);

/**
 * @param {import('./rules/contract.js').Rules} rules  The resolved rules (lib/rules/load.server.js loadRules).
 * @param {string[]} [warnings]  The loader's notes, passed on as they are.
 * @returns {{
 *   version: number|null, orgId: string, warnings: string[],
 *   calendars: object, cutoffs: object,
 *   steps: Object<string, object>, profiles: Object<string, object>,
 *   duties: Object<string, { label: string, people: { email: string, name: string }[] }>,
 *   designers: { email: string, name: string }[],
 * }}
 */
export function publicRules(rules, warnings = []) {
  return {
    version: Number.isInteger(rules?.version) ? rules.version : null,
    orgId: String(rules?.orgId ?? ''),
    warnings: listOf(warnings).map(String),
    calendars: cloneData(isPlainObject(rules?.calendars) ? rules.calendars : {}),
    cutoffs: cloneData(isPlainObject(rules?.cutoffs) ? rules.cutoffs : {}),
    steps: Object.fromEntries(entriesOf(rules?.steps).map(([key, step]) => [key, publicStepOf(step)])),
    profiles: cloneData(isPlainObject(rules?.profiles) ? rules.profiles : {}),
    duties: publicDutiesOf(rules),
    designers: listOf(rules?.designers).map(publicPersonOf),
  };
}

/**
 * One payload per loadRules result, shaped once. The loader re-reads an org's
 * rules once a minute (RULES_TTL_MS, the step feed's own hold) and hands back
 * the very same `{ rules, warnings }` object while what it read is unchanged,
 * so a payload is served for as long as its rules stand, and an edit reaches
 * this route's readers within the minute, as it reaches the feed. Keyed
 * weakly: a result the loader has let go of takes its payload with it.
 */
const heldPayloads = new WeakMap();

/**
 * @param {{ rules: import('./rules/contract.js').Rules, warnings?: string[] }} result  What loadRules resolved with.
 * @returns {ReturnType<typeof publicRules>}  Shared by every reader of the same result: serialise it, never change it.
 */
export function publicRulesOf(result) {
  if (!result || typeof result !== 'object') return publicRules(null);
  const held = heldPayloads.get(result);
  if (held) return held;
  const payload = publicRules(result.rules, result.warnings);
  heldPayloads.set(result, payload);
  return payload;
}
