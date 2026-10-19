// VERBATIM COPY of CRM lib/reports/misFormat.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/reports/misFormat.js
//
// The two display helpers the MIS feed's consumers share: a working-minute
// delay as text, and an owner key as a name.
//
// They lived in hooks/useMisSteps.js, a 'use client' hook file, which dragged
// the Redux store and the client Firebase SDK into every module that only
// wanted to format a label — lib/scoring/crmExecScore.js among them, and so
// every jest suite that scores a step. Pure and dependency-free here, so the
// scorers, the pages and the tests read the same text.

/* Format working-minutes delay using 8h work-day (480 min = 1 work-day). */
export const fmtDelay = min => {
  if (!min || min <= 0) return '—';
  const d = Math.floor(min / 480), h = Math.floor((min % 480) / 60), m = Math.floor(min % 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export const ownerLabel = o => {
  if (!o || o === 'Unknown' || o === 'Unassigned') return o || '—';
  if (o.includes('@')) return o.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return o;
};
