// VERBATIM COPY of CRM lib/designApprovalSla.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * Design-approval SLA clock — the calendar the Design Approval screen uses to
 * turn a design-submission timestamp into a "Planned Date" and to measure
 * "Delay". The Exhibition Approval screen reuses it so both read on the exact
 * same clock the reviewer already knows from Design Approval.
 *
 * Calendar: Mon–Sat, 09:30–18:00 IST with a 13:30–14:00 lunch break. Minutes
 * outside a working window (nights, lunch, Sundays, holidays) do not count.
 * `SLA_MINUTES` = 2 working hours — planned = submission + 2 working hours.
 *
 * NOTE: distinct from lib/workingHours.js (the designer-scoring clock, which
 * runs 09:45–18:30). Keep this module aligned with the calendar defined inline
 * in app/(app)/design/approval/page.jsx.
 *
 * Holidays are hr-erp's Task SLA list, loaded into lib/work-calendar.js — the
 * same list the designer clock skips.
 *
 * The calendar is the rules registry's 'officeDa' (lib/work-clock.js): WORK_CFG
 * below is its built-in profile, the registry's default, which the clock reads
 * until the rules are loaded — so hours or holidays edited in Settings > Report
 * Rules move this board with every report.
 */

import { profileOfWorkCfg } from './rules/calendar.js';
import { HOLIDAY_SOURCES } from './rules/contract.js';
import { CALENDAR } from './rules/names.js';
import { calendarClock } from './work-clock.js';

export const WORK_CFG = {
  tz: 'Asia/Kolkata',
  workStart: { h: 9, m: 30 },
  workEnd: { h: 18, m: 0 },
  lunchStart: { h: 13, m: 30 },
  lunchEnd: { h: 14, m: 0 },
  workingDays: [1, 2, 3, 4, 5, 6],
};

export const SLA_MINUTES = 120;

/** The board's built-in calendar: WORK_CFG, skipping HR-ERP's office holidays. */
export const DESIGN_APPROVAL_PROFILE = Object.freeze(profileOfWorkCfg(WORK_CFG, HOLIDAY_SOURCES.HRERP));

const approvalClock = () => calendarClock(CALENDAR.OFFICE_DA, DESIGN_APPROVAL_PROFILE);

/** Add `minutes` of working time to `start`, respecting the calendar above. */
export const addWorkingMinutes = (start, minutes) => approvalClock().addWorkingMinutes(start, minutes);

/** Signed count of working minutes from `a` to `b` (negative when b < a). */
export const workingMinutesBetween = (a, b) => {
  if (!a || !b) return 0;
  return approvalClock().workingMinutesBetween(a, b);
};

/** Parse the sheet's mixed date shapes ("M/D/YYYY H:mm:ss", ISO, Date). */
export const parseDT = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim().replace(/^'+|'+$/g, '');
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (m) {
    const [, mm, dd, yyyy, hh = '0', mi = '0', ss = '0'] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

/** Compact "DD/MM/YYYY HH:mm" for display. Returns "—" for a null date. */
export const fmtDT = (d) => {
  if (!d) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${mon}/${yr} ${hh}:${mm}`;
};
