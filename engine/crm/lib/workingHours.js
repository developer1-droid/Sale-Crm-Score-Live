// VERBATIM COPY of CRM lib/workingHours.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * The designer's clock — the calendar a design's due time and a designer's
 * lateness are counted on: Mon–Sat 09:45–18:30 with a 13:30–14:00 lunch,
 * skipping HR-ERP's office holidays. HR-ERP plans its designers on the same
 * hours, and the 'Design Due At' the design-approval route writes on it is
 * cascaded there.
 *
 * The calendar is the rules registry's 'designer' (lib/work-clock.js): WORK_CFG
 * below is its built-in profile, the registry's default, which the clock reads
 * until the rules are loaded — so hours or holidays edited in Settings > Report
 * Rules move the designer's clock with every report (owner decision 6). The
 * holidays themselves are hr-erp's Task SLA list (lib/work-calendar.js).
 *
 * NOTE: distinct from lib/designApprovalSla.js, the approval reviewer's
 * 09:30–18:00 clock.
 */

import { profileOfWorkCfg } from './rules/calendar.js';
import { HOLIDAY_SOURCES } from './rules/contract.js';
import { CALENDAR } from './rules/names.js';
import { calendarClock } from './work-clock.js';

export const WORK_CFG = {
  tz: 'Asia/Kolkata',
  workStart: { h: 9, m: 45 },
  workEnd: { h: 18, m: 30 },
  lunchStart: { h: 13, m: 30 },
  lunchEnd: { h: 14, m: 0 },
  workingDays: [1, 2, 3, 4, 5, 6],
};

/** The designer's built-in calendar: WORK_CFG, skipping HR-ERP's office holidays. */
const DESIGNER_CALENDAR = Object.freeze(profileOfWorkCfg(WORK_CFG, HOLIDAY_SOURCES.HRERP));

const designerClock = () => calendarClock(CALENDAR.DESIGNER, DESIGNER_CALENDAR);

/** Is it a day the designers work: Monday to Saturday, not an office holiday? */
export const isWorkingDay = (d) => designerClock().isWorkingDay(d);

/** `minutes` of the designer's working time after `start`. */
export const addWorkingMinutes = (start, minutes) => designerClock().addWorkingMinutes(start, minutes);

/** Signed count of the designer's working minutes from `a` to `b` (negative when b < a). */
export const workingMinutesBetween = (a, b) => {
  if (!a || !b) return 0;
  return designerClock().workingMinutesBetween(a, b);
};
