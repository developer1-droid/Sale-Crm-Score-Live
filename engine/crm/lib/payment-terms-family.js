// VERBATIM COPY of CRM lib/payment-terms-family.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/payment-terms-family.js
//
// Which follow-up rule an order's payment terms fall under.
//
// The board already matched terms with `paymentTerms.toUpperCase().includes('DA')`
// — which is true for 'LC FOR 30 DAYS' and for '40% ON SENDING THE BL & 60%
// AFTER 30 DAYS TT', so six live LC orders were labelled DA. The reverse bug is
// in the same file: `paymentTerms.includes("Advance")` is case-sensitive against
// a sheet that stores 'ADVANCE', so the Step-1 help text has never once matched
// an advance order. Substring matching cannot tell a term from a word inside a
// sentence, so this matches whole tokens instead.
//
// Deliberately free of Firebase, googleapis and React: the board, the planned
// engine, the reports and a server-side reminder job must all agree on what an
// order is, and the rule stays directly testable.

export const PAYMENT_FAMILY = {
  ADVANCE: 'advance',
  DP: 'dp',
  DA: 'da',
  CAD_LC: 'cad_lc',
  /** No automatic follow-up rule applies — chase this one by hand. */
  OTHER: 'other',
};

// One entry per family, matched against whole tokens. 'CAD' and 'LC' share a
// family because the business chases them identically: the documents travel to
// the buyer's bank and the money follows their release.
const FAMILY_TOKENS = [
  [PAYMENT_FAMILY.ADVANCE, ['ADVANCE']],
  [PAYMENT_FAMILY.DP, ['DP']],
  [PAYMENT_FAMILY.DA, ['DA']],
  [PAYMENT_FAMILY.CAD_LC, ['CAD', 'LC']],
];

/**
 * Split on everything that is not a letter or a digit, so 'T/T', 'CAD-45' and
 * 'DA, 45 DAYS' all break into the tokens a reader would see.
 */
const tokenize = (terms) =>
  String(terms || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

/**
 * Every family whose token appears in the terms. Usually one; more than one
 * means a split or free-text term ('50% ADVANCE, BALANCE AGAINST LC').
 */
export const matchedPaymentFamilies = (terms) => {
  const tokens = new Set(tokenize(terms));
  return FAMILY_TOKENS.filter(([, words]) => words.some((w) => tokens.has(w))).map(([family]) => family);
};

/**
 * The single follow-up rule that applies, or OTHER.
 *
 * A term naming two families is OTHER on purpose rather than resolved by
 * precedence: these are real split terms, an automatic chase built on a guess
 * would mail a real buyer on the wrong schedule, and there are few enough of
 * them that a human can own them.
 */
export const classifyPaymentFamily = (terms) => {
  const matched = matchedPaymentFamilies(terms);
  return matched.length === 1 ? matched[0] : PAYMENT_FAMILY.OTHER;
};

/** Families the automated Step-11 follow-up rules know how to schedule. */
export const isAutomatablePaymentFamily = (family) => family !== PAYMENT_FAMILY.OTHER;

/** Short label for the board, so a row can show why it has no planned date. */
export const PAYMENT_FAMILY_LABEL = {
  [PAYMENT_FAMILY.ADVANCE]: 'Advance',
  [PAYMENT_FAMILY.DP]: 'DP',
  [PAYMENT_FAMILY.DA]: 'DA',
  [PAYMENT_FAMILY.CAD_LC]: 'CAD/LC',
  [PAYMENT_FAMILY.OTHER]: 'Manual',
};
