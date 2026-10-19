// VERBATIM COPY of CRM lib/sheet-date.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/sheet-date.js
//
// Read a date/time cell off the CRM FMS sheet. The app writes 'MM/DD/YYYY
// HH:mm:ss' and ISO, both of which `new Date` reads. Rows brought in by the bulk
// import carry 'YY-MM-DD HH:mm:ss' ("26-01-22 18:00:01" = 22 Jan 2026), which
// `new Date` rejects — those PIs lost their Step-3 actual on the board and in
// the PC report, and the clock fell back to a much later wallet date instead.
//
// Client-safe and Firebase-free.

const SHORT_YEAR_DATE = /^(\d{2})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** A sheet cell as a local-time Date, or null when it holds no readable date. */
export function parseSheetDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value ?? '').trim();
  if (!text) return null;

  const short = text.match(SHORT_YEAR_DATE);
  if (short) {
    const [, yy, mm, dd, h = '0', mi = '0', s = '0'] = short;
    const date = new Date(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(h), Number(mi), Number(s));
    return date.getMonth() === Number(mm) - 1 ? date : null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
