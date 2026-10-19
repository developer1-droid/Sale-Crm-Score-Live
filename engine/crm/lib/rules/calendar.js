// VERBATIM COPY of CRM lib/rules/calendar.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/calendar.js
//
// The working-hour clock a rule's planned time and delay are measured on, built
// from a calendar profile rather than written out once per board.
//
// The CRM writes this clock out again and again — four times in lib/ alone:
// lib/so-working-hours.js and lib/so-fms-datetime.js (office hours, no holidays
// — CRM FMS and SO FMS), lib/designApprovalSla.js (office hours with hr-erp's
// holidays) and lib/workingHours.js (the designer's 09:45–18:30, with holidays);
// the boards and several routes inline more copies of the office one. This one
// reproduces the lib/ four minute for minute, rounding included, so a report
// moved onto the registry reads exactly the numbers it read before.
// lib/__tests__/rules-calendar.test.js holds it to that against each of them.
//
// How those clocks count, and therefore how this one does:
//   - A moment first moves to the next working moment: before opening → opening;
//     inside a break → the break's end; at or after closing, or on a closed
//     day → the next working day's opening.
//   - Time is then taken window by window, and each window's share is floored to
//     whole minutes on its own. From 13:00:30 there are 29 minutes before lunch,
//     not 29.5, so 30 working minutes later is 14:01, not 14:00:30.
//   - Adding stops ON a window's end when the minutes run out exactly there:
//     09:30 + 240 is 13:30 and 09:30 + 480 is 18:00 — not the next opening.
//   - Adding 0, a negative or a non-numeric amount still moves to the next
//     working moment.
//
// Where it deliberately differs from them:
//   - IST whatever the process time zone; they read local time and are only
//     right on a host pinned to IST.
//   - A missing or invalid date gives null (or 0 minutes). Today one clock
//     returns null, two throw on null, and all four loop forever on an Invalid
//     Date.
//   - workingMinutesBetween is signed (negative when b is before a), as the two
//     design clocks are; the two office clocks return the size of the gap, which
//     is Math.abs() of this. It never returns -0.
//   - workingDays is honoured as given; the old clocks closed Sunday even if a
//     config listed it. Identical for Monday–Saturday.

import { parseTimeOfDay } from '../org-config.js';
import { CALENDAR_KEYS, HOLIDAY_SOURCES, TIME_ZONE_OFFSET_MINUTES, WINDOW_KEYS } from './contract.js';
import { DAY_MS, MINUTE_MS, isoDayToDayNumber, toEpochMs, weekdayOfDayNumber } from './time.js';
import { childPath, isPlainObject, unknownKeyErrors } from './util.js';

const DAYS_PER_WEEK = 7;
const SUNDAY = 0;
const SATURDAY = 6;

/* ------------------------------ validation ------------------------------ */

function windowErrors(windows) {
  if (!Array.isArray(windows) || windows.length === 0) {
    return [{ path: 'windows', message: 'windows must list at least one working window' }];
  }
  const errors = [];
  let previousEnd = -1;
  windows.forEach((window, index) => {
    const path = childPath('windows', index);
    if (!isPlainObject(window)) {
      errors.push({ path, message: 'a window must be { start, end }' });
      return;
    }
    errors.push(...unknownKeyErrors(window, WINDOW_KEYS, path));
    const start = parseTimeOfDay(window.start);
    const end = parseTimeOfDay(window.end);
    if (start === null) errors.push({ path: `${path}.start`, message: 'start must be HH:MM' });
    if (end === null) errors.push({ path: `${path}.end`, message: 'end must be HH:MM' });
    if (start === null || end === null) return;
    if (end <= start) errors.push({ path, message: 'a window must end after it starts' });
    // Touching windows would floor each half separately and read a minute short.
    else if (start <= previousEnd) errors.push({ path, message: 'windows must be in order, with a break between them' });
    previousEnd = Math.max(previousEnd, end);
  });
  return errors;
}

function workingDayErrors(days) {
  const path = 'workingDays';
  if (!Array.isArray(days) || days.length === 0) return [{ path, message: 'workingDays must list at least one day' }];
  if (days.some((day) => !Number.isInteger(day) || day < SUNDAY || day > SATURDAY)) {
    return [{ path, message: 'workingDays are getDay() numbers: 0 = Sunday, 1 = Monday … 6 = Saturday' }];
  }
  if (new Set(days).size !== days.length) return [{ path, message: 'workingDays must not repeat a day' }];
  return [];
}

/**
 * Everything wrong with a calendar profile, as `{ path, message }` with paths
 * relative to the profile. Empty when createWorkCalendar will accept it.
 */
export function calendarProfileErrors(profile) {
  if (!isPlainObject(profile)) return [{ path: '', message: 'a calendar must be an object' }];
  const errors = [...unknownKeyErrors(profile, CALENDAR_KEYS, '')];
  if (!Object.hasOwn(TIME_ZONE_OFFSET_MINUTES, String(profile.tz))) {
    errors.push({ path: 'tz', message: `tz must be one of: ${Object.keys(TIME_ZONE_OFFSET_MINUTES).join(', ')}` });
  }
  errors.push(...windowErrors(profile.windows), ...workingDayErrors(profile.workingDays));
  if (!Object.values(HOLIDAY_SOURCES).includes(profile.holidays)) {
    errors.push({ path: 'holidays', message: `holidays must be one of: ${Object.values(HOLIDAY_SOURCES).join(', ')}` });
  }
  return errors;
}

/* --------------------------- profiles from code --------------------------- */
// The clocks that predate the registry state their hours as code — lib/org-config.js
// in 'HH:MM', each clock module's WORK_CFG in { h, m } — with weekdays numbered
// 1 = Monday … 7 = Sunday. These read either as a calendar profile, so the
// registry's defaults and a clock's built-in fallback are one and the same.

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = ({ h, m }) => `${pad2(h)}:${pad2(m)}`;

/** A working day as two windows around lunch, from 'HH:MM' times. */
export const windowsAroundLunch = ({ workStart, lunchStart, lunchEnd, workEnd }) => [
  { start: workStart, end: lunchStart },
  { start: lunchEnd, end: workEnd },
];

/** 1 = Monday … 7 = Sunday, as getDay() numbers (Sunday = 0). */
export const isoToJsWeekdays = (isoDays) => isoDays.map((day) => day % DAYS_PER_WEEK);

/**
 * A clock module's WORK_CFG — { tz, workStart: { h, m }, lunchStart, lunchEnd,
 * workEnd, workingDays } — as a calendar profile.
 *
 * @param {object} cfg
 * @param {'hrerp'|'none'} holidays  Where its office holidays come from.
 */
export function profileOfWorkCfg(cfg, holidays) {
  return {
    tz: cfg.tz,
    windows: windowsAroundLunch({
      workStart: hhmm(cfg.workStart),
      lunchStart: hhmm(cfg.lunchStart),
      lunchEnd: hhmm(cfg.lunchEnd),
      workEnd: hhmm(cfg.workEnd),
    }),
    workingDays: isoToJsWeekdays(cfg.workingDays),
    holidays,
  };
}

/**
 * lib/org-config.js's calendar — 'HH:MM' times, ISO weekdays — as a calendar profile.
 *
 * @param {{ timeZone: string, workStart: string, lunchStart: string, lunchEnd: string, workEnd: string, workingDays: number[] }} calendar
 * @param {'hrerp'|'none'} holidays
 */
export function profileOfOrgCalendar(calendar, holidays) {
  return {
    tz: calendar.timeZone,
    windows: windowsAroundLunch(calendar),
    workingDays: isoToJsWeekdays(calendar.workingDays),
    holidays,
  };
}

/* ---------------------------- the clock itself --------------------------- */
// Positions below are "wall" milliseconds: epoch ms plus the zone's offset, so
// UTC arithmetic on them is IST arithmetic. Day numbers count from 1970-01-01.

const at = (day, minute) => day * DAY_MS + minute * MINUTE_MS;
const dayOf = (wall) => Math.floor(wall / DAY_MS);
const minuteOf = (wall) => Math.floor((wall - dayOf(wall) * DAY_MS) / MINUTE_MS);

/** The window a minute of the day falls in, or -1. */
const windowIndexAt = (clock, minute) => clock.windows.findIndex((w) => minute >= w.start && minute < w.end);

/** The window whose following break a minute falls in, or -1. */
const breakIndexAt = (clock, minute) =>
  clock.windows.findIndex((w, i) => i + 1 < clock.windows.length && minute >= w.end && minute < clock.windows[i + 1].start);

function nextOpenDay(clock, day) {
  let next = day + 1;
  while (!clock.isOpenDay(next)) next += 1;
  return next;
}

/** The first working moment at or after `wall` — the old moveToNextWorkStart, step for step. */
function nextWorkStart(clock, wall) {
  let day = dayOf(wall);
  let cur = Math.max(wall, at(day, clock.opening));
  const breakIndex = breakIndexAt(clock, minuteOf(cur));
  if (breakIndex >= 0) cur = at(day, clock.windows[breakIndex + 1].start);
  if (cur >= at(day, clock.closing)) {
    day += 1;
    cur = at(day, clock.opening);
  }
  if (!clock.isOpenDay(day)) {
    day = nextOpenDay(clock, day);
    cur = at(day, clock.opening);
  }
  return cur;
}

function addMinutes(clock, wall, amount) {
  let cur = nextWorkStart(clock, wall);
  let left = amount;
  while (left > 0) {
    const day = dayOf(cur);
    const index = windowIndexAt(clock, minuteOf(cur));
    if (!clock.isOpenDay(day) || index < 0) {
      cur = nextWorkStart(clock, cur);
      continue;
    }
    // A whole working day from its opening is what walking its windows would
    // use up. Strictly more than a day, so a last full day still ends at closing.
    if (left > clock.minutesPerDay && cur === at(day, clock.opening)) {
      left -= clock.minutesPerDay;
      cur = at(nextOpenDay(clock, day), clock.opening);
      continue;
    }
    const windowEnd = at(day, clock.windows[index].end);
    const available = Math.floor((windowEnd - cur) / MINUTE_MS);
    if (left <= available) return cur + left * MINUTE_MS;
    left -= available;
    const isLastWindow = index + 1 === clock.windows.length;
    cur = isLastWindow ? at(day + 1, clock.opening) : at(day, clock.windows[index + 1].start);
  }
  return cur;
}

/** Working minutes from `from` to `to` within one day, each window floored on its own. */
function workedWithinDay(clock, from, to) {
  const day = dayOf(from);
  let cur = from;
  let total = 0;
  for (const window of clock.windows) {
    const windowStart = at(day, window.start);
    const windowEnd = at(day, window.end);
    if (cur >= windowEnd) continue;
    if (cur < windowStart) cur = windowStart;
    if (cur >= to) break;
    total += Math.floor((Math.min(windowEnd, to) - cur) / MINUTE_MS);
  }
  return total;
}

/** Open days in [fromDay, toDay), counted rather than walked. */
function countOpenDays(clock, fromDay, toDay) {
  if (toDay <= fromDay) return 0;
  const fullWeeks = Math.floor((toDay - fromDay) / DAYS_PER_WEEK);
  let count = fullWeeks * clock.weekdays.size;
  for (let day = fromDay + fullWeeks * DAYS_PER_WEEK; day < toDay; day += 1) {
    if (clock.weekdays.has(weekdayOfDayNumber(day))) count += 1;
  }
  // A holiday only takes away a day the office would otherwise have opened.
  clock.closedDays.forEach((day) => {
    if (day >= fromDay && day < toDay && clock.weekdays.has(weekdayOfDayNumber(day))) count -= 1;
  });
  return count;
}

/**
 * The partial first and last days are walked, so their minute-level rounding is
 * the old clocks'; every whole day between them is counted. Walking those is
 * what made a six-month-overdue step cost hundreds of iterations on the boards.
 */
function workedBetween(clock, fromWall, toWall) {
  const start = nextWorkStart(clock, fromWall);
  if (start >= toWall) return 0;
  const startDay = dayOf(start);
  const endDay = dayOf(toWall);
  if (startDay === endDay) return workedWithinDay(clock, start, toWall);
  const firstDay = workedWithinDay(clock, start, at(startDay, clock.closing));
  const middleDays = countOpenDays(clock, startDay + 1, endDay) * clock.minutesPerDay;
  const lastDay = clock.isOpenDay(endDay) ? workedWithinDay(clock, at(endDay, clock.opening), toWall) : 0;
  return firstDay + middleDays + lastDay;
}

/**
 * hr-erp sends `{ date, name }`; lib/work-calendar hands out bare 'YYYY-MM-DD'.
 * Both are read, trimmed as lib/work-calendar.js setHolidays trims them: a
 * ' 2026-10-02 ' typed into hr-erp's holiday list closes the same day here.
 */
function holidayDayNumbers(holidays) {
  const days = new Set();
  (Array.isArray(holidays) ? holidays : []).forEach((entry) => {
    const text = isPlainObject(entry) ? entry.date : entry;
    const day = isoDayToDayNumber(typeof text === 'string' ? text.trim() : text);
    if (day !== null) days.add(day);
  });
  return days;
}

function buildClock(profile, holidays) {
  const windows = profile.windows.map(({ start, end }) => ({ start: parseTimeOfDay(start), end: parseTimeOfDay(end) }));
  const weekdays = new Set(profile.workingDays);
  const closed = profile.holidays === HOLIDAY_SOURCES.HRERP ? holidayDayNumbers(holidays) : new Set();
  return {
    offsetMs: TIME_ZONE_OFFSET_MINUTES[profile.tz] * MINUTE_MS,
    windows,
    opening: windows[0].start,
    closing: windows[windows.length - 1].end,
    minutesPerDay: windows.reduce((sum, w) => sum + (w.end - w.start), 0),
    weekdays,
    closedDays: [...closed],
    isOpenDay: (day) => weekdays.has(weekdayOfDayNumber(day)) && !closed.has(day),
  };
}

/**
 * A working-hour clock for one calendar profile.
 *
 * @param {import('./contract.js').CalendarProfile} profile
 * @param {Array<string|{ date: string }>} [holidays]  IST days the office is shut
 *   ('YYYY-MM-DD'); used only when profile.holidays is 'hrerp'.
 * @returns {{
 *   addWorkingMinutes: (date: Date|number|string, minutes: number) => Date|null,
 *   workingMinutesBetween: (a: Date|number|string, b: Date|number|string) => number,
 *   isWorkingDay: (date: Date|number|string) => boolean,
 *   minutesPerDay: number,
 *   openingMinute: number,
 *   closingMinute: number,
 * }}
 * @throws {TypeError} when the profile is invalid (see calendarProfileErrors).
 */
export function createWorkCalendar(profile, holidays = []) {
  const problems = calendarProfileErrors(profile);
  if (problems.length > 0) {
    const detail = problems.map(({ path, message }) => (path ? `${path}: ${message}` : message)).join('; ');
    throw new TypeError(`Invalid work calendar — ${detail}`);
  }
  const clock = buildClock(profile, holidays);

  return Object.freeze({
    minutesPerDay: clock.minutesPerDay,
    // When the working day opens and closes, in minutes after midnight: the
    // boards snap a day-only deadline to the close and a start to the opening.
    openingMinute: clock.opening,
    closingMinute: clock.closing,

    addWorkingMinutes(date, minutes) {
      const ms = toEpochMs(date);
      // Clamped and floored exactly as the old clocks were, so NaN or a negative
      // amount adds nothing but still moves to the next working moment.
      const amount = Math.max(0, Math.floor(minutes));
      // Infinity would never run out; the old clocks spun on it forever.
      if (ms === null || amount === Infinity) return null;
      return new Date(addMinutes(clock, ms + clock.offsetMs, amount) - clock.offsetMs);
    },

    workingMinutesBetween(a, b) {
      const from = toEpochMs(a);
      const to = toEpochMs(b);
      if (from === null || to === null) return 0;
      const total = workedBetween(clock, Math.min(from, to) + clock.offsetMs, Math.max(from, to) + clock.offsetMs);
      return to >= from || total === 0 ? total : -total;
    },

    isWorkingDay(date) {
      const ms = toEpochMs(date);
      return ms !== null && clock.isOpenDay(dayOf(ms + clock.offsetMs));
    },
  });
}
