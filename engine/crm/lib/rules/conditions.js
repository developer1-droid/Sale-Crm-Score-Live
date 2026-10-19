// VERBATIM COPY of CRM lib/rules/conditions.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/conditions.js
//
// When a rule applies, written as data: a step's `requiredWhen` and a scoring
// profile's `cohort`.
//
// A condition is a small tree — { all: [...] }, { any: [...] }, { not: {...} } or
// a leaf { fact, op, value } — read against facts the report already has for
// the row. The facts each flow offers are listed, with their types, in
// FACT_CATALOGUE. validateCondition refuses a fact a flow does not have, and an
// operator that means nothing for the fact's type: a misspelt fact would
// otherwise read as "missing" on every row and quietly switch a step off.
//
// Text compares trimmed and case-blind, as the boards always have
// (`lower(paymentTerms).includes('advance')`): the sheets hold 'ADVANCE',
// 'Advance' and 'advance' side by side. Facts arrive typed — a boolean fact is
// true or false, not the sheet's 'Yes' — and the caller does that reading.
//
// Pure, so the rules editor can check a condition in the browser before it is
// saved and the server reads it the same way.

import { istMidnightMs, toEpochMs } from './time.js';
import { childPath, deepFreeze, isPlainObject, unknownKeyErrors } from './util.js';

export const FACT_TYPE = Object.freeze({ STRING: 'string', BOOLEAN: 'boolean', DATE: 'date', LIST: 'list' });

export const CONDITION_OPS = Object.freeze(['eq', 'neq', 'in', 'includes', 'exists', 'before', 'after']);

const { STRING, BOOLEAN, DATE, LIST } = FACT_TYPE;

/** Which operators make sense for each type of fact; the rules editor offers these alone. */
export const OPS_BY_TYPE = deepFreeze({
  [STRING]: ['eq', 'neq', 'in', 'includes', 'exists'],
  [BOOLEAN]: ['eq', 'neq', 'exists'],
  [DATE]: ['before', 'after', 'exists'],
  [LIST]: ['includes', 'exists'],
});

/** Every step has an owner: `role` is that person's lib/team-roles.js ROLE bucket. */
const OWNER_FACTS = { role: STRING };

const PI_FACTS = {
  ...OWNER_FACTS,
  paymentTerms: STRING, // as the PI states them: '30% ADVANCE, 70% DP'
  paymentFamily: STRING, // lib/payment-terms-family.js PAYMENT_FAMILY: advance, dp, da, cad_lc, other
  deposits: LIST, // the deposits the PI charges: 'cylinder', 'security' — the board's Step-2 cells, else the PI form
  piFormDeposits: LIST, // the same, the PI form's answers winning over the board's cells (decision 14)
  country: STRING, // destination
  piStatus: STRING, // approved, unapproved, rejected …
  piApprovedAt: DATE,
};

const DESIGN_FACTS = {
  ...OWNER_FACTS,
  designCategory: STRING,
  packagingType: STRING, // pouch, bopp …
  requestType: STRING, // 'PI Request', 'Help Ticket', 'Exhibition'
  isHelpTicket: BOOLEAN,
  isExhibitionPoster: BOOLEAN,
  buyerProvided: BOOLEAN, // the buyer supplied the artwork
  // Sent by HR-ERP: it opened a cylinder job for this design. HR-ERP alone knows
  // (hr-erp lib/cylinder/eligibility.ts:50-61, design-source.ts:97-106): pouch
  // or BOPP packaging on a private-label-new or our-brand design, buyer
  // approved, linked to a PI item, with an approved packaging PO for a cylinder.
  cylinderJob: BOOLEAN,
  revisionFault: STRING, // lib/design-fault.js: buyer, designer, crm
  piStatus: STRING,
  piApprovedAt: DATE,
  country: STRING,
};

const TICKET_FACTS = { ...OWNER_FACTS, ticketType: STRING, priority: STRING, department: STRING, isHelpTicket: BOOLEAN };

/** The facts each flow's rows carry, by name, with their types. Keyed by contract FLOWS. */
export const FACT_CATALOGUE = deepFreeze({
  crmFms: { ...PI_FACTS },
  soFms: { ...PI_FACTS },
  designApproval: { ...DESIGN_FACTS },
  designRequest: { ...DESIGN_FACTS },
  ticket: { ...TICKET_FACTS },
  hrerpDesign: { ...DESIGN_FACTS },
  hrerpCylinder: { ...DESIGN_FACTS },
  hrerpPurchase: { ...OWNER_FACTS },
});

/** What a scoring profile's cohort can be decided on: the person scored. */
export const COHORT_FACT_CATALOGUE = deepFreeze({ role: STRING, email: STRING, duties: LIST });

/* ------------------------------- evaluation ------------------------------- */

const normalized = (text) => text.trim().toLowerCase();

function equals(fact, value) {
  if (typeof fact === 'string' && typeof value === 'string') return normalized(fact) === normalized(value);
  return fact === value;
}

function isPresent(fact) {
  if (fact === null || fact === undefined) return false;
  if (typeof fact === 'string') return fact.trim() !== '';
  if (Array.isArray(fact)) return fact.length > 0;
  return true;
}

function contains(fact, value) {
  if (typeof fact === 'string' && typeof value === 'string') return normalized(fact).includes(normalized(value));
  if (Array.isArray(fact)) return fact.some((item) => equals(item, value));
  return false;
}

/** A condition's date: a bare 'YYYY-MM-DD' is IST midnight, as cutoff days are. */
const conditionDateMs = (value) => istMidnightMs(value) ?? toEpochMs(value);

function comparesInTime(fact, value, isBefore) {
  const factMs = toEpochMs(fact);
  const valueMs = conditionDateMs(value);
  if (factMs === null || valueMs === null) return false;
  return isBefore ? factMs < valueMs : factMs > valueMs;
}

// neq is exactly "not eq", so a missing fact is unequal to everything.
const LEAF_TESTS = Object.freeze({
  eq: (fact, value) => equals(fact, value),
  neq: (fact, value) => !equals(fact, value),
  in: (fact, value) => Array.isArray(value) && value.some((option) => equals(fact, option)),
  includes: (fact, value) => contains(fact, value),
  exists: (fact) => isPresent(fact),
  before: (fact, value) => comparesInTime(fact, value, true),
  after: (fact, value) => comparesInTime(fact, value, false),
});

/**
 * Does `cond` hold for these facts? No condition (null) always holds — a step
 * with no `requiredWhen` is always required, a profile with no `cohort` takes
 * everyone.
 *
 * @param {import('./contract.js').Condition|null|undefined} cond  A validated condition.
 * @param {Object<string, any>} facts
 * @returns {boolean}
 * @throws {TypeError} for a condition validateCondition would refuse.
 */
export function evaluate(cond, facts = {}) {
  if (cond === null || cond === undefined) return true;
  if (!isPlainObject(cond)) throw new TypeError('A condition must be an object');
  if (Array.isArray(cond.all)) return cond.all.every((child) => evaluate(child, facts));
  if (Array.isArray(cond.any)) return cond.any.some((child) => evaluate(child, facts));
  if (Object.hasOwn(cond, 'not')) return !evaluate(cond.not, facts);
  if (!Object.hasOwn(LEAF_TESTS, cond.op)) throw new TypeError(`Unknown condition operator "${cond.op}"`);
  const fact = isPlainObject(facts) && Object.hasOwn(facts, cond.fact) ? facts[cond.fact] : undefined;
  return LEAF_TESTS[cond.op](fact, cond.value);
}

/* ------------------------------- validation ------------------------------- */

const SHAPE_KEYS = ['all', 'any', 'not', 'fact'];
const LEAF_KEYS = ['fact', 'op', 'value'];

const VALUE_CHECKS = Object.freeze({
  [STRING]: (value) => typeof value === 'string',
  [BOOLEAN]: (value) => typeof value === 'boolean',
  [LIST]: (value) => typeof value === 'string',
});

/** What is wrong with a leaf's value for its operator, or null. */
function valueProblem({ op, value }, type) {
  if (op === 'exists') return value === undefined ? null : 'exists takes no value';
  if (op === 'before' || op === 'after') {
    return conditionDateMs(value) === null
      ? `${op} needs a date: 'YYYY-MM-DD' (IST midnight) or an ISO date-time with its zone`
      : null;
  }
  const isValueValid = VALUE_CHECKS[type];
  if (op === 'in') {
    if (!Array.isArray(value) || value.length === 0) return 'in needs a list of at least one value';
    return value.every(isValueValid) ? null : `every value in the list must be a ${type}`;
  }
  if (op === 'includes' && typeof value === 'string' && value.trim() === '') return 'includes needs something to look for';
  return isValueValid(value) ? null : `${op} needs a ${type === LIST ? STRING : type} value`;
}

function leafErrors(cond, catalogue, path) {
  const errors = unknownKeyErrors(cond, LEAF_KEYS, path);
  const type = isPlainObject(catalogue) && Object.hasOwn(catalogue, cond.fact) ? catalogue[cond.fact] : null;
  if (!type) {
    const known = isPlainObject(catalogue) ? Object.keys(catalogue).join(', ') : 'none';
    errors.push({ path: childPath(path, 'fact'), message: `unknown fact "${cond.fact}"; this flow has: ${known}` });
  }
  const opPath = childPath(path, 'op');
  if (!CONDITION_OPS.includes(cond.op)) {
    return [...errors, { path: opPath, message: `unknown operator "${cond.op}"; use one of: ${CONDITION_OPS.join(', ')}` }];
  }
  if (!type) return errors;
  if (!OPS_BY_TYPE[type].includes(cond.op)) {
    return [...errors, { path: opPath, message: `"${cond.op}" does not apply to the ${type} fact "${cond.fact}"; use one of: ${OPS_BY_TYPE[type].join(', ')}` }];
  }
  const problem = valueProblem(cond, type);
  return problem ? [...errors, { path: childPath(path, 'value'), message: problem }] : errors;
}

function branchErrors(cond, kind, catalogue, path) {
  const errors = unknownKeyErrors(cond, [kind], path);
  const listPath = childPath(path, kind);
  const children = cond[kind];
  if (!Array.isArray(children) || children.length === 0) {
    return [...errors, { path: listPath, message: `${kind} must list at least one condition` }];
  }
  children.forEach((child, index) => errors.push(...validateCondition(child, catalogue, childPath(listPath, index))));
  return errors;
}

/**
 * Everything wrong with a condition, as `{ path, message }`; empty when it is
 * sound.
 *
 * @param {any} cond
 * @param {Object<string, string>} factCatalogue  FACT_CATALOGUE[flow] or COHORT_FACT_CATALOGUE.
 * @param {string} [path]  Where the condition sits, to prefix each error's path.
 */
export function validateCondition(cond, factCatalogue, path = '') {
  if (!isPlainObject(cond)) return [{ path, message: 'a condition must be an object' }];
  const shape = SHAPE_KEYS.filter((key) => Object.hasOwn(cond, key));
  if (shape.length !== 1) {
    return [{ path, message: 'a condition is exactly one of { all }, { any }, { not } or { fact, op, value }' }];
  }
  const [kind] = shape;
  if (kind === 'fact') return leafErrors(cond, factCatalogue, path);
  if (kind === 'not') {
    return [...unknownKeyErrors(cond, ['not'], path), ...validateCondition(cond.not, factCatalogue, childPath(path, 'not'))];
  }
  return branchErrors(cond, kind, factCatalogue, path);
}
