// VERBATIM COPY of CRM lib/advance-balance-anchor.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/advance-balance-anchor.js
//
// What an ADVANCE order's BALANCE is due against.
//
// The order has already taken its advance; the rest falls due against some
// event — the documents going out, the B/L, loading, arrival, a telex release,
// or a stated number of days after SOB. That event is where the Step-11 chase
// starts, so it has to be read off the terms.
//
// The terms are free text, typed by hand into the PI's "Advance Percentage"
// column, and 1,017 live PIs carry 239 distinct spellings of them —
// "30% & BALANCE AGAINST DOCUMENTS", "Balance80% CAD Bank to Bank",
// "20% Balance after 35 days from SOB date.", "BILL OF LOADING", "DOCUMNETS".
// A lookup table would be stale the week it was written, so these are ordered
// patterns and the first match wins.
//
// ORDER IS LOAD-BEARING. Each rule's comment says what breaks if it moves;
// those are not guesses, they were measured by moving each rule to the top and
// to the bottom and counting the PIs that changed anchor.
//
// Matching is case-insensitive against the RAW term: no trimming, no case
// folding, no punctuation stripping. Several patterns are anchored to the start
// or end of the string, and one live term contains a newline.

export const ADVANCE_BALANCE_ANCHOR = {
  /** Step-9 SHARE FINAL DOCS SCAN — the common case, ~79% of advance PIs. */
  DOCS: 'docs',
  /** The B/L. Nothing records a B/L date, so Step-8 SOB stands in. */
  BL: 'bl',
  /** Step-7 SHARE CONTAINER STUFFING. */
  LOADING: 'loading',
  /** Step-4 PRODUCTION/DISPATCH UPDATE. */
  DISPATCH: 'dispatch',
  /** Balance in CAD — the order then chases on the ordinary CAD clock. */
  CAD: 'cad',
  /** Balance against an LC — same clock as CAD. */
  LC: 'lc',
  /** Step-13 telex release. */
  TELEX: 'telex',
  /** The cargo landing itself. */
  ARRIVAL: 'arrival',
  /** A stated number of days after SOB / the B/L; the count comes back too. */
  SOB_DAYS: 'sob_days',
  /** 100% advance — there is no balance to chase. */
  NONE: 'none',
  /** A human has to read this one. Never guessed at. */
  UNCLEAR: 'unclear',
};

const A = ADVANCE_BALANCE_ANCHOR;

// First match wins. Do not reorder without re-running the ablation.
const RULES = [
  // Whole-string shape: digits, currency and advance-ish filler, naming no
  // event at all — "100%", "100% ADVANCE", "30% ADV. RECEIVED". The lookahead
  // for a digit keeps a blank term out, so blanks fall through to UNCLEAR.
  [A.NONE, /^(?=[^a-z]*\d)[^a-z]*(?:(?:adv(?:ance)?d?|in|full|only|payment|paid|received|recd|usd|total)[^a-z]*)*$/i],

  // Two shapes only a person can settle: a balance tied to customs clearance,
  // and a "balance against" that trails off with nothing after it. ABOVE docs —
  // the clearance wording also says "against documents", and demoting this
  // hands 6 PIs to Step-9 that have nothing to do with the doc scan.
  [A.UNCLEAR, /\bclear(?:ance|ing)\b|\bagainst\s*$/i],

  // ABOVE docs: "80% LC at sight against documents" is an LC, not a doc chase.
  [A.LC, /\bl\s*\/?\s*c\b|letter\s*of\s*credit/i],

  // ABOVE docs: "telex release of documents" is due against the telex.
  [A.TELEX, /\btelex\b/i],

  // A day count, but only when the string also names SOB / B/L / loading —
  // without that lookahead a bare "balance after 40 days" would be guessed onto
  // a B/L date instead of going to a human. Group 1 is the number of days.
  // ABOVE bl and loading: "against BL within 30 days of loading" names all
  // three, and demoting this loses the count. BELOW unclear, or the clearance
  // row's "7-10 days" is read as a tenor.
  [A.SOB_DAYS, /^(?=[\s\S]*(?:\bs\.?o\.?b\b|\bb\s*\/?\s*l\b|bill\s*of\s*l|load|sail|onboard|on\s*board))[\s\S]*?(?:after|within|from|post)\s*(\d+)\s*(?:to|-|–)?\s*\d*\s*days?/i],

  // ABOVE docs: "BALANCE CASH AGAINST DOCUMENTS" contains "AGAINST DOCUMENTS"
  // verbatim, and demoting this chases 3 PIs off Step-9 instead of the CAD
  // clock. The word boundaries catch "Balance80% CAD" and a CAD split onto its
  // own line, both of which are live.
  [A.CAD, /\bc\.?a\.?d\b|cash\s*ag(?:ai|ia)?nst/i],

  // ABOVE loading, because the frequent typo is "BILL OF LOADING"; ABOVE
  // arrival, because "AGAINST B/LBEFORE ARRIVAL" (no space) is a B/L chase.
  // BELOW sob_days, or "against BL within 30 days" loses its day count.
  [A.BL, /\bb\s*\/\s*l|\bb\.?\s?l\b|bill\s*of\s*l(?:ading|oading)/i],

  // Only "on/upon arrival" — never a bare "arrival". "BALANCE AGAINST B/L
  // BEFORE ARRIVAL" is a B/L chase with an arrival deadline, caught above.
  [A.ARRIVAL, /\bon\s*arrival|\bupon\s*arrival/i],

  [A.DISPATCH, /\bdispatch/i],

  // The common case. Fuzzy on purpose: DOCUMENTS, DOCUMETS, DOCUMNETS,
  // DOCUEMENTS, DOCS, "AGAINSTDOCUMENTS" with no space, the dropped-C typo
  // DOUMENTS, and "EMAIL THE SHIPPING COPIES". ABOVE loading, because
  // "$10000 ON LOADING AND BALANCE AGAINST DOCUMENTS" names loading first but
  // owes the balance against the documents.
  [A.DOCS, /d[o0]c[usm]|dou?m[ae]n|shipp?ing\s*cop/i],

  // Last, because "loading" is the noisiest token here — it sits inside BILL OF
  // LOADING, "within 30 days of loading", and one docs row. Promoting it costs
  // 6 PIs.
  [A.LOADING, /\bload(?:ing|ed)?\b|\bstuffing\b/i],
];

/**
 * Read an advance order's balance trigger off its payment sub-term.
 *
 * @param {string} terms the raw "Advance Percentage" cell
 * @returns {{anchor: string, days: number}} `days` is 0 unless the anchor is SOB_DAYS
 */
export const resolveAdvanceBalanceAnchor = (terms) => {
  const raw = String(terms ?? '');
  if (!raw.trim()) return { anchor: A.UNCLEAR, days: 0 };
  for (const [anchor, pattern] of RULES) {
    const m = raw.match(pattern);
    if (!m) continue;
    return { anchor, days: anchor === A.SOB_DAYS ? parseInt(m[1], 10) || 0 : 0 };
  }
  return { anchor: A.UNCLEAR, days: 0 };
};

/** Anchors that need a person rather than a schedule. */
export const isChaseableBalanceAnchor = (anchor) =>
  anchor !== A.NONE && anchor !== A.UNCLEAR;
