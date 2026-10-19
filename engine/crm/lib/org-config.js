// VERBATIM COPY of CRM lib/org-config.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/org-config.js
//
// What is true about THIS organisation, as data rather than as code.
//
// The app was built for one rice exporter and says so everywhere: spreadsheet
// ids in each route, a 9:30–18:00 Monday–Saturday calendar in Asia/Kolkata, an
// April financial year, PI numbers as YY+NNN, super admins listed by email.
// None of that is wrong — it is the domain knowledge that makes the app useful
// — but all of it belongs to one company, and the next company will differ.
//
// This module is the shape of those facts and their current values. Nothing
// here reads a database or a network: it is defaults, merging and validation,
// so it can be tested and so a caller can never be handed a half-formed config.
//
// The defaults ARE today's behaviour, on purpose. A missing config document, a
// failed read, a new environment — all resolve to exactly what the app does
// now, and adopting the layer changes nothing until someone edits a value.

/** Everything the app currently assumes, written down. */
export const DEFAULT_ORG_CONFIG = Object.freeze({
  orgId: 'shazia',
  orgName: 'Shazia Rice',

  /** The working-hours calendar every SLA and delay is measured against. */
  calendar: Object.freeze({
    timeZone: 'Asia/Kolkata',
    workStart: '09:30',
    workEnd: '18:00',
    lunchStart: '13:30',
    lunchEnd: '14:00',
    /** 1 = Monday … 7 = Sunday. */
    workingDays: Object.freeze([1, 2, 3, 4, 5, 6]),
    /** 'YYYY-MM-DD' dates the office is shut. */
    holidays: Object.freeze([]),
  }),

  /** How a PI number is built, and when the sequence restarts. */
  numbering: Object.freeze({
    /** 1 = January … 12 = December. India's financial year opens in April. */
    financialYearStartMonth: 4,
    piSequenceDigits: 3,
  }),

  /** Identity that cannot live in a role: the accounts that bootstrap the rest. */
  access: Object.freeze({
    superAdminEmails: Object.freeze([]),
  }),
});

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'HH:MM' → minutes since midnight, or null when it is not a time. */
export function parseTimeOfDay(value) {
  const match = TIME.exec(String(value ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Everything wrong with a config, as sentences.
 *
 * Returned rather than thrown: the caller decides whether a bad value means
 * "refuse to save" (a settings screen) or "fall back to the defaults and carry
 * on" (a server that must still answer requests).
 */
export function validateOrgConfig(config) {
  const problems = [];
  const { calendar, numbering } = config || {};

  const start = parseTimeOfDay(calendar?.workStart);
  const end = parseTimeOfDay(calendar?.workEnd);
  const lunchStart = parseTimeOfDay(calendar?.lunchStart);
  const lunchEnd = parseTimeOfDay(calendar?.lunchEnd);

  if (start === null) problems.push('workStart must be HH:MM');
  if (end === null) problems.push('workEnd must be HH:MM');
  if (start !== null && end !== null && end <= start) {
    problems.push('workEnd must be after workStart');
  }

  // A lunch break outside working hours would silently subtract nothing, and
  // every SLA would quietly run half an hour long.
  if (calendar?.lunchStart || calendar?.lunchEnd) {
    if (lunchStart === null || lunchEnd === null) {
      problems.push('lunchStart and lunchEnd must both be set, or neither');
    } else if (lunchEnd <= lunchStart) {
      problems.push('lunchEnd must be after lunchStart');
    } else if (start !== null && end !== null && (lunchStart < start || lunchEnd > end)) {
      problems.push('the lunch break must fall inside working hours');
    }
  }

  const days = calendar?.workingDays;
  if (!Array.isArray(days) || days.length === 0) {
    problems.push('workingDays must list at least one day');
  } else if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    problems.push('workingDays must be numbers 1 (Monday) to 7 (Sunday)');
  }

  const holidays = calendar?.holidays;
  if (!Array.isArray(holidays)) {
    problems.push('holidays must be a list');
  } else if (holidays.some((h) => !ISO_DATE.test(String(h)))) {
    problems.push('every holiday must be YYYY-MM-DD');
  }

  const fyMonth = numbering?.financialYearStartMonth;
  if (!Number.isInteger(fyMonth) || fyMonth < 1 || fyMonth > 12) {
    problems.push('financialYearStartMonth must be 1–12');
  }

  const digits = numbering?.piSequenceDigits;
  if (!Number.isInteger(digits) || digits < 1 || digits > 6) {
    problems.push('piSequenceDigits must be 1–6');
  }

  return problems;
}

/**
 * Fold a stored config over the defaults, one section at a time.
 *
 * Section-wise rather than deep-merged: a stored `calendar` that names only
 * `holidays` keeps the default hours, but an array is replaced wholesale —
 * merging two lists of working days would produce a week nobody chose.
 */
export function mergeOrgConfig(stored) {
  if (!isPlainObject(stored)) return DEFAULT_ORG_CONFIG;

  return {
    ...DEFAULT_ORG_CONFIG,
    ...stored,
    calendar: { ...DEFAULT_ORG_CONFIG.calendar, ...(isPlainObject(stored.calendar) ? stored.calendar : {}) },
    numbering: { ...DEFAULT_ORG_CONFIG.numbering, ...(isPlainObject(stored.numbering) ? stored.numbering : {}) },
    access: { ...DEFAULT_ORG_CONFIG.access, ...(isPlainObject(stored.access) ? stored.access : {}) },
  };
}

/**
 * The config to actually use, and what was wrong with what was stored.
 *
 * An invalid stored config falls back to the defaults ENTIRELY rather than
 * cherry-picking the valid halves: half a calendar is not a calendar, and a
 * board silently measuring against a mixture of two would be harder to explain
 * than one that measures against the values it has always used.
 */
export function resolveOrgConfig(stored) {
  const merged = mergeOrgConfig(stored);
  const problems = validateOrgConfig(merged);
  return problems.length > 0
    ? { config: DEFAULT_ORG_CONFIG, problems, usedDefaults: true }
    : { config: merged, problems: [], usedDefaults: false };
}

/**
 * The financial year a date belongs to, as the two digits a PI number opens
 * with.
 *
 * The prefix is the year the financial year STARTS, and that is measured, not
 * assumed: the PI Data sheet holds 25xxx raised from 1 Apr 2025 and 26xxx from
 * 1 Apr 2026. Naming it for the year it ends in would have September 2026
 * issuing 27001 and abandoning a series that is mid-run.
 */
export function financialYearYY(date, config = DEFAULT_ORG_CONFIG) {
  const startMonth = config?.numbering?.financialYearStartMonth ?? 4;
  const year = date.getFullYear();
  const fy = date.getMonth() + 1 >= startMonth ? year : year - 1;
  return String(fy).slice(-2);
}
