// VERBATIM COPY of CRM lib/mis/lens.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/lens.js
//
// A desk lens (ScoringProfile.params.lens) over the step feed: whose a step is
// as the desk reads it. The Process Coordinator desk's lens leaves a step a
// kept duty owns with its owner — SO-0, the only step the order scheduling
// duty owns — and hands every other step, in every department, to the people
// on its follow-up duty (lib/rules/profiles-default.js PC_DESK_LENS). The
// duties' people are the registry's (decision #12's editable duty list, read
// through lib/rules/duties.js), never a name written into a report.
//
// A step is a kept duty's when the feed says its owner is a duty (`ownerKind`,
// lib/step-feed/owners.js) and the person it names is on one of the kept
// duties: a ticket assigned to the order scheduler is still handed over.
//
// Pure.

import { dutyPeople } from '../rules/duties.js';
import { OWNER_KIND } from '../rules/owners-default.js';

const emailOf = (value) => String(value ?? '').trim().toLowerCase();

/** Everyone the lens hands a step over to: the people on its `everyOtherStepTo` duty. */
export const lensPeople = (lens, rules) => dutyPeople(rules, lens?.everyOtherStepTo);

/** The emails on the duties whose own steps the lens leaves with them. */
function keptEmails(lens, rules) {
  const duties = Array.isArray(lens?.keepOwnerWhenDuty) ? lens.keepOwnerWhenDuty : [];
  return new Set(duties.flatMap((duty) => dutyPeople(rules, duty).map((person) => person.email)));
}

const isKept = (item, kept) => item?.ownerKind === OWNER_KIND.DUTY && kept.has(emailOf(item.ownerEmail));

/**
 * The feed's items as the lens credits them: a kept duty's step as it is,
 * every other one to `person` — or to nobody, which the engine scores to
 * "Unassigned", when the hand-over duty has no one on it.
 *
 * @param {object[]} items  Feed items (lib/step-feed/build.js StepFact).
 * @param {{ keepOwnerWhenDuty?: string[], everyOtherStepTo?: string }} lens
 * @param {object} rules  The resolved rules, whole or as GET /api/rules/resolved trims them.
 * @param {{ email: string, name: string }|null} person  One of lensPeople.
 * @returns {object[]}  New items where re-owned; the kept ones as they were.
 */
export function lensItems(items, lens, rules, person) {
  const kept = keptEmails(lens, rules);
  const owner = person ? { owner: person.name, ownerEmail: person.email } : { owner: '', ownerEmail: '' };
  return (items ?? []).map((item) => (isKept(item, kept) ? item : { ...item, ...owner }));
}
