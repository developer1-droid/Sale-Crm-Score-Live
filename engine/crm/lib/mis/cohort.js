// VERBATIM COPY of CRM lib/mis/cohort.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/cohort.js
//
// Who a scoring profile ranks: its `cohort` condition (lib/rules/conditions.js
// COHORT_FACT_CATALOGUE — role, email, duties) read against each person the
// engine scored. A profile with no cohort ranks everyone it scored.
// "Unassigned" — work the boards name nobody for — is a gap, not a person, so
// it is in no cohort.
//
// Pure. A person's role is the team directory's (lib/team-directory.js
// designationOf, passed in as `roleOf`); their duties are the registry's.

import { evaluate } from '../rules/conditions.js';

const emailOf = (value) => String(value ?? '').trim().toLowerCase();

/** The duty keys each registry person holds, by lower-case email. */
export function dutyKeysByEmail(rules) {
  const byEmail = new Map();
  Object.entries(rules?.duties ?? {}).forEach(([dutyKey, duty]) => {
    (Array.isArray(duty?.people) ? duty.people : []).forEach((person) => {
      const email = emailOf(person?.email);
      if (!email) return;
      const held = byEmail.get(email) ?? [];
      if (!held.includes(dutyKey)) byEmail.set(email, [...held, dutyKey]);
    });
  });
  return byEmail;
}

/**
 * A test of whether a scored doer is in the profile's cohort.
 *
 * @param {{ cohort?: object|null }|null} profile
 * @param {{ rules: object, roleOf?: (email: string) => string|null }} deps
 * @returns {(doer: { doerId: string|null }) => boolean}
 */
export function cohortTest(profile, { rules, roleOf }) {
  const duties = dutyKeysByEmail(rules);
  const cohort = profile?.cohort ?? null;
  return (doer) => {
    const email = emailOf(doer?.doerId);
    if (!email) return false;
    return evaluate(cohort, { role: roleOf?.(email) ?? '', email, duties: duties.get(email) ?? [] });
  };
}
