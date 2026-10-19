// VERBATIM COPY of CRM lib/rules/duties.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/duties.js
//
// The registry's duty list (rules.duties): who holds the fixed duties — order
// scheduling, the follow-up coordinator, management, accounts — which decision
// 12 made an editable list (Settings > Report Rules). Everyone who names a
// duty's person reads it here, so an edit reaches them all: the step feed's
// owners (lib/step-feed/owners.js), the Process Coordinator desk lens
// (lib/mis/lens.js), the desk's weighted score (lib/scoring/crmExecScore.js
// scopePcSteps), the chase list (lib/pending-chase.js), /api/pc-report and the
// SO FMS board's Step-0 header (lib/so-fms-catalog.js soStepsFor).
//
// A caller with no rules reads today's duties (lib/rules/owners-default.js),
// the convention every rules reader keeps: no rules, today's numbers.
//
// Pure.

import { DEFAULT_DUTIES } from './owners-default.js';
import { isPlainObject } from './util.js';

const text = (value) => String(value ?? '').trim();
const emailOf = (value) => text(value).toLowerCase();

/** A person as a browser reads them: email and name, nothing else. */
export const publicPersonOf = (person) => ({ email: String(person?.email ?? ''), name: String(person?.name ?? '') });

/**
 * The duty list as a browser reads it — each duty's label and its people by
 * email and name, nothing else — every duty (GET /api/rules/resolved,
 * lib/rules-public.js), or only `keys` (the boards' clock rules,
 * lib/rules/step-clock.js clockRulesOf).
 *
 * @param {import('./contract.js').Rules|null} rules
 * @param {string[]|null} [keys]
 * @returns {Object<string, { label: string, people: { email: string, name: string }[] }>}
 */
export function publicDutiesOf(rules, keys = null) {
  const wanted = keys ? new Set(keys) : null;
  const duties = isPlainObject(rules?.duties) ? Object.entries(rules.duties) : [];
  return Object.fromEntries(duties
    .filter(([key]) => !wanted || wanted.has(key))
    .map(([key, duty]) => [key, {
      label: String(duty?.label ?? ''),
      people: (Array.isArray(duty?.people) ? duty.people : []).map(publicPersonOf),
    }]));
}

function dutyOf(rules, dutyKey) {
  const duties = rules ? rules.duties : DEFAULT_DUTIES;
  return duties && typeof dutyKey === 'string' && Object.hasOwn(duties, dutyKey) ? duties[dutyKey] : null;
}

/**
 * The people the registry puts on a duty, in its order, each once by
 * lower-case email. A name left blank reads as the email; an entry with no
 * email address names nobody.
 *
 * @param {import('./contract.js').Rules|null} rules
 * @param {string} dutyKey  A key of rules.duties (owners-default.js DUTY).
 * @returns {{ email: string, name: string }[]}
 */
export function dutyPeople(rules, dutyKey) {
  const people = dutyOf(rules, dutyKey)?.people;
  const seen = new Set();
  return (Array.isArray(people) ? people : []).flatMap((person) => {
    const email = emailOf(person?.email);
    if (!email.includes('@') || seen.has(email)) return [];
    seen.add(email);
    return [{ email, name: text(person?.name) || email }];
  });
}

/** The duty's own label: the desk its steps go under while nobody is on it. */
export const dutyLabel = (rules, dutyKey) => text(dutyOf(rules, dutyKey)?.label);

/**
 * Who a duty's own steps are listed under: the first person on it, else — with
 * nobody on it — its desk, the duty's label naming no one.
 *
 * @returns {{ email: string, name: string }}
 */
export function dutyHolder(rules, dutyKey) {
  const [first] = dutyPeople(rules, dutyKey);
  return first || { email: '', name: dutyLabel(rules, dutyKey) };
}
