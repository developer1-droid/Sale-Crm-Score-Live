// VERBATIM COPY of CRM lib/mis/board-period.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/board-period.js
//
// The period a profile's MIS board covers, read from the period picker a
// surface already has: the Scoreboard's modes (lib/scoring/period.js
// PERIOD_MODES), and the window keys Department Analytics and Score Live share
// (hooks/useMisSteps.js TIME_OPTS, score-live/engine/crmPeriods.js).
//
// A profile on IST calendar periods (PERIOD.IST_CALENDAR, owner decision #2)
// is read over IST Monday–Sunday weeks and calendar months that run up to now
// (lib/mis/period.js presetPeriod) — and over the calendar quarter, half-year
// and year that hold today for the longer keys, each made of whole calendar
// months. Any other profile keeps the surface's own window, as IST days. A
// custom range is the days picked, whatever the profile; on the Scoreboard, one
// with a day cleared or half typed reads as the period the board opens on.
//
// Pure.

import { rangeForPeriod } from '../scoring/period.js';
import { MIS_PRESET, istToday, parseMisDay, periodBounds, presetPeriod } from './period.js';
import { usesIstCalendar } from './profile-engine.js';

const LAST_MS = 1;

/** The Scoreboard's modes (lib/scoring/period.js PERIOD_MODES ids). */
export const BOARD_MODE = Object.freeze({ WEEK: 'week', MONTH: 'month', LAST_MONTH: 'lastMonth', CUSTOM: 'custom' });

/**
 * The mode the Scoreboard opens on (app/(app)/scoreboard/page.jsx) — and so
 * the period a section reads while its custom range has a day missing.
 */
export const DEFAULT_BOARD_MODE = BOARD_MODE.MONTH;

/** The window keys of Department Analytics (TIME_OPTS) and Score Live (CRM_PERIODS). */
export const WINDOW_KEY = Object.freeze({
  TODAY: 'today',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  HALF_YEARLY: 'halfyearly',
  YEARLY: 'yearly',
  CUSTOM: 'custom',
});

/** What each window key is called when it names an IST calendar period. */
export const CALENDAR_KEY_LABEL = Object.freeze({
  [WINDOW_KEY.TODAY]: 'Today',
  [WINDOW_KEY.WEEKLY]: 'This week',
  [WINDOW_KEY.MONTHLY]: 'This month',
  [WINDOW_KEY.QUARTERLY]: 'This quarter',
  [WINDOW_KEY.HALF_YEARLY]: 'This half-year',
  [WINDOW_KEY.YEARLY]: 'This year',
  [WINDOW_KEY.CUSTOM]: 'Custom',
});

const MODE_PRESET = Object.freeze({
  [BOARD_MODE.WEEK]: MIS_PRESET.THIS_WEEK,
  [BOARD_MODE.MONTH]: MIS_PRESET.THIS_MONTH,
  [BOARD_MODE.LAST_MONTH]: MIS_PRESET.LAST_MONTH,
});

const KEY_PRESET = Object.freeze({
  [WINDOW_KEY.WEEKLY]: MIS_PRESET.THIS_WEEK,
  [WINDOW_KEY.MONTHLY]: MIS_PRESET.THIS_MONTH,
});

/** The calendar months a longer key spans, counted from January. */
const SPAN_MONTHS = Object.freeze({ [WINDOW_KEY.QUARTERLY]: 3, [WINDOW_KEY.HALF_YEARLY]: 6, [WINDOW_KEY.YEARLY]: 12 });

const pad2 = (n) => String(n).padStart(2, '0');
const YEAR_END = 4;
const MONTH_END = 7;

/** The span of `months` calendar months, counted from January, that holds today (IST). */
function calendarSpan(months, now) {
  const today = istToday(now);
  const year = Number(today.slice(0, YEAR_END));
  const month = Number(today.slice(YEAR_END + 1, MONTH_END)) - 1;
  const first = month - (month % months);
  const lastDay = new Date(Date.UTC(year, first + months, 0)).getUTCDate();
  return { from: `${year}-${pad2(first + 1)}-01`, to: `${year}-${pad2(first + months)}-${pad2(lastDay)}` };
}

/** A custom range as a period: the two days picked, in order; null when either is not a real day. */
export function customPeriod(from, to) {
  const start = parseMisDay(from);
  const end = parseMisDay(to);
  if (!start || !end) return null;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/** A window [start, end] as the IST days it covers. */
export const periodOfWindow = ({ start, end }) => ({ from: istToday(start), to: istToday(end) });

/** A period as an inclusive window [start, end]: IST midnight of its first day to the last instant of its last. */
export function windowOfPeriod(period) {
  const { start, end } = periodBounds(period);
  return { start, end: new Date(end.getTime() - LAST_MS) };
}

/** The IST calendar period a window key names, as of now; null for custom or a key it does not know. */
export function calendarPeriodOf(key, now) {
  if (key === WINDOW_KEY.TODAY) {
    const today = istToday(now);
    return { from: today, to: today };
  }
  if (Object.hasOwn(KEY_PRESET, key)) return presetPeriod(KEY_PRESET[key], now);
  if (Object.hasOwn(SPAN_MONTHS, key)) return calendarSpan(SPAN_MONTHS[key], now);
  return null;
}

const isInstant = (at) => at instanceof Date && Number.isFinite(at.getTime());

/** The period a Scoreboard section opens on: this month — the IST month under calendar periods, the board's own window otherwise. */
function defaultBoardPeriodOf(profile, now) {
  if (usesIstCalendar(profile)) return presetPeriod(MODE_PRESET[DEFAULT_BOARD_MODE], now);
  return periodOfWindow(rangeForPeriod(DEFAULT_BOARD_MODE, '', '', now));
}

/**
 * The Scoreboard's period for a profile: the IST week or month (this one, or
 * last month) under calendar periods, the board's own window otherwise; a
 * custom range is the days picked. A custom range with a day cleared or half
 * typed — the window the page builds from it is no instant at all — is the
 * period the board opens on (DEFAULT_BOARD_MODE), never an error.
 *
 * @param {object|null} profile
 * @param {{ mode: string, customStart: string, customEnd: string, window: { start: Date, end: Date } }} picked
 * @param {Date} now
 * @returns {import('./types.js').MisPeriod}
 */
export function scoreboardPeriodOf(profile, { mode, customStart, customEnd, window }, now) {
  if (mode === BOARD_MODE.CUSTOM) return customPeriod(customStart, customEnd) ?? defaultBoardPeriodOf(profile, now);
  if (usesIstCalendar(profile) && Object.hasOwn(MODE_PRESET, mode)) return presetPeriod(MODE_PRESET[mode], now);
  return isInstant(window?.start) && isInstant(window?.end) ? periodOfWindow(window) : defaultBoardPeriodOf(profile, now);
}

/**
 * A window key's period for a profile (Department Analytics, Score Live): the
 * IST calendar period it names under calendar periods, the surface's own
 * window otherwise; a custom range is the days picked.
 *
 * @param {object|null} profile
 * @param {{ key: string, window: { start: Date, end: Date }, customStart?: string, customEnd?: string }} picked
 * @param {Date} now
 * @returns {import('./types.js').MisPeriod}
 */
export function windowPeriodOf(profile, { key, window, customStart, customEnd }, now) {
  const custom = key === WINDOW_KEY.CUSTOM ? customPeriod(customStart, customEnd) : null;
  if (custom) return custom;
  const calendar = usesIstCalendar(profile) ? calendarPeriodOf(key, now) : null;
  return calendar ?? periodOfWindow(window);
}
