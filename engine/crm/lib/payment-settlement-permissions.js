// VERBATIM COPY of CRM lib/payment-settlement-permissions.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/payment-settlement-permissions.js
//
// Every gated action in the Payment Settlement feature, in one place: the slug,
// what it is called in the RBAC admin UI, and which older slug still covers it.
//
// One catalogue feeds all four consumers — lib/roles.js (the static PERMISSIONS
// map), the seed script, the client hook that turns slugs into booleans, and the
// API route's per-action checks — so a new button cannot end up gated on the
// client and open on the server, or missing from the admin UI.
//
// Deliberately DEPENDENCY-FREE: the seed script imports it directly with plain
// node, where the "@/" alias does not resolve.

export const SETTLEMENT_PERMISSION_GROUP = 'Payment Settlement';

/**
 * Slugs added before the feature was broken down button-by-button. Anyone still
 * holding one keeps everything it used to cover, so an existing grant never
 * silently loses access when the finer slugs roll out.
 */
export const LEGACY_IMPLIES = {
  'payment_settlement.complete': [
    'payment_settlement.step1.complete',
    'payment_settlement.step2.complete',
    'payment_settlement.step3.complete',
    'payment_settlement.bulk_settle',
  ],
  'payment_settlement.edit': ['payment_settlement.step.edit', 'payment_settlement.grn.edit'],
  'payment_settlement.manage_master': [
    'payment_settlement.master.manage',
    'payment_settlement.forward.create', 'payment_settlement.forward.edit', 'payment_settlement.forward.delete',
    'payment_settlement.loan.create', 'payment_settlement.loan.edit', 'payment_settlement.loan.delete',
    'payment_settlement.bulk_settle',
  ],
  'payment_settlement.grn_release': ['payment_settlement.grn.release', 'payment_settlement.grn.edit'],
  'payment_settlement.close_ci': ['payment_settlement.ci.close', 'payment_settlement.ci.reopen'],
};

const P = (key, slug, name, description, actionType, extra = {}) =>
  ({ key, slug, name, description, actionType, isPage: false, ...extra });

// Which heading each permission sits under in the RBAC admin UI. A module whose
// permissions carry a `group` is rendered as a full, always-visible checklist
// there, instead of the default matrix that hides its finer controls until one
// is already ticked.
const GROUP_BY_KEY = {
  VIEW_PAYMENT_SETTLEMENT: 'Access & Views',
  VIEW_PAYMENT_SETTLEMENT_PAYMENTS: 'Access & Views',
  VIEW_PAYMENT_SETTLEMENT_INSTRUMENTS: 'Access & Views',
  VIEW_PAYMENT_SETTLEMENT_GRN: 'Access & Views',
  VIEW_PAYMENT_SETTLEMENT_HISTORY: 'Access & Views',

  COMPLETE_SETTLEMENT_STEP1: 'Settlement Steps',
  COMPLETE_SETTLEMENT_STEP2: 'Settlement Steps',
  COMPLETE_SETTLEMENT_STEP3: 'Settlement Steps',
  EDIT_SETTLEMENT_STEP: 'Settlement Steps',

  BULK_SETTLE_SETTLEMENT: 'Forwards & Loans',
  CREATE_SETTLEMENT_FORWARD: 'Forwards & Loans',
  EDIT_SETTLEMENT_FORWARD: 'Forwards & Loans',
  DELETE_SETTLEMENT_FORWARD: 'Forwards & Loans',
  CREATE_SETTLEMENT_LOAN: 'Forwards & Loans',
  EDIT_SETTLEMENT_LOAN: 'Forwards & Loans',
  DELETE_SETTLEMENT_LOAN: 'Forwards & Loans',

  MANAGE_SETTLEMENT_MASTER: 'Dropdowns',

  RELEASE_SETTLEMENT_GRN: 'GRN Release',
  EDIT_SETTLEMENT_GRN: 'GRN Release',
  CLOSE_SETTLEMENT_CI: 'GRN Release',
  REOPEN_SETTLEMENT_CI: 'GRN Release',
};

const RAW_SETTLEMENT_PERMISSIONS = [
  // ── Getting in, and what you can see ──
  P('VIEW_PAYMENT_SETTLEMENT', 'payment_settlement.view', 'Open Payment Settlement',
    'Open the Payment Settlement page. Without this nothing else here applies.', 'READ', { isPage: true }),
  P('VIEW_PAYMENT_SETTLEMENT_PAYMENTS', 'payment_settlement.view.payments', 'View Payments Tab',
    'See the payment lanes: every confirmed receipt and its three settlement steps.', 'READ'),
  P('VIEW_PAYMENT_SETTLEMENT_INSTRUMENTS', 'payment_settlement.view.instruments', 'View Forwards & Loans Tab',
    'See forward bookings and PCFC / EPC loans with their outstanding balances.', 'READ'),
  P('VIEW_PAYMENT_SETTLEMENT_GRN', 'payment_settlement.view.grn', 'View GRN Release Tab',
    'See commercial invoices with invoiced / received / pending and their GRN state.', 'READ'),
  P('VIEW_PAYMENT_SETTLEMENT_HISTORY', 'payment_settlement.view.all_history', 'View Full History',
    'Use the "All history" toggle to look past the tracking start date.', 'READ'),

  // ── The three settlement steps ──
  P('COMPLETE_SETTLEMENT_STEP1', 'payment_settlement.step1.complete', 'Complete Step 1 — Settlement',
    'Record how a receipt is settled: forward, cash, PCFC or EPC.', 'UPDATE'),
  P('COMPLETE_SETTLEMENT_STEP2', 'payment_settlement.step2.complete', 'Complete Step 2 — Bank Rec Rate',
    'Record the rate the bank credited at and the rupee amount received.', 'UPDATE'),
  P('COMPLETE_SETTLEMENT_STEP3', 'payment_settlement.step3.complete', 'Complete Step 3 — Voucher Entry',
    'Record the voucher number and the payment reference number.', 'UPDATE'),
  P('EDIT_SETTLEMENT_STEP', 'payment_settlement.step.edit', 'Correct a Recorded Step',
    'Change what a completed step recorded. The original completion time — and its delay — are kept.', 'UPDATE'),

  // ── Forward bookings and loans ──
  P('BULK_SETTLE_SETTLEMENT', 'payment_settlement.bulk_settle', 'Bulk Settle Against a Booking',
    'Draw one forward booking or loan down across several receipts at once.', 'UPDATE'),
  P('CREATE_SETTLEMENT_FORWARD', 'payment_settlement.forward.create', 'Book a Forward',
    'Add a forward contract with its rate, amount and maturity.', 'CREATE'),
  P('EDIT_SETTLEMENT_FORWARD', 'payment_settlement.forward.edit', 'Edit a Forward Booking',
    'Correct a recorded forward contract.', 'UPDATE'),
  P('DELETE_SETTLEMENT_FORWARD', 'payment_settlement.forward.delete', 'Remove a Forward Booking',
    'Remove a forward contract that has no settlements drawn against it.', 'DELETE'),
  P('CREATE_SETTLEMENT_LOAN', 'payment_settlement.loan.create', 'Record a PCFC / EPC Loan',
    'Add a dollar or rupee loan with its amount, interest and maturity days.', 'CREATE'),
  P('EDIT_SETTLEMENT_LOAN', 'payment_settlement.loan.edit', 'Edit a PCFC / EPC Loan',
    'Correct a recorded loan.', 'UPDATE'),
  P('DELETE_SETTLEMENT_LOAN', 'payment_settlement.loan.delete', 'Remove a PCFC / EPC Loan',
    'Remove a loan that has no settlements drawn against it.', 'DELETE'),

  // ── The dropdowns behind the forms ──
  // UPDATE, not WRITE: the RBAC admin UI only builds bulk buttons for CREATE /
  // READ / UPDATE / DELETE, so a WRITE action would sit outside all of them.
  P('MANAGE_SETTLEMENT_MASTER', 'payment_settlement.master.manage', 'Manage Settlement Dropdowns',
    'Add, rename or remove settlement types and bank receive types.', 'UPDATE'),

  // ── GRN release ──
  P('RELEASE_SETTLEMENT_GRN', 'payment_settlement.grn.release', 'Record a GRN Release',
    'File the bank reference, shipping bill and copies against a releasable invoice.', 'UPDATE'),
  P('EDIT_SETTLEMENT_GRN', 'payment_settlement.grn.edit', 'Edit a Recorded GRN Release',
    'Change a release that was already recorded. The original release time is kept.', 'UPDATE'),
  P('CLOSE_SETTLEMENT_CI', 'payment_settlement.ci.close', 'Close a Short Invoice',
    'Write off the balance on an invoice that is still short so its GRN can be released.', 'UPDATE'),
  P('REOPEN_SETTLEMENT_CI', 'payment_settlement.ci.reopen', 'Reopen a Closed Invoice',
    'Undo a manual close, putting the invoice back to short of its value.', 'UPDATE'),
];

/** The full catalogue, in the order it should read in the admin UI. */
export const SETTLEMENT_PERMISSIONS = RAW_SETTLEMENT_PERMISSIONS.map((p) => ({
  ...p,
  group: GROUP_BY_KEY[p.key] || 'Other',
}));

/** Headings, in the order they should appear. */
export const SETTLEMENT_GROUPS = [...new Set(SETTLEMENT_PERMISSIONS.map((p) => p.group))];

export const SETTLEMENT_SLUGS = SETTLEMENT_PERMISSIONS.map((p) => p.slug);

/** `{ VIEW_PAYMENT_SETTLEMENT: 'payment_settlement.view', … }` — spread into lib/roles.js. */
export const SETTLEMENT_PERMISSION_MAP = SETTLEMENT_PERMISSIONS.reduce((acc, p) => {
  acc[p.key] = p.slug;
  return acc;
}, {});

// Who gets what by default. The write-off and the undo stay off the operator set:
// they are money decisions, granted deliberately in the RBAC admin UI.
export const SETTLEMENT_RESTRICTED_SLUGS = [
  'payment_settlement.step.edit',
  'payment_settlement.grn.edit',
  'payment_settlement.ci.close',
  'payment_settlement.ci.reopen',
  'payment_settlement.forward.delete',
  'payment_settlement.loan.delete',
];

export const SETTLEMENT_OPERATOR_SLUGS = SETTLEMENT_SLUGS
  .filter((s) => !SETTLEMENT_RESTRICTED_SLUGS.includes(s));

export const SETTLEMENT_VIEWER_SLUGS = SETTLEMENT_SLUGS.filter((s) => s.includes('.view'));

/**
 * Does this permission list allow `slug`? True when the slug is held directly, or
 * when an older umbrella slug that used to cover it is.
 */
export function allowsSettlementAction(permissions, slug) {
  const held = Array.isArray(permissions) ? permissions : [];
  if (held.includes(slug)) return true;
  return Object.entries(LEGACY_IMPLIES)
    .some(([legacy, covers]) => covers.includes(slug) && held.includes(legacy));
}

/** Every slug that grants `slug` — the direct one plus any legacy umbrella. */
export function slugsGranting(slug) {
  const legacy = Object.entries(LEGACY_IMPLIES)
    .filter(([, covers]) => covers.includes(slug))
    .map(([l]) => l);
  return [slug, ...legacy];
}
