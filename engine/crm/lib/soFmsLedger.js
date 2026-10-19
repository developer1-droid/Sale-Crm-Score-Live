// VERBATIM COPY of CRM lib/soFmsLedger.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// SO-FMS ledger rows saved at CI level are fanned out — one identical row per
// SO linked to the CI (see app/api/so-fms/route.js saveLedger). That mirror is
// what lets each SO's own view show the payment, but it means any aggregation
// that pools ledger rows ACROSS SOs of the same CI picks up one copy per
// linked SO. Collapse those clones with dedupeLedgerRows before summing, or a
// shared-CI payment is counted once per linked SO.

const norm = (v) => String(v || "").trim().toUpperCase();

// 18 Jun 2026 — externals dated before this are "grandfathered": they count as
// confirmed WITHOUT a walletConfirmations overlay. On/after it, an external
// payment must be confirmed in the Client Wallet before it counts toward the
// balance. Single source of truth — imported by lib/wallet-external.js (server)
// and the SO-FMS Telex modal (client) so every surface agrees on the cutoff.
// Lives here (a client-safe module with no server deps) so a client component
// can read it without pulling googleapis into the browser bundle.
// Midnight IST as an explicit instant: `new Date(2026, 5, 18)` meant IST in the
// browser but 05:30 IST on a UTC server, and depended on when the module loaded.
export const EXTERNAL_CONFIRM_CUTOFF = new Date('2026-06-18T00:00:00+05:30');

// Ledger rows arrive with either the clean header key or the verbose
// sheet-generated one, depending on where they were read from.
export const getLedgerAmount = (l) =>
  parseFloat(l.accounts_converted_base_amount || l.accounts_converted_base_amount_e_g_in_usd || 0) || 0;

export const getLedgerCategory = (l) =>
  l.action_category ||
  l.action_category_options_hold_placed_hold_released_date_extended_payment_received_follow_up_done_step_completed ||
  "";

// Identity of the underlying event — everything the fan-out clones share and
// nothing (so_no) that distinguishes them. Timestamp is second-precision and
// written once per event, so two real payments never collide on the same key.
export const ledgerEventKey = (l) => [
  l.timestamp || l.timestamp_entry_date_time || "",
  norm(l.final_invoice_no),
  getLedgerCategory(l),
  getLedgerAmount(l).toFixed(2),
  l.accounts_payment_date || "",
  l.accounts_remitter_bank_name || "",
].join("|");

// Collapse fan-out clones to one row per event. Optional `preferRow(l)` picks
// which clone survives — e.g. the one whose synthetic wallet id already has a
// confirmation overlay, so an accounts decision stays attached after dedupe.
// Without a preference (or when no clone matches it) the first row in input
// order survives, which is sheet order on both server and client — the same
// survivor everywhere.
export const dedupeLedgerRows = (rows, preferRow) => {
  const byKey = new Map();
  rows.forEach((l) => {
    const key = ledgerEventKey(l);
    const current = byKey.get(key);
    if (!current) byKey.set(key, l);
    else if (preferRow && !preferRow(current) && preferRow(l)) byKey.set(key, l);
  });
  return [...byKey.values()];
};

/**
 * The accounts rate correction that applies to one ledger row, if any.
 *
 * `corrections` is `{ byEventKey, byEntryId }` as built from the walletConfirmations
 * overlay. The SHARED event identity is tried first on purpose: a CI-level payment
 * is cloned once per Sales Order on the invoice and `fmsSyntheticEntryId` carries
 * the SO No, so a correction recorded against one clone would otherwise leave
 * every sibling SO quoting the uncorrected figure. The entry id remains the
 * fallback for corrections stored before the event key was kept.
 */
export const correctionForRow = (corrections, row) =>
  corrections?.byEventKey?.[ledgerEventKey(row)] ||
  corrections?.byEntryId?.[fmsSyntheticEntryId(row)] ||
  null;

// Firestore doc id for anything keyed by a payment entry id. Synthetic ids
// (e.g. "fms-PI/24/001-…") can contain '/', '.', '#', '[', ']' — all illegal in a
// doc id. Normalize to a safe, deterministic id. Shared by the confirmation
// overlay (walletConfirmations) and the settlement flow (paymentSettlements) so
// both address the SAME payment with the SAME id.
export const entryDocId = (entryId) =>
  String(entryId || "").replace(/[/\\.#$[\]]/g, "_").slice(0, 1400);

// Synthetic wallet id for a SO-FMS ledger row. The Client Wallet page and
// lib/wallet-external.js must build the IDENTICAL string — walletConfirmations
// overlay docs are keyed by it. Kept byte-for-byte compatible with the historic
// inline versions (including a possible "NaN" amount on malformed rows), so
// existing overlay docs keep matching.
export const fmsSyntheticEntryId = (l) => {
  const amount = parseFloat(l.accounts_converted_base_amount || l.accounts_converted_base_amount_e_g_in_usd || 0);
  const dateKey = String(l.accounts_payment_date || l.timestamp || "").trim();
  const remitterKey = String(l.accounts_remitter_bank_name || "").trim();
  return `fms-${l.so_no || "NA"}-${dateKey || "x"}-${amount}-${remitterKey}`;
};
