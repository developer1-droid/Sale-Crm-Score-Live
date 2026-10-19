// VERBATIM COPY of CRM lib/designer-mis/types.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/designer-mis/types.js
//
// The Designer MIS's vocabulary: what hr-erp sends (its lib/designer-steps/
// types.ts, restated here as JSDoc so the CRM side reads against one contract),
// which registry step each row is, and the names the modules share.
//
// hr-erp reports facts — planned and actual times, who, which round, whose
// fault — and the CRM applies the owner's rules (docs/reports-rules-decisions.md
// #17–#21) through the registry (lib/rules) and scores on the MIS engine
// (lib/mis). Nothing here re-plans or re-measures a step.
//
// Pure; imports only the contract's constants, so the browser, the route and
// Jest load it the same way.

import { STEP_KEY_SEPARATOR } from '../rules/contract.js';

/** The scope a token must carry to open hr-erp's /embed/designer-steps (hr-erp lib/designer-steps/types.ts). */
export const DESIGNER_STEPS_SCOPE = 'designer-steps';

/**
 * The registry profile the Designer MIS scores with (lib/rules/profiles-default.js
 * PROFILE.DESIGNER). Named here rather than imported: that module reaches into
 * the scoring engine, and the page builds its report in the browser.
 */
export const DESIGNER_PROFILE = 'designer';

/** hr-erp's step keys, in the order the work happens. */
export const DESIGNER_STEP = Object.freeze({ DESIGN_WORK: 'D2', CDR_HANDOVER: 'D3', DESIGN_UPLOAD: 'C1' });

/** What each step is called wherever it is listed (hr-erp DESIGNER_STEP_LABELS). */
export const DESIGNER_STEP_LABELS = Object.freeze({
  [DESIGNER_STEP.DESIGN_WORK]: 'Design work',
  [DESIGNER_STEP.CDR_HANDOVER]: 'CDR handover',
  [DESIGNER_STEP.DESIGN_UPLOAD]: 'Design Upload (CDR + GPG)',
});

/** hr-erp's flow names → the registry's (lib/rules/contract.js FLOWS). */
export const DESIGNER_FLOW_OF = Object.freeze({ design: 'hrerpDesign', cylinder: 'hrerpCylinder' });

/** The steps hr-erp sends, each with its hr-erp flow, in the order the work happens. */
export const DESIGNER_STEP_ORDER = Object.freeze([
  Object.freeze({ flow: 'design', code: DESIGNER_STEP.DESIGN_WORK }),
  Object.freeze({ flow: 'design', code: DESIGNER_STEP.CDR_HANDOVER }),
  Object.freeze({ flow: 'cylinder', code: DESIGNER_STEP.DESIGN_UPLOAD }),
]);

/** hr-erp's word for a step's standing (DesignerStepStatus). */
export const DESIGNER_STATUS = Object.freeze({ OPEN: 'open', DONE: 'done', EXCUSED: 'excused', SKIPPED: 'skipped' });

/**
 * The registry key of an hr-erp step: 'hrerpDesign:D2', 'hrerpCylinder:C1'
 * (lib/rules/steps-default.js stepKeyOf; no designer code holds a dot).
 * Null for a flow the registry does not have.
 */
export function designerStepKeyOf(flow, stepKey) {
  const registryFlow = DESIGNER_FLOW_OF[flow];
  if (!registryFlow || !stepKey) return null;
  return `${registryFlow}${STEP_KEY_SEPARATOR}${stepKey}`;
}

/**
 * @typedef {object} DesignerRef  A designer as hr-erp identifies one — by user, not the free-text name.
 * @property {string} userId
 * @property {string} email
 * @property {string} name
 *
 * @typedef {object} DesignerStepRefs  What a step is about.
 * @property {string} piNumber
 * @property {string} piItemNo
 * @property {string} designRowId
 * @property {string|null} jobId        The cylinder workflow id; null until one exists.
 * @property {string} requestType       'PI Request', 'Help Ticket', 'Exhibition' …
 * @property {string} packagingType
 * @property {string} designCategory
 * @property {boolean} buyerProvided
 * @property {string} piStatus          PI Data approval status; '' when the PI is unknown.
 *
 * @typedef {object} DesignerStepFacts  The facts behind the conditions the CRM applies.
 * @property {string} brand
 * @property {string} buyer
 * @property {string} description
 * @property {'buyer'|'designer'|'crm'|null} fault  Whose fault the latest disapproval was.
 * @property {boolean} redo
 * @property {boolean} held
 * @property {string} holdReason
 * @property {string} delayReason
 * @property {string|null} queueDue
 * @property {string|null} buyerApprovedAt
 * @property {string|null} poApprovedAt
 * @property {string|null} anchorAt
 * @property {string|null} boardPlannedAt
 * @property {string|null} rulePlannedAt
 * @property {string|null} workflowStatus
 *
 * @typedef {object} DesignerStep  One step of one round, as hr-erp sends it.
 * @property {string} stepId             `${designRowId}|${stepKey}|${round}`, unique in the response.
 * @property {'design'|'cylinder'} flow
 * @property {'D2'|'D3'|'C1'} stepKey
 * @property {string} label
 * @property {string|null} plannedAt     ISO; null when the step has no plan yet.
 * @property {string|null} actualAt
 * @property {number|null} delayMin      Office-calendar minutes late; ≤ 0 is on time; null without a plan.
 * @property {DesignerRef|null} designer
 * @property {string} actedBy
 * @property {number} round              1 for the first round; a redo or a reopened step counts up.
 * @property {'open'|'done'|'excused'|'skipped'} status
 * @property {string} excuse             Why it is excused or skipped; '' otherwise.
 * @property {boolean} cylinderJob       hr-erp opened a cylinder job for the design row.
 * @property {DesignerStepRefs} refs
 * @property {DesignerStepFacts} facts
 *
 * @typedef {object} DesignerStepsPayload  GET /embed/designer-steps, as the CRM proxy relays it.
 * @property {string} [builtAt]
 * @property {string} [from]
 * @property {string} [to]
 * @property {{ tz: string, windows: { start: string, end: string }[], workingDays: number[] }} [calendar]
 * @property {{ stepKey: string, text: string }[]} [rules]  hr-erp's own rule texts, one per step.
 * @property {(DesignerRef & { role: string })[]} [designers]
 * @property {DesignerStep[]} steps
 * @property {string[]} [warnings]       Sources hr-erp could not read; their steps are missing, not empty.
 * @property {string} [error]            Set when hr-erp (or the proxy) could not answer; steps is [] then.
 * @property {string} [fetchedAt]        When the CRM proxy fetched it.
 *
 * @typedef {import('../mis/types.js').MisStep & { design: DesignerStepDetail }} DesignerMisStep
 *   A feed row for the MIS engine, with the Designer MIS's own columns beside it.
 *
 * @typedef {object} DesignerStepDetail  What the drawer and the CSV print for a row.
 * @property {number} round
 * @property {string} requestType
 * @property {string} packagingType
 * @property {string} designCategory
 * @property {string} piNumber
 * @property {string} piItemNo
 * @property {string} designRowId
 * @property {string|null} jobId
 * @property {string} actedBy
 * @property {boolean} cylinderJob
 */
