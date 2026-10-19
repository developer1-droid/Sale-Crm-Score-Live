// VERBATIM COPY of CRM lib/designManagementApproval.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// Management Approval eligibility + anchoring. Pure, client-safe, Firebase-free
// so it can be imported by both the API route and the approval page, and unit
// tested directly (repo convention: pure-logic tests in lib/__tests__).

// Only these two design categories get a management approval step.
export const MANAGEMENT_CATEGORIES = ['private_label_new', 'private_label_regular'];

// The day the management step went live (spec 2026-08-05), at local midnight.
// A design approved upstream before it never had the step, and no management
// clock may start earlier than it.
export const MANAGEMENT_STEP_LIVE_AT = new Date(2026, 7, 5);

// Lowercase and collapse _/-/whitespace to a single space, matching how
// isOurBrandCategory normalizes the sheet's free-form Design Category values.
const normalizeCategory = (category) =>
  String(category || '')
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/g, ' ');

// True when a design category requires a management approval step.
export const requiresManagementApproval = (designCategory) => {
  const c = normalizeCategory(designCategory);
  return c === 'private label new' || c === 'private label regular';
};

// Which upstream approval opens the management step for this category:
//   private_label_regular -> 'crm'   (parallel with buyer, anchored at CRM approval)
//   private_label_new     -> 'buyer' (sequential, anchored at buyer approval)
export const managementAnchorStep = (designCategory) => {
  const c = normalizeCategory(designCategory);
  if (c === 'private label regular') return 'crm';
  if (c === 'private label new') return 'buyer';
  return null;
};

// The step becomes actionable once its anchor timestamp ("Management Sent At")
// has been stamped by the backend.
export const isManagementOpen = (managementSentAt) =>
  String(managementSentAt || '').trim() !== '';

// Message shown in the locked cell before the step opens.
export const managementLockMessage = (designCategory) => {
  const step = managementAnchorStep(designCategory);
  if (step === 'crm') return 'Awaiting CRM';
  if (step === 'buyer') return 'Awaiting Buyer';
  return null;
};
