// VERBATIM COPY of CRM lib/mis/period.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/period.js
//
// MIS periods — Monday-to-Sunday weeks and calendar months on the IST calendar
// the office plans on, whatever the server's or browser's timezone (owner
// decision #2).
//
// Ported from hr-erp lib/mis/period.ts, unchanged in behaviour. Kept apart from
// lib/scoring/period.js on purpose: that module is the Sales scorecard's
// browser-local window and periodKey, which the Sales Coordinator score binds
// its enquiry numbers to, and it must not move.
//
// Pure, client-safe, no imports.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const DAYS_IN_WEEK = 7;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @typedef {'this-week'|'last-week'|'this-month'|'last-month'} MisPeriodPreset */

export const MIS_PRESET = Object.freeze({
  THIS_WEEK: 'this-week',
  LAST_WEEK: 'last-week',
  THIS_MONTH: 'this-month',
  LAST_MONTH: 'last-month',
});

/** @type {ReadonlyArray<{ key: MisPeriodPreset, label: string }>} */
export const MIS_PRESETS = Object.freeze([
  Object.freeze({ key: MIS_PRESET.THIS_WEEK, label: 'This week' }),
  Object.freeze({ key: MIS_PRESET.LAST_WEEK, label: 'Last week' }),
  Object.freeze({ key: MIS_PRESET.THIS_MONTH, label: 'This month' }),
  Object.freeze({ key: MIS_PRESET.LAST_MONTH, label: 'Last month' }),
]);

/** An IST calendar day as a UTC-midnight Date — day arithmetic with no timezone in it. */
function istDayOf(at) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

const dayString = (day) => day.toISOString().slice(0, 10);

const addDays = (day, days) => new Date(day.getTime() + days * DAY_MS);

/** Today on the IST calendar, as `YYYY-MM-DD`. */
export function istToday(now) {
  return dayString(istDayOf(now));
}

/** A real `YYYY-MM-DD`, or null — 2026-02-30 is not one. */
export function parseMisDay(value) {
  const match = ISO_DAY.exec(String(value ?? '').trim());
  if (!match) return null;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return dayString(day) === match[0] ? match[0] : null;
}

/**
 * The period a preset names, as of `now`.
 * @param {MisPeriodPreset} preset
 * @param {Date} now
 * @returns {import('./types').MisPeriod}
 */
export function presetPeriod(preset, now) {
  const today = istDayOf(now);
  const monday = addDays(today, -((today.getUTCDay() + 6) % DAYS_IN_WEEK));
  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  switch (preset) {
    case MIS_PRESET.THIS_WEEK:
      return { from: dayString(monday), to: dayString(addDays(monday, DAYS_IN_WEEK - 1)) };
    case MIS_PRESET.LAST_WEEK:
      return { from: dayString(addDays(monday, -DAYS_IN_WEEK)), to: dayString(addDays(monday, -1)) };
    case MIS_PRESET.THIS_MONTH: {
      const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
      return { from: dayString(firstOfMonth), to: dayString(addDays(next, -1)) };
    }
    case MIS_PRESET.LAST_MONTH: {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      return { from: dayString(first), to: dayString(addDays(firstOfMonth, -1)) };
    }
    default:
      return undefined;
  }
}

/** The preset a period is, if it is one — so the picker can show it as chosen. */
export function presetOf(period, now) {
  const preset = MIS_PRESETS.find((p) => {
    const candidate = presetPeriod(p.key, now);
    return candidate.from === period.from && candidate.to === period.to;
  });
  return preset?.key ?? null;
}

/** A period from `from` / `to` query values; this week when either is missing or wrong. */
export function periodFromQuery(from, to, now) {
  const start = parseMisDay(from);
  const end = parseMisDay(to);
  if (!start || !end) return presetPeriod(MIS_PRESET.THIS_WEEK, now);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/** [start, end) as instants: IST midnight of the first day to IST midnight after the last. */
export function periodBounds(period) {
  const start = new Date(`${period.from}T00:00:00+05:30`);
  const end = new Date(new Date(`${period.to}T00:00:00+05:30`).getTime() + DAY_MS);
  return { start, end };
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const YEAR_MONTH_LENGTH = 'YYYY-MM'.length;
const YEAR_LENGTH = 'YYYY'.length;

/** "6 – 12 Oct 2026", "28 Sept – 4 Oct 2026", "5 Oct 2026". */
export function periodLabel(period) {
  const from = new Date(`${period.from}T00:00:00Z`);
  const to = new Date(`${period.to}T00:00:00Z`);
  if (period.from === period.to) return DAY_MONTH_YEAR.format(from);
  const sameMonth = period.from.slice(0, YEAR_MONTH_LENGTH) === period.to.slice(0, YEAR_MONTH_LENGTH);
  const sameYear = period.from.slice(0, YEAR_LENGTH) === period.to.slice(0, YEAR_LENGTH);
  const head = sameMonth ? String(from.getUTCDate()) : sameYear ? DAY_MONTH.format(from) : DAY_MONTH_YEAR.format(from);
  return `${head} – ${DAY_MONTH_YEAR.format(to)}`;
}
