// VERBATIM COPY of CRM score-live/engine/crmPeriods.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// CRM Executive Report period filter (hooks/useMisSteps.js TIME_OPTS → rangeOf:
// rolling windows that end today 23:59:59 IST) plus a TV-only "Today", the
// page's custom range for today (00:00 → 23:59:59). rangeOf lives in the hook,
// which the TV cannot load (React, Redux), so the windows are restated here
// with an injectable clock; they are checked against the hook's in
// lib/__tests__/score-live-board.test.js.
//
// When the rules score the CRM Executives on the MIS engine with IST calendar
// periods (owner decision #2), the same keys name the IST calendar period that
// holds today — this week, this month, … (lib/mis/board-period.js), each
// labelled so. Every one of them is still running, so none is ever a closed
// period with a frozen record (decision #4) to read instead.

import { CALENDAR_KEY_LABEL, windowPeriodOf } from './crm/lib/mis/board-period.js';

export const CRM_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'weekly', label: 'Weekly · last 7 days' },
  { key: 'monthly', label: 'Monthly · last 30 days' },
  { key: 'quarterly', label: 'Quarterly · last 90 days' },
  { key: 'halfyearly', label: 'Half-yearly · last 180 days' },
  { key: 'yearly', label: 'Yearly · last 365 days' },
];
export const CRM_PERIOD_KEYS = CRM_PERIODS.map((p) => p.key);
export const CRM_DEFAULT_PERIOD = 'weekly';

const TODAY = 'today';
const DAY_MS = 24 * 60 * 60 * 1000;
/* rangeOf's rolling windows: `ago(n)` days before now, as the page counts them. */
const ROLLING_DAYS = { weekly: 7, monthly: 30, quarterly: 90, halfyearly: 180, yearly: 365 };

export const isCrmPeriod = (key) => CRM_PERIOD_KEYS.includes(key);
export const crmPeriodLabel = (key) => CRM_PERIODS.find((p) => p.key === key)?.label ?? null;

/** A period's label on a board: the calendar's ("This week") when the profile reads IST calendar periods. */
export const crmPeriodLabelFor = (key, isCalendar) => (isCalendar ? CALENDAR_KEY_LABEL[key] : null) ?? crmPeriodLabel(key);

/** The MIS period a key names for a profile: its IST calendar period, or this window's IST days. */
export const crmMisPeriod = (key, profile, now = new Date()) => windowPeriodOf(profile, { key, window: crmRange(key, now) }, now);

/** [start, end] the page would filter on for this period. */
export function crmRange(key, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  if (key === TODAY) return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end };
  // An unknown key reads as the page's default filter, monthly, as rangeOf does.
  const days = ROLLING_DAYS[key] ?? ROLLING_DAYS.monthly;
  return { start: new Date(now.getTime() - days * DAY_MS), end };
}
