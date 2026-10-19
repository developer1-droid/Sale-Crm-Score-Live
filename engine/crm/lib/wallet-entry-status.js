// VERBATIM COPY of CRM lib/wallet-entry-status.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/wallet-entry-status.js
//
// Whether the Client Wallet counts a sheet-only external payment (a CRM FMS
// advance or an SO-FMS ledger payment) as confirmed. These rows have no ledger
// doc of their own; the decision lives in a walletConfirmations overlay, and
// payments from before the confirm workflow existed count without one.
//
// Client-safe and Firebase-free. The wallet page keeps its own copy of this rule
// (app/(app)/buyers/wallet/page.jsx) — KEEP IN SYNC.
import { EXTERNAL_CONFIRM_CUTOFF } from './soFmsLedger.js';

// The sheets hold Indian calendar dates. Read them as IST midnight whatever the
// runtime's zone: the wallet page runs in an IST browser, the server in UTC, and
// a date read at UTC midnight is still "in the future" until 05:30 IST.
const IST_OFFSET_MS = 330 * 60 * 1000;
const istMidnight = (y, month, day) => new Date(Date.UTC(y, month - 1, day) - IST_OFFSET_MS);

// External date can be ISO or a slash/dash date. The CRM/SO-FMS sheets write
// US-style MM/DD/YYYY, so an ambiguous slash date is read month-first (a value
// > 12 in the first slot flips it to day-first). Reading these day-first pushed
// old dates months into the future, wrongly marking grandfathered advances as
// new-era "pending" — the bug behind the flood of false pendings.
export function parseEntryDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return istMidnight(+iso[1], +iso[2], +iso[3]);
  const md = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (md) {
    const a = +md[1], b = +md[2], y = +md[3];
    const [month, day] = a > 12 ? [b, a] : [a, b]; // default US MM/DD
    return istMidnight(y, month, day);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

/**
 * A payment dated between the cutoff and now went through the confirm workflow.
 * Older ones, unreadable dates and future dates (an ambiguous parse or a
 * post-dated entry) are grandfathered.
 */
export function isConfirmWorkflowEra(dateValue, now = new Date()) {
  const date = parseEntryDate(dateValue);
  return date ? date >= EXTERNAL_CONFIRM_CUTOFF && date <= now : false;
}

// Confirmation state of a sheet-only external entry — BYTE-FOR-BYTE the wallet
// page's rule: an overlay decision wins; else pre-cutoff / unparseable-date
// entries are grandfathered confirmed; else a proof-expecting entry stays
// pending until accounts confirm.
export function externalStatus(entry, overlay, now = new Date()) {
  if (overlay) return overlay.status || 'pending';
  if (!isConfirmWorkflowEra(entry.date, now)) return 'confirmed';
  return entry.proofExpected ? 'pending' : 'confirmed';
}
