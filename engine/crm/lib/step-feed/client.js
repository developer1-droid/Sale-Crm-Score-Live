// VERBATIM COPY of CRM lib/step-feed/client.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/step-feed/client.js
//
// The step feed as the browser reads it. Over HTTP an item's planDate,
// actDate and cutoffRef arrive as ISO text or not at all — planned and actual
// are the strings the feed keeps — and every report indexes on the Date
// fields, so they are put back here before an item reaches one.
//
// Pure: the items passed in are not changed.

const toDate = (value) => {
  if (value instanceof Date) return value;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * @template {{ planned?: string, actual?: string, cutoffRef?: string|Date|null }} T
 * @param {T[]} items  Feed items as served.
 * @returns {(T & { planDate: Date|null, actDate: Date|null, cutoffRef: Date|null })[]}
 */
export function rehydrate(items = []) {
  return (items || []).map((item) => ({
    ...item,
    planDate: toDate(item.planned),
    actDate: toDate(item.actual),
    cutoffRef: toDate(item.cutoffRef),
  }));
}
