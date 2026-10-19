// VERBATIM COPY of CRM lib/rules/schema.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/schema.js
//
// Is a rule set whole and consistent? validateRules answers with every problem
// at once, each with the path of the field it is about, so the rules editor can
// show it beside that field and resolveRules (lib/rules/resolve.js) can refuse
// to run a report on half a rule set.
//
// Strict on purpose: a field the contract (lib/rules/contract.js) does not name
// is an error, not ignored. A stored edit that spelt `graceMins` would otherwise
// change nothing while looking saved. Every contract field is required — but a
// step's `doneFrom`, which only a step finished from another page carries; the
// nullable ones say null.

import {
  AUTHORITY_SOURCES, BOARD_BYPASS, CARRY_OVER, CUTOFF_BASIS, CUTOFF_KEYS, DESIGNER_KEYS, DUTY_KEYS, EARLY_FINISH,
  FLOWS, FORMULAS, GRADE_KEYS, GRAINS, OUTCOME_KEYS, OWNER_KEYS, OWNER_KINDS, OWNER_KIND_DUTY, PERIODS, PERSON_KEYS,
  PLAN_ADD_KEYS, PLAN_ADD_MAX, PLAN_AUTHORITY, PLAN_KEYS, PLAN_UNITS, PROFILE_KEYS, REWARD_KEYS, RULES_KEYS, STEP_KEYS,
  DONE_FROM_STEP,
} from './contract.js';
import { calendarProfileErrors } from './calendar.js';
import { COHORT_FACT_CATALOGUE, FACT_CATALOGUE, validateCondition } from './conditions.js';
import { isIsoDay } from './time.js';
import { childPath, isPlainObject, joinPath, ownValue, unknownKeyErrors } from './util.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUTHORITY = new RegExp(`^(${AUTHORITY_SOURCES.join('|')}):[A-Za-z0-9]+$`);
/** A Firestore document id: orgConfig/{orgId}. */
const DOCUMENT_ID = /^[^/\s]+$/;

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isBoolean = (value) => typeof value === 'boolean';
const isEmail = (value) => typeof value === 'string' && EMAIL.test(value.trim());
const isMinutes = (value) => Number.isFinite(value) && value >= 0;
const oneOf = (allowed) => (value) => allowed.includes(value);
const listed = (allowed) => allowed.join(', ');
const hasEntry = (map, key) => ownValue(map, key) !== undefined;
const error = (path, message) => ({ path, message });

/**
 * Table-driven checks for simple fields: [key, isValid, message]. A message may
 * be a function of the value, to name what was wrong.
 */
function fieldErrors(record, path, checks) {
  return checks
    .filter(([key, isValid]) => !isValid(record[key]))
    .map(([key, , message]) => error(childPath(path, key), typeof message === 'function' ? message(record[key]) : message));
}

/** A list of distinct, non-empty strings, each passing `isAllowed`. */
function nameListErrors(list, path, { isAllowed = () => true, notAllowed = '' } = {}) {
  if (!Array.isArray(list)) return [error(path, 'must be a list')];
  const seen = new Set();
  return list.flatMap((name, index) => {
    const itemPath = childPath(path, index);
    if (!isText(name)) return [error(itemPath, 'must be a name')];
    if (seen.has(name)) return [error(itemPath, `"${name}" is listed twice`)];
    seen.add(name);
    return isAllowed(name) ? [] : [error(itemPath, `"${name}" ${notAllowed}`)];
  });
}

/** People (duty members, designers) may each appear once, whatever the case of their email. */
function duplicateEmailErrors(people, path) {
  const seen = new Set();
  return people.flatMap((person, index) => {
    const email = isEmail(person?.email) ? person.email.trim().toLowerCase() : null;
    if (!email) return [];
    if (seen.has(email)) return [error(childPath(childPath(path, index), 'email'), `${email} is listed twice`)];
    seen.add(email);
    return [];
  });
}

/* ------------------------------ map sections ------------------------------ */

function calendarErrors(calendar, _key, path) {
  return calendarProfileErrors(calendar).map((problem) => error(joinPath(path, problem.path), problem.message));
}

function cutoffErrors(cutoff, _key, path) {
  if (!isPlainObject(cutoff)) return [error(path, 'a cutoff must be { date, basis, atIstMidnight }')];
  return [
    ...unknownKeyErrors(cutoff, CUTOFF_KEYS, path),
    ...fieldErrors(cutoff, path, [
      ['date', (value) => value === '' || isIsoDay(value), "date must be a real 'YYYY-MM-DD' day, or '' for no cutoff"],
      ['basis', oneOf(Object.values(CUTOFF_BASIS)), `basis must be one of: ${listed(Object.values(CUTOFF_BASIS))}`],
      ['atIstMidnight', isBoolean, 'atIstMidnight must be true or false'],
    ]),
  ];
}

function boardBypassErrors(mode, flow, path) {
  if (!FLOWS.includes(flow)) return [error(path, `boardBypass is keyed by flow, one of: ${listed(FLOWS)}`)];
  const modes = Object.values(BOARD_BYPASS);
  return modes.includes(mode) ? [] : [error(path, `must be one of: ${listed(modes)}`)];
}

function personErrors(person, path) {
  if (!isPlainObject(person)) return [error(path, 'a person must be { email, name }')];
  return [
    ...unknownKeyErrors(person, PERSON_KEYS, path),
    ...fieldErrors(person, path, [
      ['email', isEmail, 'email must be an email address'],
      ['name', isText, 'name must be a name'],
    ]),
  ];
}

function dutyErrors(duty, _key, path) {
  if (!isPlainObject(duty)) return [error(path, 'a duty must be { label, people }')];
  const errors = [...unknownKeyErrors(duty, DUTY_KEYS, path), ...fieldErrors(duty, path, [['label', isText, 'label must be text']])];
  const peoplePath = childPath(path, 'people');
  if (!Array.isArray(duty.people)) return [...errors, error(peoplePath, 'people must be a list')];
  return [
    ...errors,
    ...duty.people.flatMap((person, index) => personErrors(person, childPath(peoplePath, index))),
    ...duplicateEmailErrors(duty.people, peoplePath),
  ];
}

function outcomeErrors(outcome, path) {
  if (!isPlainObject(outcome)) return [error(path, 'outcome must be { carryOver, earlyFinish, freezeOnClose }')];
  return [
    ...unknownKeyErrors(outcome, OUTCOME_KEYS, path),
    ...fieldErrors(outcome, path, [
      ['carryOver', oneOf(CARRY_OVER), `carryOver must be one of: ${listed(CARRY_OVER)}`],
      ['earlyFinish', oneOf(EARLY_FINISH), `earlyFinish must be one of: ${listed(EARLY_FINISH)}`],
      ['freezeOnClose', isBoolean, 'freezeOnClose must be true or false'],
    ]),
  ];
}

function rewardErrors(reward, path) {
  if (reward === null) return [];
  if (!isPlainObject(reward)) return [error(path, 'reward must be { topN, minScore }, or null for no reward')];
  return [
    ...unknownKeyErrors(reward, REWARD_KEYS, path),
    ...fieldErrors(reward, path, [
      ['topN', (value) => Number.isInteger(value) && value >= 1, 'topN must be a whole number, 1 or more'],
      ['minScore', Number.isFinite, 'minScore must be a number'],
    ]),
  ];
}

/** The last grade may be open-ended — "everything below" — as null or -Infinity. */
const isOpenEnded = (min) => min === null || min === -Infinity;

function gradeMinErrors(grades, index, gradePath) {
  const { min } = grades[index];
  const isLast = index === grades.length - 1;
  const minPath = childPath(gradePath, 'min');
  if (!Number.isFinite(min) && !(isLast && isOpenEnded(min))) {
    return [error(minPath, isLast ? 'min must be a number, or null for everything below' : 'min must be a number')];
  }
  // Highest first, so the first grade a score reaches is the one it earns.
  const previous = grades[index - 1];
  if (index > 0 && Number.isFinite(previous?.min) && Number.isFinite(min) && min >= previous.min) {
    return [error(minPath, 'grades must run from the highest min to the lowest')];
  }
  return [];
}

function gradesErrors(grades, path) {
  if (grades === null) return [];
  if (!Array.isArray(grades) || grades.length === 0) return [error(path, 'grades must list at least one grade, or be null')];
  const names = new Set();
  return grades.flatMap((grade, index) => {
    const gradePath = childPath(path, index);
    if (!isPlainObject(grade)) return [error(gradePath, 'a grade must be { grade, min }')];
    const errors = [
      ...unknownKeyErrors(grade, GRADE_KEYS, gradePath),
      ...fieldErrors(grade, gradePath, [['grade', isText, 'grade must be a name']]),
      ...gradeMinErrors(grades, index, gradePath),
    ];
    if (names.has(grade.grade)) errors.push(error(childPath(gradePath, 'grade'), `"${grade.grade}" is listed twice`));
    names.add(grade.grade);
    return errors;
  });
}

function profileErrors(profile, key, path) {
  if (!isPlainObject(profile)) return [error(path, 'a profile must be an object')];
  return [
    ...unknownKeyErrors(profile, PROFILE_KEYS, path),
    ...fieldErrors(profile, path, [
      ['key', (value) => value === key, `key must repeat the profile's name, "${key}"`],
      ['label', isText, 'label must be text'],
      ['formula', oneOf(FORMULAS), `formula must be one of: ${listed(FORMULAS)}`],
      ['params', isPlainObject, 'params must be an object ({} for none)'],
      ['period', oneOf(PERIODS), `period must be one of: ${listed(PERIODS)}`],
    ]),
    ...outcomeErrors(profile.outcome, childPath(path, 'outcome')),
    ...rewardErrors(profile.reward, childPath(path, 'reward')),
    ...gradesErrors(profile.grades, childPath(path, 'grades')),
    ...(profile.cohort === null ? [] : validateCondition(profile.cohort, COHORT_FACT_CATALOGUE, childPath(path, 'cohort'))),
  ];
}

/* ---------------------------------- steps --------------------------------- */

function ownerErrors(owner, path, rules) {
  if (!isPlainObject(owner)) return [error(path, `owner must be { kind }, or { kind: '${OWNER_KIND_DUTY}', duty }`)];
  const errors = unknownKeyErrors(owner, OWNER_KEYS, path);
  if (!OWNER_KINDS.includes(owner.kind)) errors.push(error(childPath(path, 'kind'), `kind must be one of: ${listed(OWNER_KINDS)}`));
  const dutyPath = childPath(path, 'duty');
  if (owner.kind !== OWNER_KIND_DUTY) {
    if (owner.duty !== undefined) errors.push(error(dutyPath, `only a '${OWNER_KIND_DUTY}' owner names a duty`));
  } else if (!hasEntry(rules.duties, owner.duty)) {
    errors.push(error(dutyPath, `"${owner.duty}" is not one of rules.duties`));
  }
  return errors;
}

function planErrors(plan, path, rules) {
  if (plan === PLAN_AUTHORITY) return [];
  if (!isPlainObject(plan)) return [error(path, `plan must be '${PLAN_AUTHORITY}' or { anchor, add: { n, unit }, calendar }`)];
  const errors = [
    ...unknownKeyErrors(plan, PLAN_KEYS, path),
    ...fieldErrors(plan, path, [
      ['anchor', isText, 'anchor must name the moment the plan counts from'],
      ['calendar', (value) => hasEntry(rules.calendars, value), (value) => `calendar "${value}" is not one of rules.calendars`],
    ]),
  ];
  const addPath = childPath(path, 'add');
  if (!isPlainObject(plan.add)) return [...errors, error(addPath, 'add must be { n, unit }')];
  return [...errors, ...unknownKeyErrors(plan.add, PLAN_ADD_KEYS, addPath), ...planAddErrors(plan.add, addPath)];
}

/** `n` counts forward only, and no further than a year of working time (contract PLAN_ADD_MAX). */
function planAddErrors(add, addPath) {
  const errors = fieldErrors(add, addPath, [
    ['n', isMinutes, 'n must be a number, 0 or more'],
    ['unit', oneOf(PLAN_UNITS), `unit must be one of: ${listed(PLAN_UNITS)}`],
  ]);
  const max = ownValue(PLAN_ADD_MAX, add.unit);
  if (errors.length === 0 && add.n > max) {
    errors.push(error(childPath(addPath, 'n'), `n must be at most ${max} ${add.unit} — a year of working time`));
  }
  return errors;
}

function stepFieldErrors(step, key, path, rules) {
  return fieldErrors(step, path, [
    ['key', (value) => value === key, `key must repeat the step's name, "${key}"`],
    ['flow', oneOf(FLOWS), `flow must be one of: ${listed(FLOWS)}`],
    ['code', isText, 'code must be text'],
    ['label', isText, 'label must be text'],
    ['authority', (value) => typeof value === 'string' && AUTHORITY.test(value), `authority must be '<${AUTHORITY_SOURCES.join('|')}>:<board>'`],
    ['grain', oneOf(GRAINS), `grain must be one of: ${listed(GRAINS)}`],
    ['calendar', (value) => hasEntry(rules.calendars, value), (value) => `calendar "${value}" is not one of rules.calendars`],
    ['graceMin', isMinutes, 'graceMin must be a number of minutes, 0 or more'],
    ['cutoffKey', (value) => value === null || hasEntry(rules.cutoffs, value), (value) => `cutoffKey "${value}" is not one of rules.cutoffs (null for none)`],
    ['chase', isBoolean, 'chase must be true or false'],
    ['effectiveFrom', (value) => value === null || isIsoDay(value), "effectiveFrom must be a real 'YYYY-MM-DD' day, or null"],
    ['source', isText, "source must say where today's behaviour comes from (file:line)"],
  ]);
}

/**
 * The pages a step is also finished from: the one contract field a step may
 * leave out (absent = the board alone), and each page finishes one step only.
 */
function doneFromErrors(places, stepKey, path) {
  if (places === undefined) return [];
  return nameListErrors(places, path, {
    isAllowed: (place) => ownValue(DONE_FROM_STEP, place) === stepKey,
    notAllowed: `cannot finish this step (${listed(Object.entries(DONE_FROM_STEP).map(([place, step]) => `${place} finishes ${step}`))})`,
  });
}

function stepErrors(step, key, path, rules) {
  if (!isPlainObject(step)) return [error(path, 'a step must be an object')];
  const requiredWhenPath = childPath(path, 'requiredWhen');
  return [
    ...unknownKeyErrors(step, STEP_KEYS, path),
    ...stepFieldErrors(step, key, path, rules),
    ...ownerErrors(step.owner, childPath(path, 'owner'), rules),
    ...doneFromErrors(step.doneFrom, key, childPath(path, 'doneFrom')),
    ...nameListErrors(step.scoreIn, childPath(path, 'scoreIn'), {
      isAllowed: (profileKey) => hasEntry(rules.profiles, profileKey),
      notAllowed: 'is not one of rules.profiles',
    }),
    ...nameListErrors(step.exclusions, childPath(path, 'exclusions')),
    ...planErrors(step.plan, childPath(path, 'plan'), rules),
    ...(step.requiredWhen === null ? [] : validateCondition(step.requiredWhen, ownValue(FACT_CATALOGUE, step.flow), requiredWhenPath)),
  ];
}

/* -------------------------------- the whole -------------------------------- */

/** A record keyed by name; every entry checked by `entryErrors(entry, key, path, rules)`. */
function mapErrors(rules, section, entryErrors, { minEntries = 0 } = {}) {
  const map = rules[section];
  if (!isPlainObject(map)) return [error(section, `${section} must be an object keyed by name`)];
  const entries = Object.entries(map);
  if (entries.length < minEntries) return [error(section, `${section} must name at least ${minEntries}`)];
  return entries.flatMap(([key, entry]) => entryErrors(entry, key, childPath(section, key), rules));
}

function designerErrors(designer, path) {
  if (!isPlainObject(designer)) return [error(path, 'a designer must be { email, name, hrerpUserId, aliases }')];
  return [
    ...unknownKeyErrors(designer, DESIGNER_KEYS, path),
    ...fieldErrors(designer, path, [
      ['email', isEmail, 'email must be an email address'],
      ['name', isText, 'name must be a name'],
      ['hrerpUserId', (value) => value === null || isText(value), 'hrerpUserId must be text, or null until it is known'],
    ]),
    ...nameListErrors(designer.aliases, childPath(path, 'aliases')),
  ];
}

/** A name or alias that points at two designers would credit one person's work to the other. */
function sharedNameErrors(designers) {
  const claimedBy = new Map();
  return designers.flatMap((designer, index) => {
    if (!isPlainObject(designer)) return [];
    const names = [designer.name, ...(Array.isArray(designer.aliases) ? designer.aliases : [])]
      .filter(isText)
      .map((name) => name.trim().toLowerCase());
    return [...new Set(names)].flatMap((name) => {
      if (!claimedBy.has(name)) {
        claimedBy.set(name, index);
        return [];
      }
      return [error(childPath('designers', index), `"${name}" also names designers[${claimedBy.get(name)}]`)];
    });
  });
}

function designersErrors(designers) {
  if (!Array.isArray(designers)) return [error('designers', 'designers must be a list')];
  return [
    ...designers.flatMap((designer, index) => designerErrors(designer, childPath('designers', index))),
    ...duplicateEmailErrors(designers, 'designers'),
    ...sharedNameErrors(designers),
  ];
}

function headerErrors(rules) {
  return [
    ...unknownKeyErrors(rules, RULES_KEYS, ''),
    ...fieldErrors(rules, '', [
      ['version', (value) => Number.isInteger(value) && value >= 0, 'version must be a whole number, 0 or more'],
      ['orgId', (value) => typeof value === 'string' && DOCUMENT_ID.test(value), 'orgId must be a document id: no spaces or slashes'],
    ]),
  ];
}

/**
 * Every problem with a rule set.
 *
 * @param {any} rules
 * @returns {{ ok: boolean, errors: { path: string, message: string }[] }}
 */
export function validateRules(rules) {
  if (!isPlainObject(rules)) return { ok: false, errors: [error('', 'rules must be an object')] };
  const errors = [
    ...headerErrors(rules),
    ...mapErrors(rules, 'calendars', calendarErrors, { minEntries: 1 }),
    ...mapErrors(rules, 'cutoffs', cutoffErrors),
    ...mapErrors(rules, 'boardBypass', boardBypassErrors),
    ...mapErrors(rules, 'duties', dutyErrors),
    ...designersErrors(rules.designers),
    ...mapErrors(rules, 'profiles', profileErrors),
    ...mapErrors(rules, 'steps', stepErrors),
  ];
  return { ok: errors.length === 0, errors };
}
