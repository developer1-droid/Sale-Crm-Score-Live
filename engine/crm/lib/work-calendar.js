// VERBATIM COPY of CRM lib/work-calendar.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * The office holiday list the design clocks skip — lib/workingHours.js (the
 * designer's clock) and lib/designApprovalSla.js (the approval SLA clock).
 *
 * The list itself is hr-erp's Settings → Task SLA (`TaskHoliday`), the single
 * holiday list for both apps. It lives here as module state rather than being
 * threaded through every clock call: a route handler fills it with
 * `ensureWorkCalendar()` (lib/work-calendar-source.js), the browser with
 * hooks/useWorkCalendar.js. Until a loader runs the set is empty, which is
 * exactly the old Sundays-only calendar.
 *
 * Keys are IST calendar days, 'YYYY-MM-DD'. Both runtimes keep local time in
 * IST (instrumentation.js pins the server; the office browsers are in India),
 * so a Date's local y-m-d is its IST day — the same local getters every clock
 * already reads.
 *
 * Pure and dependency-free, so it runs in the browser, on the server and
 * under jest alike.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let holidays = new Set();
let version = 0;

const pad2 = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** hr-erp sends `{ date, name }`; a bare 'YYYY-MM-DD' string is accepted too. */
const entryDate = (entry) =>
  String((entry && typeof entry === 'object' ? entry.date : entry) ?? '').trim();

const sameDays = (a, b) => a.size === b.size && [...a].every((day) => b.has(day));

/**
 * Replace the holiday list. Takes 'YYYY-MM-DD' strings or `{ date }` objects;
 * anything that is not a YYYY-MM-DD date is ignored rather than failing the
 * whole list.
 */
export function setHolidays(list) {
  const next = new Set();
  for (const entry of Array.isArray(list) ? list : []) {
    const day = entryDate(entry);
    if (ISO_DATE.test(day)) next.add(day);
  }
  if (sameDays(next, holidays)) return;
  holidays = next;
  version += 1;
}

/** True when the 'YYYY-MM-DD' IST day is an office holiday. */
export const isHolidayYmd = (ymd) => holidays.has(ymd);

/** True when the Date's local (IST) calendar day is an office holiday. */
export const isHolidayDate = (date) => holidays.size > 0 && holidays.has(localYmd(date));

/** The loaded holidays, oldest first. */
export const getHolidays = () => [...holidays].sort();

/**
 * Bumps every time the set actually changes, so anything that caches a clock
 * result can tell its numbers were measured on an older calendar.
 */
export const calendarVersion = () => version;
