// VERBATIM COPY of CRM lib/scoring/period.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * Period helpers — one source for the week / month / custom window and the
 * canonical periodKey.
 *
 * Extracted from the Sales scorecard so the unified Scoreboard derives an
 * IDENTICAL [start, end] window and — critically — the SAME periodKey, so the
 * Sales section binds to the exact manually-entered Enquiry numbers a manager
 * typed for that week / month / range. Changing the key format here without
 * matching the Sales scorecard would silently unbind those numbers.
 */

// "Last Month" is the closed month a monthly incentive is judged on — without it
// the month just ended was reachable only through a hand-typed custom range.
export const PERIOD_MODES = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'custom', label: 'Custom' },
];

export const startOfWeek = (d) => {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
};

export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

// Format from LOCAL calendar components (not toISOString/UTC) so the seeded
// custom-range dates match the user's local day, not a UTC-shifted one.
export const toDateInput = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Window for a mode. Week / month both end at "now" (a period never scores the
 * future); last month is the whole previous calendar month, ending 23:59:59 on
 * its last day exactly as a custom range does; custom spans the two picked days.
 */
export const rangeForPeriod = (mode, customStart, customEnd, now = new Date()) => {
  if (mode === 'week') return { start: startOfWeek(now), end: now };
  if (mode === 'month') return { start: startOfMonth(now), end: now };
  if (mode === 'lastMonth') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
    };
  }
  return {
    start: new Date(`${customStart}T00:00:00`),
    end: new Date(`${customEnd}T23:59:59`),
  };
};

/**
 * Canonical key for the selected period. MUST match the Sales scorecard
 * (app/(app)/sales-report/page.jsx · periodKeyFor) so enquiry numbers bind.
 * Last month keys as month_YYYY-MM of its start — the key coordinators
 * self-submit that month's enquiries under.
 */
export const periodKeyFor = (mode, range) => {
  if (mode === 'week') return `week_${toDateInput(range.start)}`;
  if (mode === 'custom') return `custom_${toDateInput(range.start)}_${toDateInput(range.end)}`;
  return `month_${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, '0')}`;
};

const MONTH_KEY = /^month_(\d{4})-(\d{2})$/;
const CUSTOM_KEY = /^custom_(\d{4})-(\d{2})-(\d{2})_(\d{4})-(\d{2})-(\d{2})$/;
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The calendar month a period key stands for, or null: month_YYYY-MM (This
 * Month, Last Month), or a custom range covering exactly one whole month. The
 * key reads the same in every time zone, unlike the period's start/end instants,
 * which the browser builds from its own local midnight.
 */
export const monthOfPeriodKey = (periodKey) => {
  const key = String(periodKey || '').trim();
  const month = MONTH_KEY.exec(key);
  if (month) {
    const m = Number(month[2]) - 1;
    return m >= 0 && m <= 11 ? { year: Number(month[1]), month: m } : null;
  }
  const custom = CUSTOM_KEY.exec(key);
  if (!custom) return null;
  const [, y1, m1, d1, y2, m2, d2] = custom;
  const m = Number(m1) - 1;
  if (m < 0 || m > 11 || y1 !== y2 || m1 !== m2 || d1 !== '01') return null;
  const lastDay = new Date(Date.UTC(Number(y1), m + 1, 0)).getUTCDate();
  return Number(d2) === lastDay ? { year: Number(y1), month: m } : null;
};

/**
 * Every key a period's enquiry numbers can sit under. A whole calendar month has
 * two — month_YYYY-MM (This Month / Last Month, where coordinators self-submit)
 * and the full-month custom key management types closed months under — and
 * either view reads both, so one month never scores two different counts.
 */
export const enquiryKeyCandidates = (periodKey) => {
  const month = monthOfPeriodKey(periodKey);
  if (!month) return [periodKey];
  const ym = `${month.year}-${pad2(month.month + 1)}`;
  const lastDay = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  return [`month_${ym}`, `custom_${ym}-01_${ym}-${pad2(lastDay)}`];
};

/** When a coordinator's month holds an entry under both keys, the later write counts. */
export const newerEnquiry = (current, candidate) =>
  (!current || candidate.writtenAt > current.writtenAt ? candidate : current);

/** Inclusive [start, end] test — does a plan / due date fall inside the period? */
export const inRange = (date, range) => {
  if (!date) return false;
  if (range?.start && date < range.start) return false;
  if (range?.end && date > range.end) return false;
  return true;
};
