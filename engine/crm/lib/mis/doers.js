// VERBATIM COPY of CRM lib/mis/doers.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/doers.js
//
// A feed's steps as the MIS counts them: one copy per person the step belongs
// to, so a step two people share counts in full for each of them — and, since
// every copy keeps the step's own id as `stepId`, once for the team. A step
// nobody owns is scored to "Unassigned": a gap in the registry's duties to
// fill, never a silent drop.
//
// Ported from hr-erp lib/mis/steps.ts: `forPeople` and the explicit Unassigned
// row. The converters around them (packaging, sales-order and cylinder rows)
// are hr-erp's own and stay there; the CRM's feeds hand over MisStep rows
// instead, and `doerStepsOf` turns those into per-person copies. People are
// known by email; a person named twice on one step (two duties) gets one copy.
//
// Pure.

/** The doer a step nobody owns is scored to. */
export const UNASSIGNED_DOER = 'Unassigned';

/**
 * One row per responsible person, or one "Unassigned" row when there is nobody.
 * @param {Omit<import('./types').MisDoerStep, 'id'|'doer'|'doerId'>} core
 * @param {ReadonlyArray<import('./types').MisPerson>} people
 * @returns {import('./types').MisDoerStep[]}
 */
export function forPeople(core, people) {
  if (people.length === 0) return [{ ...core, id: core.stepId, doer: UNASSIGNED_DOER, doerId: null }];
  return people.map((p) => ({ ...core, id: `${core.stepId}|${p.email}`, doer: p.name, doerId: p.email }));
}

/** The people on a step, each once, in the order the feed named them. */
function distinctPeople(people) {
  const seen = new Set();
  return people.filter((p) => {
    if (seen.has(p.email)) return false;
    seen.add(p.email);
    return true;
  });
}

/**
 * One feed step as the per-person copies the score counts.
 * @param {import('./types').MisStep} step
 * @returns {import('./types').MisDoerStep[]}
 */
export function doerStepsOfStep(step) {
  const { id, doers, ...rest } = step;
  return forPeople({ ...rest, stepId: id }, distinctPeople(doers ?? []));
}

/**
 * A feed's steps as per-person copies, in the feed's order.
 * @param {ReadonlyArray<import('./types').MisStep>} steps
 * @returns {import('./types').MisDoerStep[]}
 */
export function doerStepsOf(steps) {
  return steps.flatMap(doerStepsOfStep);
}
