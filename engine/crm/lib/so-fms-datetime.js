// VERBATIM COPY of CRM lib/so-fms-datetime.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/so-fms-datetime.js
//
// Reading a date off a sheet, and counting working hours between two of them.
//
// Lifted out of app/(app)/pi/sofms/page.jsx unchanged. It sat there only
// because that is where it was first needed; nothing in it touches React, and
// the board's transform — which is what actually makes a cold load slow — can
// only move off the browser once its primitives can be imported on their own.
//
// The working-hour clock itself is the office calendar of the rules registry
// (lib/work-clock.js): every helper below the calendar line reads it, so an
// hour or a holiday edited in Settings > Report Rules moves the board too.
//
// One cache lives here on purpose. Sheet timestamps repeat heavily across
// rows, so parsing is memoised at module scope. parseDT stores milliseconds
// rather than Date objects: several callers mutate the date they get back,
// which would corrupt a shared instance.

import { DAY_MS, IST_OFFSET_MS, MINUTE_MS } from './rules/time.js';
import { officeClock } from './work-clock.js';

// Same date helpers as before
// Cache of parsed timestamps (ms) for string inputs. Storing ms instead of Date
// objects so each caller gets a fresh mutable Date — some helpers (setHM, etc.)
// mutate via .setHours which would corrupt a shared cached instance.
const __parseDTCache = new Map();
const PARSE_DT_CACHE_LIMIT = 50000;

/* Google Sheets stores dates as serial numbers (days since 1899-12-30). When a
   date cell loses its date number-format, the API returns the raw serial (e.g.
   "46209.48226" = 2026-07-06 11:34) instead of a formatted string, and bare
   `new Date(serial)` yields Invalid Date. Convert serials in the plausible
   1970–2173 range so a mis-formatted approval timestamp still parses. Mirrors
   the pc-report route's parser so the SO-FMS board and PC report agree. */
const GSHEET_SERIAL_MIN = 25569; // 1970-01-01
const GSHEET_SERIAL_MAX = 100000; // ~2173
const serialToDate = (serial) => {
  if (!Number.isFinite(serial) || serial < GSHEET_SERIAL_MIN || serial >= GSHEET_SERIAL_MAX) return null;
  const utcDays = Math.floor(serial - 25569);
  const sec = Math.round(86400 * (serial - Math.floor(serial)));
  const base = new Date(utcDays * 86400 * 1000);
  const d = new Date(
    base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(),
    Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60
  );
  return isNaN(d.getTime()) ? null : d;
};

const __parseDTString = (value) => {
  // Pure Google Sheets serial number (e.g. "46209.48226") — a date cell whose
  // number format was lost, so the sheet returns the raw serial. Convert before
  // the native Date() fallback, which can't parse it.
  if (/^\d+(\.\d+)?$/.test(value)) {
    const serialDate = serialToDate(parseFloat(value));
    if (serialDate) return serialDate;
  }
  // Smart slash/dash format detection. Sheet sometimes gives US-format
  // "MM/DD/YYYY" (e.g. "05/13/2026"), sometimes DD/MM/YYYY (India). Pick
  // by impossible-month-value if one of the two is >12; otherwise fall to
  // native Date(value) which JS engines parse as MM/DD/YYYY for slash form.
  const parts = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)$/);
  if (parts) {
    const a = parseInt(parts[1], 10);
    const b = parseInt(parts[2], 10);
    const year = parseInt(parts[3], 10);
    const rest = parts[4].trim();

    let day, month;
    if (a > 12 && b <= 12) {
      day = a; month = b - 1;
    } else if (b > 12 && a <= 12) {
      day = b; month = a - 1;
    } else {
      day = null;
    }

    if (day !== null) {
      const d = new Date(year, month, day);
      if (rest) {
        const timeParts = rest.match(/(\d{1,2}):(\d{1,2}):?(\d{1,2})?/);
        if (timeParts) {
          d.setHours(parseInt(timeParts[1], 10) || 0);
          d.setMinutes(parseInt(timeParts[2], 10) || 0);
          d.setSeconds(parseInt(timeParts[3], 10) || 0);
        }
      }
      if (!isNaN(d.getTime())) return d;
    }
  }
  const d = new Date(value);
  return !isNaN(d.getTime()) ? d : null;
};

export const parseDT = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    const d = value.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    const d = new Date(
      value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6)
    );
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "number") {
    // A Google Sheets serial (days since 1899-12-30) takes priority over the
    // unix-epoch reading — a real app timestamp is never in the 1970 range.
    const serialDate = serialToDate(value);
    if (serialDate) return serialDate;
    const ms = value < 2e10 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    if (__parseDTCache.has(value)) {
      const ms = __parseDTCache.get(value);
      return ms === null ? null : new Date(ms);
    }
    const result = __parseDTString(value);
    if (__parseDTCache.size > PARSE_DT_CACHE_LIMIT) __parseDTCache.clear();
    __parseDTCache.set(value, result ? result.getTime() : null);
    return result;
  }
  return null;
};

/* The Dispatch Planning sheet stores Indian-locale DD/MM/YYYY (optionally with
   a HH:MM:SS time). parseDT can't disambiguate when both the day and month are
   ≤ 12 — it defers to native Date(), which reads slash dates as US MM/DD. That
   flips e.g. "05/07/2026" (5 July) to 7 May, and fmtDT then re-renders it
   day-first as "07/05/2026", a silent double swap. Parse these day-first
   explicitly so downstream code gets the right instant. Non-slash inputs
   (ISO, serials, Date objects) fall through to parseDT unchanged. */
export const parseDayFirstDT = (value) => {
  if (typeof value === "string") {
    const m = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)$/);
    if (m) {
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const year = parseInt(m[3], 10);
      if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
        const d = new Date(year, month, day);
        const t = m[4].trim().match(/(\d{1,2}):(\d{1,2}):?(\d{1,2})?/);
        if (t) d.setHours(parseInt(t[1], 10) || 0, parseInt(t[2], 10) || 0, parseInt(t[3], 10) || 0);
        if (!isNaN(d.getTime())) return d;
      }
    }
  }
  return parseDT(value);
};

export const toIST = (value = new Date()) => {
  const d = parseDT(value);
  return d || new Date();
};

export const fmtDT = (date) => {
  try {
    const d = parseDT(date);
    if (!d) return 'Not set';

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    return 'Invalid date';
  }
};

/* Google Form multi-file uploads store several Drive URLs comma-joined in a
   single sheet cell (e.g. "https://drive.google.com/open?id=A, https://.../open?id=B").
   Split into individual valid links so each image opens on its own. */
export const splitDriveUrls = (raw) =>
  String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));

/* -------------------------- Working Hours Calendar ------------------------- */
// The office calendar of the rules (lib/work-clock.js officeClock): by default
// Mon–Sat 09:30–18:00 with lunch 13:30–14:00, and HR-ERP's holidays once the
// rules' office calendar says so. Days here are IST calendar days, as the
// clock's are; the server and the office browsers keep local time in IST, so
// they are the local days these helpers always read.

/** The IST calendar day `ms` falls on, as the instant it starts. */
const istDayStart = (ms) => Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
/** That day at a minute after midnight. */
const atMinute = (dayStart, minute) => new Date(dayStart + minute * MINUTE_MS);

const isWorkingDay = (d) => officeClock().isWorkingDay(d);

export const within = (d, sh, sm, eh, em) => {
  const t = d.getHours() * 60 + d.getMinutes();
  const a = sh * 60 + sm, b = eh * 60 + em;
  return t >= a && t < b;
};

/**
 * Is this date a day the desk is open? Exported because the Step-11 follow-up
 * schedule generates a run of dates and has to drop the closed ones; without it
 * that module would have to re-state which days are working days, and the two
 * would drift.
 */
export const isWorkingDate = (value) => {
  const d = parseDT(value);
  return d ? isWorkingDay(d) : false;
};

/** `minutes` of working time after `d` (the next working moment for 0); null for no date. */
export const addWorkingMinutes = (d, minutes) => (d ? officeClock().addWorkingMinutes(d, minutes) : null);

/**
 * Working minutes between two instants. Order does not matter — this is a gap,
 * not a direction; callers that care which way round it is check that first.
 */
export const workingMinutesBetween = (a, b) => {
  if (!a || !b) return 0;
  return Math.abs(officeClock().workingMinutesBetween(a, b));
};

/** `days` working days before the date, at the close of that day. */
export const subtractWorkingDays = (startDate, days) => {
  const d = parseDT(startDate);
  if (!d) return null;
  let dayStart = istDayStart(d.getTime());
  let daysLeft = Math.max(0, days);
  while (daysLeft > 0) {
    dayStart -= DAY_MS;
    if (isWorkingDay(dayStart)) daysLeft -= 1;
  }
  // Snap to the close of that target working day (typically 18:00).
  return atMinute(dayStart, officeClock().closingMinute);
};

/**
 * Pull a moment onto the office clock: Mon–Sat, 09:30 to 18:00.
 *
 * A planned time is something a person is expected to act on, so it cannot sit
 * at 22:40 on a Sunday. Anything before the day starts moves to the opening;
 * anything after it ends, or on a closed day, moves to the next working day's
 * opening.
 *
 * It moves FORWARD, unlike `previousWorkingDay`, because the moments that need
 * it are chase START points — the signed PI landing at midnight means the chase
 * begins next morning, not the Saturday before.
 */
export const toNextWorkingMoment = (value) => {
  const parsed = parseDT(value);
  if (!parsed) return null;
  const clock = officeClock();
  let cur = parsed.getTime();
  // A fortnight is far more than the longest closed stretch; it only bounds the
  // loop so a bad date cannot spin here.
  for (let i = 0; i < 14; i += 1) {
    const dayStart = istDayStart(cur);
    if (isWorkingDay(cur)) {
      const opens = atMinute(dayStart, clock.openingMinute);
      if (cur < opens.getTime()) return opens;
      if (cur <= atMinute(dayStart, clock.closingMinute).getTime()) return new Date(cur);
    }
    cur = atMinute(dayStart + DAY_MS, clock.openingMinute).getTime();
  }
  return null;
};

/**
 * Move a date by whole CALENDAR days — negative goes back — and land on the
 * close of that day.
 *
 * The payment follow-up rules are written in calendar days ("15 days before the
 * vessel's arrival", "7 days after"), and `subtractWorkingDays` above cannot
 * express them: it skips Sundays, so "15 days before" would silently land two
 * and a half weeks out. A voyage does not pause on a Sunday, so neither does
 * the count. The close-of-day snap is shared with `subtractWorkingDays` on
 * purpose, so a delay measured against either kind of planned date means the
 * same thing.
 *
 * The arrival column this is counted from is a date with no time, so the hour
 * here is a convention, not data.
 */
export const shiftCalendarDays = (startDate, days) => {
  const parsed = parseDT(startDate);
  if (!parsed) return null;
  return atMinute(istDayStart(parsed.getTime()) + Math.trunc(days || 0) * DAY_MS, officeClock().closingMinute);
};

/**
 * The working day on or before this date, at the close of business.
 *
 * A deadline that falls on a Sunday is not a deadline — nobody is there to meet
 * it. Planned dates derived in calendar days move BACKWARDS onto the previous
 * working day rather than forwards, so the work is due before the closed day
 * rather than after it.
 */
export const previousWorkingDay = (date) => {
  const parsed = parseDT(date);
  if (!parsed) return null;
  let dayStart = istDayStart(parsed.getTime());
  while (!isWorkingDay(dayStart)) dayStart -= DAY_MS;
  return atMinute(dayStart, officeClock().closingMinute);
};
