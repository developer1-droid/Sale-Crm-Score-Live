// VERBATIM COPY of CRM lib/work-clock.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/work-clock.js
//
// The one working-hour clock every board and report reads (owner's ask: "all
// due times in one place").
//
// The CRM FMS, SO FMS and Design Approval boards, the step feed, tickets (the
// route's stamp and the page's preview), the payment settlement lane, the CRM
// FMS sheet's Step-4 plan, the legacy PC report's delay and the designer's
// clock each carried their own copy of a working calendar and their own SLA
// minutes. They now all measure on
// lib/rules/calendar.js createWorkCalendar, built from the calendar the rules
// name, and take an SLA step's time from the rules' plan for it:
//
//   calendarClock(name)        the clock of rules.calendars[name], skipping
//                              HR-ERP's office holidays when the calendar says
//                              holidays: 'hrerp' (lib/work-calendar.js holds them)
//   stepPlannedAt(flow, code)  an SLA step's anchor + its plan's time, on the
//                              plan's calendar; a step its board plans itself
//                              keeps the board's own minutes
//   stepGraceMin(flow, code)   how late still reads on time
//
// Which rules: the ones a loader set for this process — the server's
// ensureClocks (lib/work-calendar-source.js), before any clock runs, and the
// browser's useWorkCalendar, from GET /api/work-calendar. Until one has, every
// clock runs on its built-in calendar and minutes, which are exactly the
// registry's defaults (lib/rules/defaults.js builds them from the same
// constants), so nothing reads differently before the rules arrive.
//
// A pure builder that is handed its rules (lib/step-feed/build.js) runs its
// clocks under them with withClockRules, so the feed it builds can never be
// measured on another rule set than the one it is scoped by.
//
// Module state on purpose, like the holiday list beside it: threading the
// rules through every working-minute call of a 9,000-line board would move
// every call site for no gain in what is measured.

import { DEFAULT_ORG_CONFIG } from './org-config.js';
import { createWorkCalendar, profileOfOrgCalendar } from './rules/calendar.js';
import { HOLIDAY_SOURCES } from './rules/contract.js';
import { CALENDAR } from './rules/names.js';
import { boardCutoffOf, parseCutoffDay } from './rules/scope.js';
import { graceOf, isDueToday, planDueAt, slaPlanOf, stepRuleOf } from './rules/step-clock.js';
import { isPlainObject, ownValue } from './rules/util.js';
import { calendarVersion as holidaysVersion, getHolidays } from './work-calendar.js';

/**
 * The office calendar every CRM FMS, SO FMS, ticket and settlement clock ran on
 * before the registry: lib/org-config.js's hours, no holidays. It is
 * rules.calendars.office in the registry's defaults.
 */
export const BUILT_IN_OFFICE = Object.freeze(profileOfOrgCalendar(DEFAULT_ORG_CONFIG.calendar, HOLIDAY_SOURCES.NONE));

const BUILT_IN = Object.freeze({ [CALENDAR.OFFICE]: BUILT_IN_OFFICE });

let activeRules = null;
let rulesVersion = 0;

/**
 * The rules every clock in this process reads from now on: the resolved rules
 * (lib/rules/load.server.js loadRules) or the browser's clock rules
 * (lib/rules/step-clock.js clockRulesOf). null goes back to the built-in clocks.
 */
export function setClockRules(rules) {
  const next = isPlainObject(rules) ? rules : null;
  if (next === activeRules) return;
  activeRules = next;
  rulesVersion += 1;
}

/** The rules the clocks read, or null while they run on their built-in calendars. */
export const clockRules = () => activeRules;

/**
 * Run `run` with every clock on `rules`, then put the process's rules back.
 * For synchronous builders handed their rules (the step feed) and for tests.
 */
export function withClockRules(rules, run) {
  const outer = activeRules;
  activeRules = isPlainObject(rules) ? rules : null;
  try {
    return run();
  } finally {
    activeRules = outer;
  }
}

/** Changes whenever the rules or the holidays the clocks read change; a cache of clock results keys on it. */
export const clockVersion = () => `${rulesVersion}.${holidaysVersion()}`;

/* ── the calendars ───────────────────────────────────────────────────────── */

/** Each profile's clock, rebuilt only when the holidays it skips change. */
const clocks = new WeakMap();
const NO_HOLIDAYS = -1;

function clockOfProfile(profile) {
  const holidays = profile.holidays === HOLIDAY_SOURCES.HRERP ? holidaysVersion() : NO_HOLIDAYS;
  const held = clocks.get(profile);
  if (held && held.holidays === holidays) return held.clock;
  const clock = createWorkCalendar(profile, holidays === NO_HOLIDAYS ? [] : getHolidays());
  clocks.set(profile, { holidays, clock });
  return clock;
}

let hasReportedBadCalendar = false;

/**
 * The working-hour clock of a calendar the rules name ('office', 'officeDa' …),
 * or of `fallback` — the caller's built-in profile, the office one when it has
 * none — while no rules are set or they hold no such calendar. Resolved rules
 * always carry valid calendars; a profile the clock still refuses falls back
 * rather than blanking a board.
 *
 * @param {string} name
 * @param {object} [fallback]  A calendar profile; the built-in office one for 'office'.
 * @returns {ReturnType<typeof createWorkCalendar>}
 */
export function calendarClock(name, fallback = BUILT_IN[name]) {
  const builtIn = isPlainObject(fallback) ? fallback : BUILT_IN_OFFICE;
  const profile = ownValue(activeRules?.calendars, name);
  if (!isPlainObject(profile)) return clockOfProfile(builtIn);
  try {
    return clockOfProfile(profile);
  } catch (error) {
    if (!hasReportedBadCalendar) {
      hasReportedBadCalendar = true;
      console.error(`The rules' "${name}" calendar could not be read; its built-in hours are used:`, error);
    }
    return clockOfProfile(builtIn);
  }
}

/** The office clock: CRM FMS, SO FMS, tickets and the settlement lane. */
export const officeClock = () => calendarClock(CALENDAR.OFFICE);

/* ── a board's steps ─────────────────────────────────────────────────────── */

/** The rule of a board's step under the clock rules, or null. */
export const clockStepRule = (flow, code) => stepRuleOf(activeRules, flow, code);

/**
 * When an SLA step falls due: `anchor` plus the rules' plan for it, on the
 * plan's calendar. Without rules, or for a step the rules leave to its board
 * ('authority'), the board's own minutes on its own calendar — `fallback`.
 *
 * @param {string} flow   'crmFms', 'soFms', 'designApproval'.
 * @param {string} code   The board's code: 'S2', 'SO-5', 'DA-S1'.
 * @param {Date|null} anchor
 * @param {{ minutes: number, calendar?: string, profile?: object }} fallback
 * @returns {Date|null}
 */
export function stepPlannedAt(flow, code, anchor, { minutes, calendar = CALENDAR.OFFICE, profile } = {}) {
  if (!anchor) return null;
  const plan = slaPlanOf(clockStepRule(flow, code));
  if (plan) return planDueAt(plan, anchor, calendarClock(plan.calendar, profile));
  return calendarClock(calendar, profile).addWorkingMinutes(anchor, minutes);
}

/** How many working minutes late a board's step may be and still read on time. */
export const stepGraceMin = (flow, code, fallback) => graceOf(clockStepRule(flow, code), fallback);

/**
 * The line a board hides its older rows behind (lib/rules/scope.js
 * boardCutoffOf): the rules' cutoff once they are loaded — IST midnight when
 * they say so — and, until then, the Settings day as the boards have always
 * read it, UTC midnight.
 *
 * @param {string} flow  'crmFms', 'soFms', 'designApproval', 'designRequest'.
 * @param {string} [settingsDay]  systemSettings' 'YYYY-MM-DD' the board was handed.
 * @returns {Date|null}
 */
export function boardCutoffLine(flow, settingsDay) {
  return activeRules ? boardCutoffOf(activeRules, flow).at : parseCutoffDay(String(settingsDay ?? '').trim());
}

export { isDueToday };
