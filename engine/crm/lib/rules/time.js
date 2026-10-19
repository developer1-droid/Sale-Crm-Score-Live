// VERBATIM COPY of CRM lib/rules/time.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/time.js
//
// Instants and calendar days, computed in IST whatever time zone the process
// runs in.
//
// The boards were written against IST local time and the server pins TZ to
// match (instrumentation.js), but a script, a test runner or a new host does
// not. Everything here works on epoch milliseconds plus a fixed offset and reads
// only UTC fields, so a cutoff or a working day lands on the same instant on any
// machine.

import { TIME_ZONE_OFFSET_MINUTES } from './contract.js';

export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
export const IST_OFFSET_MS = TIME_ZONE_OFFSET_MINUTES['Asia/Kolkata'] * MINUTE_MS;

/** 1 January 1970, day 0 of the count, was a Thursday (getDay() 4). */
const EPOCH_WEEKDAY = 4;
const DAYS_PER_WEEK = 7;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** An ISO date-time that says which zone it is in; one without a zone is read as local time. */
const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 'YYYY-MM-DD' → days since 1970-01-01, or null when it is not a real date
 * (2026-02-30 is refused, not rolled into March).
 */
export function isoDayToDayNumber(text) {
  const match = ISO_DAY.exec(String(text ?? ''));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  const isSameDay = back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return isSameDay ? ms / DAY_MS : null;
}

/** True for a real 'YYYY-MM-DD' calendar date. */
export const isIsoDay = (text) => isoDayToDayNumber(text) !== null;

/** getDay() of a day number: 0 = Sunday … 6 = Saturday. */
export const weekdayOfDayNumber = (day) =>
  ((((day + EPOCH_WEEKDAY) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK);

/** The instant an IST calendar day starts, in epoch ms; null for a bad day. */
export function istMidnightMs(text) {
  const day = isoDayToDayNumber(text);
  return day === null ? null : day * DAY_MS - IST_OFFSET_MS;
}

/** A Date from any realm — Jest suites and Node globals build theirs separately. */
const isDate = (value) => Object.prototype.toString.call(value) === '[object Date]';

/**
 * Epoch milliseconds for a Date, a millisecond count, a zoned ISO string or a
 * Firestore Timestamp; null for anything else.
 *
 * A zone-less date string is refused on purpose: `new Date('2026-05-13 10:00')`
 * means a different instant on every host, and the caller — who knows which
 * sheet format it came from — is the one to read it.
 */
export function toEpochMs(value) {
  if (isDate(value)) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (!ZONED_ISO.test(value.trim())) return null;
    const ms = Date.parse(value.trim());
    return Number.isFinite(ms) ? ms : null;
  }
  if (value && typeof value.toDate === 'function') return toEpochMs(value.toDate());
  return null;
}
