// VERBATIM COPY of CRM lib/mis/types.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/types.js
//
// The MIS engine's vocabulary: every shape lib/mis reads or writes, as JSDoc
// typedefs, and the named values those shapes hold.
//
// Ported from hr-erp lib/mis/types.ts, which is the port's contract. What the
// CRM changed, and why:
//   • A step arrives from a feed with its people on it (`doers`), and
//     lib/mis/doers.js makes one copy per person. That per-person copy — what
//     hr-erp's types.ts calls MisStep — is MisDoerStep here; MisStep is the
//     feed's row.
//   • A person is known by email, as the registry's duty people are, not by an
//     hr-erp user id.
//   • A flow is one of the rules registry's (lib/rules/contract.js FLOWS), not
//     hr-erp's three; only their labels are declared here.
//   • `status` is the board's own word for the row and `excuse` is why the
//     board shows it closed or waived. An excused step is a sixth outcome:
//     listed with its reason, scored to nobody, not backlog.
//   • `delayMin` stays on the row: each board measures lateness on its own
//     working calendar, exactly as each hr-erp flow does, so the engine never
//     re-measures it and never declares a calendar.
//   • `refs` gathers hr-erp's ref / detail / search into one object.
//   • The scoring policy (grace, early finish, carry-over), the grade bands and
//     the reward rule are parameters the engine takes from a registry profile
//     (lib/rules/contract.js ScoringProfile and StepRule.graceMin). The
//     defaults declared here are hr-erp's own, so the port stays verifiable
//     against it.
//
// Wire-safe: instants are ISO strings, so the same shapes go through an API
// route, a store and a Jest test unchanged. Pure; the only import is the
// contract's flow list.

import { FLOWS } from '../rules/contract.js';

/** What each registry flow is called wherever a step is listed. */
const FLOW_LABELS = Object.freeze({
  crmFms: 'CRM FMS',
  soFms: 'SO FMS',
  designApproval: 'Design Approval',
  designRequest: 'Design Request',
  ticket: 'Tickets',
  hrerpDesign: 'Design',
  hrerpCylinder: 'Cylinder',
  hrerpPurchase: 'Purchase',
});

/**
 * The flows a step may belong to, in the registry's order, each with its label.
 * @type {ReadonlyArray<{ key: string, label: string }>}
 */
export const MIS_FLOWS = Object.freeze(FLOWS.map((key) => Object.freeze({ key, label: FLOW_LABELS[key] ?? key })));

/**
 * How one step stands in the period, as of now:
 *
 *   on-time       due in the period, done by its planned time (plus the board's grace)
 *   late          due in the period, done after it
 *   not-done      due in the period, still open
 *   carried-over  still open, planned before the period began
 *   upcoming      planned later in the period, not due yet
 *   excused       the board shows it closed or waived, with a reason
 *
 * Only the first three are scored. Late and not done are the misses behind the
 * score; not done and carried over are the backlog. Excused is neither.
 */
export const MIS_OUTCOME = Object.freeze({
  ON_TIME: 'on-time',
  LATE: 'late',
  NOT_DONE: 'not-done',
  CARRIED_OVER: 'carried-over',
  UPCOMING: 'upcoming',
  EXCUSED: 'excused',
});

/** @type {ReadonlySet<string>} */
export const MIS_MISSED_OUTCOMES = new Set([MIS_OUTCOME.LATE, MIS_OUTCOME.NOT_DONE]);
/** @type {ReadonlySet<string>} */
export const MIS_BACKLOG_OUTCOMES = new Set([MIS_OUTCOME.NOT_DONE, MIS_OUTCOME.CARRIED_OVER]);

/** Where a step falls for a period: due (and counted), not due yet, open from before it, or not its work. */
export const MIS_BUCKET = Object.freeze({
  DUE: 'due',
  UPCOMING: 'upcoming',
  CARRYOVER: 'carryover',
  OUTSIDE: 'outside',
});

/** When a step finished before its planned time counts (ScoringProfile.outcome.earlyFinish). */
export const MIS_EARLY_FINISH = Object.freeze({
  /** Once its planned time passes — hr-erp's rule and owner decision #3. */
  AT_PLANNED: 'atPlanned',
  /** As soon as it is done — the reports' behaviour before the decisions. */
  NOW: 'now',
});

/** What open work planned before the period does (ScoringProfile.outcome.carryOver). */
export const MIS_CARRY_OVER = Object.freeze({
  /** Listed as backlog, not scored — hr-erp's rule and owner decision #3. */
  LISTED: 'listed',
  /** Scored against the period as not done — the reports' behaviour before the decisions. */
  SCORED: 'scored',
});

/** No working minutes of grace: hr-erp's on-time rule. */
export const NO_GRACE_MIN = 0;

/**
 * hr-erp's own scoring rules, so a call that passes no policy scores exactly as
 * hr-erp lib/mis/score.ts does.
 * @type {Readonly<MisPolicy>}
 */
export const MIS_DEFAULT_POLICY = Object.freeze({
  graceMin: NO_GRACE_MIN,
  earlyFinish: MIS_EARLY_FINISH.AT_PLANNED,
  carryOver: MIS_CARRY_OVER.LISTED,
});

/**
 * hr-erp's grade bands (lib/mis/score.ts misGrade): A to −5%, B to −15%, C to
 * −30%, D below. D's floor is the scale's own, since no score is below −100%.
 * @type {ReadonlyArray<{ grade: string, min: number }>}
 */
export const MIS_DEFAULT_GRADES = Object.freeze([
  Object.freeze({ grade: 'A', min: -5 }),
  Object.freeze({ grade: 'B', min: -15 }),
  Object.freeze({ grade: 'C', min: -30 }),
  // The last band's min is null: everything below the others (lib/rules/contract.js).
  Object.freeze({ grade: 'D', min: null }),
]);

/** The grade of a doer with nothing planned. */
export const MIS_NO_GRADE = '—';

/** "S2 · Indent approval" — code and name, as hr-erp's stepLabel reads; the name alone when there is no code. */
export function misStepLabel(step) {
  return step.code ? `${step.code} · ${step.label}` : step.label;
}

/**
 * @typedef {object} MisPerson  Someone a step is scored to.
 * @property {string} email  Their identity — the registry's duty people and designers carry it.
 * @property {string} name   As the registry names them.
 *
 * @typedef {object} MisExcuse  Why a board shows a step closed or waived.
 * @property {string} reason        The reason given; a step is excused only with one.
 * @property {string|null} by       Who closed it.
 * @property {string|null} at       When, ISO.
 *
 * @typedef {object} MisRefs  What a step is about, for the row and the search box.
 * @property {string} ref     "PI 26127", "SO 2631 · CI 2", "Ticket 418".
 * @property {string} detail  Buyer, item, vendor — the line under the reference.
 * @property {string} search  Everything the board's row holds, for the search box.
 *
 * @typedef {object} MisStep  One planned step of one flow, as a feed hands it over.
 * @property {string} id                 Unique per step, however many people share it.
 * @property {string} flow               A key of MIS_FLOWS.
 * @property {string} stepKey            The registry's step key: "crmFms:S2", "soFms:SO-11".
 * @property {string} code               "S2", "SO-11", "DA-S1".
 * @property {string} label              "Signed PI", "Payment received".
 * @property {string} plannedAt          ISO.
 * @property {string|null} actualAt      ISO; null while open.
 * @property {number|null} delayMin      Working minutes late on the board's own calendar — at finish when done, so far when open; ≤ 0 is on time; null when the board did not measure it.
 * @property {MisPerson[]} doers         Everyone the step belongs to; [] when nobody.
 * @property {string} status             The board's own word for the row ("DONE", "OVERDUE", "HOLD" …), carried for the drill-down; the engine reads actualAt and excuse, not this.
 * @property {MisExcuse|null} excuse     Set only when the board shows the step closed, waived or held with a reason, or done with no finish time.
 * @property {string} [delayReason]      Why it ran late, as written on the board; '' when nothing is written.
 * @property {MisRefs} refs
 *
 * @typedef {object} MisDoerStep  One person's copy of a step — the unit the score counts (hr-erp's MisStep).
 * @property {string} id                 Unique per person: a step two people share is listed once for each.
 * @property {string} stepId             The step itself — team totals count it once.
 * @property {string} flow
 * @property {string} stepKey
 * @property {string} code
 * @property {string} label
 * @property {string} doer               The person's name; "Unassigned" when nobody.
 * @property {string|null} doerId        Their email; null when nobody is assigned.
 * @property {string} plannedAt
 * @property {string|null} actualAt
 * @property {number|null} delayMin
 * @property {string} status
 * @property {MisExcuse|null} excuse
 * @property {MisRefs} refs
 *
 * @typedef {MisDoerStep & { outcome: string }} MisReportStep  A step as the report lists it, with how it stands (MIS_OUTCOME).
 *
 * @typedef {object} MisPolicy  How a profile scores; every field falls back to hr-erp's rule.
 * @property {number|((step: MisDoerStep) => number)} [graceMin]  Working minutes late that still read on time, inclusive; a function reads each step's own board grace (StepRule.graceMin).
 * @property {'atPlanned'|'now'} [earlyFinish]  MIS_EARLY_FINISH.
 * @property {'listed'|'scored'} [carryOver]    MIS_CARRY_OVER.
 *
 * @typedef {object} MisCounts  Planned against done and done on time, and the two misses as negative percentages.
 * @property {number} planned             Steps planned inside the period whose planned time has passed.
 * @property {number} done
 * @property {number} onTime
 * @property {number|null} notDonePct     −(planned − done) ÷ planned × 100; null with nothing planned.
 * @property {number|null} notOnTimePct   −(planned − done on time) ÷ planned × 100 — the score; null with nothing planned.
 *
 * @typedef {MisCounts & {
 *   late: number, notDone: number, carryover: number, upcoming: number, excused: number, backlog: number
 * }} MisTally  The counts beside the score: late (done after plan), notDone (open, time passed), carryover
 *   (open, planned before the period), upcoming (not due yet), excused (closed or waived with a reason),
 *   backlog (notDone + carryover — pending now).
 *
 * @typedef {MisTally & { flow: string, stepKey: string, code: string, label: string }} MisStepCounts
 *
 * @typedef {MisTally & {
 *   doer: string, doerId: string|null, rank: number, flows: string[], avgDelayMin: number|null, byStep: MisStepCounts[]
 * }} MisDoerScore  One person's row: rank from 1, their flows in MIS_FLOWS order, the average working minutes
 *   late across their late and not-done steps, and a row per step they hold in the period's view.
 *
 * @typedef {MisDoerScore & { duties: string[] }} MisDoerRow  A scored doer as a page shows them, with their duties.
 *
 * @typedef {object} MisPeriod
 * @property {string} from  First day, YYYY-MM-DD (IST).
 * @property {string} to    Last day, inclusive, YYYY-MM-DD (IST).
 *
 * @typedef {object} MisReport
 * @property {MisPeriod} period
 * @property {string} label           "6 – 12 Oct 2026".
 * @property {string} generatedAt     ISO.
 * @property {MisTally} team          Every step once, however many people share it.
 * @property {MisDoerRow[]} doers
 * @property {MisReportStep[]} steps  Every step in the period's view, per person, oldest plan first.
 * @property {string[]} warnings      Feeds that could not be read; the scores leave them out.
 */
