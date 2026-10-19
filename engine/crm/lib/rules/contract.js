// VERBATIM COPY of CRM lib/rules/contract.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/contract.js
//
// The vocabulary of the report-rules registry: every enum a rule may use and the
// shape of a rule set, written down once.
//
// The engine (lib/rules/*), the registry's content (lib/rules/defaults.js) and
// every report that reads the registry implement against these names. A value
// that is not listed here is a typo, and lib/rules/schema.js refuses it rather
// than letting a report quietly read it as "none of the above".
//
// Pure data — no imports — so the browser, the server, scripts and Jest all load
// it the same way.

/**
 * The Design Approval board's flow, named on its own because the scope engine
 * (lib/rules/scope.js) applies that board's approved-PI gate to it alone.
 */
export const FLOW_DESIGN_APPROVAL = 'designApproval';

/**
 * The board or feed a step lives on. Also the key of `boardBypass`: a bypass is
 * set per FLOW ('crmFms', 'soFms', 'designApproval' …), never per step or per
 * authority, because it is the board that keeps showing the row.
 */
export const FLOWS = Object.freeze([
  'crmFms', 'soFms', FLOW_DESIGN_APPROVAL, 'designRequest', 'ticket', 'hrerpDesign', 'hrerpCylinder', 'hrerpPurchase',
]);

/**
 * A step's registry key is '<flow>:<code>', with any '.' in the code written
 * as '_': Step-11.5 of the SO FMS board is 'soFms:SO-11_5'. A key never holds
 * a '.', so it is never read as a nested field path when the rules are stored
 * or patched. lib/rules/steps-default.js stepKeyOf builds keys this way.
 */
export const STEP_KEY_SEPARATOR = ':';
export const STEP_KEY_DOT = '_';

/** What one occurrence of a step is counted against. */
export const GRAINS = Object.freeze(['pi', 'so', 'ci', 'designRow', 'ticket', 'job']);

/**
 * Who a step belongs to. `duty` names an entry of `rules.duties`. 'piOwnerAtDue'
 * is the PI's CRM as of when the step fell due: a PI transfer hands over the
 * steps still to come, never the ones already due (owner decision 12).
 */
export const OWNER_KINDS = Object.freeze([
  'piOwner', 'piOwnerAtDue', 'requester', 'duty', 'designer', 'assignee', 'hrerpDoer', 'management',
]);
export const OWNER_KIND_DUTY = 'duty';

/**
 * A page besides the board whose action finishes a step on the board
 * (StepRule.doneFrom), and the one step each page can finish: a signed PI
 * uploaded from the Approved PI list finishes CRM FMS Step-2 (owner decision 14).
 */
export const DONE_FROM = Object.freeze({ APPROVED_PI_LIST: 'approvedPiList' });
export const DONE_FROM_STEP = Object.freeze({ [DONE_FROM.APPROVED_PI_LIST]: `crmFms${STEP_KEY_SEPARATOR}S2` });

/** The system that records a step and the board in it, as '<source>:<board>'. */
export const AUTHORITY_SOURCES = Object.freeze(['crm', 'hrerp']);

/**
 * The cutoffs of the default rules, by key (rules.cutoffs.<key>). The Design
 * Approval board's own cutoff is keyed by its flow.
 */
export const CUTOFF = Object.freeze({
  CRM_FMS: 'crmFms', SO_FMS: 'soFms', DESIGN_REQ: 'designReq', DESIGN_APPROVAL: FLOW_DESIGN_APPROVAL,
});

/** Which date a cutoff is compared with. */
export const CUTOFF_BASIS = Object.freeze({
  PI_APPROVAL: 'piApproval',
  STEP_PLANNED: 'stepPlanned',
  LATEST_ACTIVITY: 'latestActivity',
});

/** When a board still shows a row the cutoff would hide. */
export const BOARD_BYPASS = Object.freeze({
  NONE: 'none',
  HAS_FMS_ROW: 'hasFmsRow',
  HAS_MASTER_ROW: 'hasMasterRow',
});

/** Where a calendar's office holidays come from. */
export const HOLIDAY_SOURCES = Object.freeze({ HRERP: 'hrerp', NONE: 'none' });

/**
 * Minutes east of UTC for each zone a calendar may name.
 *
 * Only zones without daylight saving belong here: the clocks add one fixed
 * offset, which is exact for India (one offset all year since 1945) and would be
 * wrong twice a year anywhere that shifts.
 */
export const TIME_ZONE_OFFSET_MINUTES = Object.freeze({ 'Asia/Kolkata': 330 });

/**
 * `plan: 'authority'` — the planned time is whatever the owning system records.
 *
 * A plan object only ever counts FORWARD from its anchor: `add.n` is 0 or more.
 * A step due BEFORE its anchor (SO-1 is the first dispatch date less 10 working
 * days, SO-3 the latest dispatch date less 2) is not "anchor + time" and keeps
 * plan 'authority'; a negative n is refused rather than read as "before".
 */
export const PLAN_AUTHORITY = 'authority';
export const PLAN_UNIT = Object.freeze({
  WORKING_MINUTES: 'workingMinutes',
  WORKING_DAYS: 'workingDays',
  CALENDAR_DAYS: 'calendarDays',
});
export const PLAN_UNITS = Object.freeze(Object.values(PLAN_UNIT));

/** 52 six-day weeks: the most working days a year holds on any calendar here. */
const WORKING_DAYS_PER_YEAR = 52 * 6;
/** The longest office day a calendar may describe, in minutes. */
const MINUTES_PER_WORKING_DAY = 8 * 60;
const CALENDAR_DAYS_PER_LEAP_YEAR = 366;

/**
 * The most `plan.add.n` may be, per unit: a year of working time. No step is
 * planned further out than that, and a mistyped 1e10 minutes would otherwise
 * send the clock walking for seconds on every row.
 */
export const PLAN_ADD_MAX = Object.freeze({
  [PLAN_UNIT.WORKING_MINUTES]: MINUTES_PER_WORKING_DAY * WORKING_DAYS_PER_YEAR,
  [PLAN_UNIT.WORKING_DAYS]: WORKING_DAYS_PER_YEAR,
  [PLAN_UNIT.CALENDAR_DAYS]: CALENDAR_DAYS_PER_LEAP_YEAR,
});

export const FORMULAS = Object.freeze(['crmExecWeighted', 'pcDeskWeighted', 'designerLegacy', 'missPct']);
export const PERIODS = Object.freeze(['rolling', 'istCalendar']);
export const CARRY_OVER = Object.freeze(['scored', 'listed']);
export const EARLY_FINISH = Object.freeze(['now', 'atPlanned']);

/** Fields of each contract object, in the order the contract lists them. */
export const RULES_KEYS = Object.freeze([
  'version', 'orgId', 'calendars', 'cutoffs', 'boardBypass', 'steps', 'duties', 'designers', 'profiles',
]);
export const CALENDAR_KEYS = Object.freeze(['tz', 'windows', 'workingDays', 'holidays']);
export const WINDOW_KEYS = Object.freeze(['start', 'end']);
export const CUTOFF_KEYS = Object.freeze(['date', 'basis', 'atIstMidnight']);
export const STEP_KEYS = Object.freeze([
  'key', 'flow', 'code', 'label', 'authority', 'grain', 'owner', 'calendar', 'graceMin', 'cutoffKey', 'chase',
  'scoreIn', 'requiredWhen', 'exclusions', 'plan', 'effectiveFrom', 'source', 'doneFrom',
]);
export const OWNER_KEYS = Object.freeze(['kind', 'duty']);
export const PLAN_KEYS = Object.freeze(['anchor', 'add', 'calendar']);
export const PLAN_ADD_KEYS = Object.freeze(['n', 'unit']);
export const DUTY_KEYS = Object.freeze(['label', 'people']);
export const PERSON_KEYS = Object.freeze(['email', 'name']);
export const DESIGNER_KEYS = Object.freeze(['email', 'name', 'hrerpUserId', 'aliases']);
export const PROFILE_KEYS = Object.freeze([
  'key', 'label', 'formula', 'params', 'period', 'outcome', 'reward', 'grades', 'cohort',
]);
export const OUTCOME_KEYS = Object.freeze(['carryOver', 'earlyFinish', 'freezeOnClose']);
export const REWARD_KEYS = Object.freeze(['topN', 'minScore']);
export const GRADE_KEYS = Object.freeze(['grade', 'min']);

/**
 * @typedef {{ start: string, end: string }} WorkWindow  'HH:MM', IST wall clock.
 *
 * @typedef {object} CalendarProfile
 * @property {'Asia/Kolkata'} tz
 * @property {WorkWindow[]} windows       In order, not touching: the gaps are breaks.
 * @property {number[]} workingDays       JS getDay(): 0 = Sunday, 1 = Monday … 6 = Saturday.
 * @property {'hrerp'|'none'} holidays    'hrerp' closes the office holidays hr-erp sends.
 *
 * @typedef {object} CutoffRule
 * @property {string} date                'YYYY-MM-DD', or '' for no cutoff.
 * @property {'piApproval'|'stepPlanned'|'latestActivity'} basis
 * @property {boolean} atIstMidnight      false reproduces new Date('YYYY-MM-DD') (05:30 IST).
 *
 * @typedef {{ all: Condition[] } | { any: Condition[] } | { not: Condition }
 *   | { fact: string, op: 'eq'|'neq'|'in'|'includes'|'exists'|'before'|'after', value?: any }} Condition
 *
 * @typedef {object} StepRule
 * @property {string} key                 '<flow>:<code>' with '.' as '_' — see STEP_KEY_SEPARATOR.
 * @property {'crmFms'|'soFms'|'designApproval'|'designRequest'|'ticket'|'hrerpDesign'|'hrerpCylinder'|'hrerpPurchase'} flow
 * @property {string} code
 * @property {string} label
 * @property {string} authority           '<crm|hrerp>:<board>', e.g. 'crm:crmFms'.
 * @property {'pi'|'so'|'ci'|'designRow'|'ticket'|'job'} grain
 * @property {{ kind: string, duty?: string }} owner
 * @property {string} calendar            A key of `rules.calendars`.
 * @property {number} graceMin            On time while the delay is at most this many working
 *   minutes, inclusive: 59 is the FMS boards' "under an hour" (their delay is floored to
 *   whole hours), 5 is Design Approval's ON_TIME_GRACE_MIN (lib/designApprovalClock.js).
 * @property {string|null} cutoffKey      A key of `rules.cutoffs`, or null for none.
 * @property {boolean} chase
 * @property {string[]} scoreIn           Profile keys; [] = not scored.
 * @property {Condition|null} requiredWhen null = always required.
 * @property {string[]} exclusions
 * @property {'authority'|{ anchor: string, add: { n: number, unit: string }, calendar: string }} plan
 *   `add.n` is 0 to PLAN_ADD_MAX[unit]; a step due before its anchor is 'authority'.
 * @property {string|null} effectiveFrom  'YYYY-MM-DD'.
 * @property {string} source              file:line today's behaviour comes from.
 * @property {string[]} [doneFrom]        The one field a step may leave out: DONE_FROM pages whose action
 *   also finishes it on its board. Absent or [] = the board alone.
 *
 * @typedef {object} ScoringProfile
 * @property {string} key
 * @property {string} label
 * @property {'crmExecWeighted'|'pcDeskWeighted'|'designerLegacy'|'missPct'} formula
 * @property {object} params
 * @property {'rolling'|'istCalendar'} period
 * @property {{ carryOver: 'scored'|'listed', earlyFinish: 'now'|'atPlanned', freezeOnClose: boolean }} outcome
 * @property {{ topN: number, minScore: number }|null} reward
 * @property {{ grade: string, min: number|null }[]|null} grades  Highest `min` first, strictly
 *   descending. The LAST grade's min may be null (or -Infinity) for "everything below":
 *   A ≥ −5, B ≥ −15, C ≥ −30, else D is [A −5, B −15, C −30, D null]. null is the form
 *   that survives being stored (JSON has no -Infinity).
 * @property {Condition|null} cohort      null = everyone the formula scores.
 *
 * @typedef {object} Rules
 * @property {number} version
 * @property {string} orgId
 * @property {Object<string, CalendarProfile>} calendars
 * @property {Object<string, CutoffRule>} cutoffs
 * @property {Object<string, 'none'|'hasFmsRow'|'hasMasterRow'>} boardBypass  Keyed by FLOW name
 *   (one of FLOWS: 'crmFms', 'soFms', 'designApproval', 'ticket' …), the board that keeps the row.
 * @property {Object<string, StepRule>} steps  Keyed by StepRule.key.
 * @property {Object<string, { label: string, people: { email: string, name: string }[] }>} duties
 * @property {{ email: string, name: string, hrerpUserId: string|null, aliases: string[] }[]} designers
 * @property {Object<string, ScoringProfile>} profiles
 */
