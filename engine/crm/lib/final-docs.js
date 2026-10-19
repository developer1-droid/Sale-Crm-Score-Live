// VERBATIM COPY of CRM lib/final-docs.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/final-docs.js
// Which final-document scan batch a shipment sends, and whether that batch has
// already gone out.
//
// Logistics fill the FINAL DOCS SCAN form per Commercial Invoice, and re-submit
// the whole set whenever a document is corrected — so one CI legitimately carries
// several scan rows (the "Final Docs Scan History" modal lists them by SCAN DATE).
// The buyer must get the NEWEST batch, ONCE. That is not automatic: a CI split
// across sibling Sales Orders (260107252 / 260107252-P2) renders one board row
// each, and each row used to send the buyer its own copy of the same documents.
//
// Pure + Firebase-free on purpose: the SO-FMS board (client) and the
// notification trigger (server) must agree on "latest", so both read it here.
import { parseSoDate } from './so-working-hours.js';

const NOT_APPLICABLE = 'N/A';

/** CI / SO match key — uppercase alphanumerics only. null for blanks and "N/A". */
export function normalizeInvoiceKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toUpperCase() === NOT_APPLICABLE) return null;
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

const scanTime = (entry) => parseSoDate(entry?.timestamp)?.getTime() ?? null;

const hasDocs = (entry) => !!entry && Array.isArray(entry.docs) && entry.docs.some((d) => d && d.url);

/**
 * Scans that actually carry documents, narrowed to one Final Invoice when any
 * scan names it. Rows whose CI cell is blank or typo'd would otherwise strand the
 * order with nothing to send, so a CI with no matching row falls back to every
 * scan attached to the order.
 */
function relevantScans(entries, ciNo) {
  const withDocs = (Array.isArray(entries) ? entries : []).filter(hasDocs);
  const ci = normalizeInvoiceKey(ciNo);
  if (!ci) return withDocs;
  const matching = withDocs.filter((e) => normalizeInvoiceKey(e.ciNo) === ci);
  return matching.length ? matching : withDocs;
}

/**
 * The newest scan batch by SCAN DATE — deliberately not "the last element", which
 * only holds while every caller sorts the sheet rows the same way. Equal
 * timestamps resolve to the later row (sheet order is submission order); a row
 * whose timestamp can't be parsed wins only when nothing else can be dated.
 */
export function latestFinalDocsScan(entries, { ciNo = null } = {}) {
  const scans = relevantScans(entries, ciNo);
  if (!scans.length) return null;

  let best = scans[0];
  let bestTs = scanTime(best);
  for (let i = 1; i < scans.length; i += 1) {
    const ts = scanTime(scans[i]);
    const wins = bestTs === null ? true : ts !== null && ts >= bestTs;
    if (wins) {
      best = scans[i];
      bestTs = ts;
    }
  }
  return best;
}

/**
 * Scan history ordered newest-first for display, so the batch that actually goes
 * out reads at the top. Same date source as latestFinalDocsScan, so the list and
 * the "sent to buyer" marker can never disagree. Undated rows sink to the bottom.
 */
export function sortFinalDocsScansNewestFirst(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry, index, ts: scanTime(entry) }))
    .sort((a, b) => {
      if (a.ts === b.ts) return b.index - a.index;
      if (a.ts === null) return 1;
      if (b.ts === null) return -1;
      return b.ts - a.ts;
    })
    .map((x) => x.entry);
}

/** Documents of the newest scan batch, blank URLs dropped. */
export function latestFinalDocs(entries, { ciNo = null } = {}) {
  const scan = latestFinalDocsScan(entries, { ciNo });
  return (scan?.docs || []).filter((d) => d && d.url);
}

/**
 * Every document URL across EVERY scan of the order. The trigger collapses
 * individually-attached scans into the one merged pack, and it can only do that
 * for URLs it recognises — a superseded URL from an older batch that isn't
 * recognised rides out as its own extra WhatsApp message.
 */
export function allFinalDocsUrls(entries) {
  const urls = (Array.isArray(entries) ? entries : []).flatMap((e) =>
    (e?.docs || []).map((d) => d?.url)
  );
  return Array.from(new Set(urls.filter(Boolean)));
}

/**
 * Idempotency scope for a final-docs alert: ONE Commercial Invoice + ONE scan
 * batch. Every sibling SO of that CI produces the same string, so the second
 * sibling's send is recognised as the duplicate it is — while a re-submitted scan
 * carries a new timestamp, hence a new scope, and goes out again.
 *
 * Needed for the review-rejected alert in particular: that outcome deliberately
 * leaves the step OPEN, so there is no completion stamp for
 * `isCiStepAlertAlreadySent` to compare against.
 *
 * Returns null when the order has no invoice — then the caller's default per-SO
 * scope applies.
 */
export function ciDocsAlertScope({ finalInvoiceNo, latestScanTimestamp } = {}) {
  const ci = normalizeInvoiceKey(finalInvoiceNo);
  if (!ci) return null;
  return `ci:${ci}|scan:${String(latestScanTimestamp || 'none').trim()}`;
}

// How long one CI+scan scope stays claimed. The scope already changes whenever
// logistics re-submit the form, so this only has to outlast the gap between a
// reviewer working through the sibling rows of the same invoice.
export const CI_DOCS_ALERT_DEDUPE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Did a SIBLING Sales Order under the same Final Invoice already complete this
 * step after the newest scan landed — i.e. has the buyer already received THIS
 * document pack?
 *
 * Split SOs share one CI and one physical set of documents, so the pack goes out
 * once. Two guards keep that from silencing a genuine send:
 *  - a sibling completed BEFORE the newest scan was uploaded proves only that the
 *    OLD pack went out; the corrected one still has to reach the buyer;
 *  - a muted sibling completed without notifying anybody.
 * Anything ambiguous (no scan date, unparseable completion time) sends — a
 * duplicate is recoverable, a document the buyer never receives is not.
 */
export function isCiStepAlertAlreadySent({
  rows = [],
  soNo,
  finalInvoiceNo,
  stepKey,
  latestScanTimestamp = null,
} = {}) {
  const ci = normalizeInvoiceKey(finalInvoiceNo);
  if (!ci || !stepKey) return false;

  const scanTs = parseSoDate(latestScanTimestamp)?.getTime() ?? null;

  return (Array.isArray(rows) ? rows : []).some((row) => {
    // Same SO (its own item rows): the trigger's own idempotency window covers it.
    if (!row || row.soNo === soNo) return false;
    if (normalizeInvoiceKey(row.finalInvoiceNo) !== ci) return false;
    if (row.notifyMuted) return false;

    const step = row.steps?.[stepKey];
    if (step?.status !== 'completed') return false;
    if (scanTs === null) return true;

    const doneTs = parseSoDate(step.actualDateTime)?.getTime() ?? null;
    return doneTs !== null && doneTs >= scanTs;
  });
}
