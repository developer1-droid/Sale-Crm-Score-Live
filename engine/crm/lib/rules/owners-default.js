// VERBATIM COPY of CRM lib/rules/owners-default.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/owners-default.js
//
// Who answers for a step today, written down: the fixed duties and the
// designer roster that the reports and boards hard-code in several places.
//
// The values are today's on purpose. A registry built on them names the same
// people the reports name now; moving a duty to someone else becomes an edit
// to this data instead of a hunt through the code for every copy.
//
// Pure and Firebase-free.

/** How a step finds its owner (the shared rules contract). */
export const OWNER_KIND = Object.freeze({
  /** The PI's CRM: the PI creator, resolved by email (app/api/pc-report/route.js:441-442). */
  PI_OWNER: 'piOwner',
  /**
   * The PI's CRM when the step fell due, from the transfers app/api/pi-transfer
   * records (lib/step-feed/pi-transfers.js): a transfer does not move history.
   */
  PI_OWNER_AT_DUE: 'piOwnerAtDue',
  /** Whoever raised the request (Design Approval's 'Requested By'). */
  REQUESTER: 'requester',
  /** Every person on a duty in `duties`. */
  DUTY: 'duty',
  /** The design request's assigned designer. */
  DESIGNER: 'designer',
  /** A ticket's assignee. */
  ASSIGNEE: 'assignee',
  /** Whoever HR-ERP's own doer master names for the step. */
  HRERP_DOER: 'hrerpDoer',
  /** The management reviewer configured in Settings, else the 'Management' desk. */
  MANAGEMENT: 'management',
});

/** Duty keys the steps and the Process Coordinator lens name. */
export const DUTY = Object.freeze({
  ORDER_SCHEDULING: 'orderScheduling',
  FOLLOW_UP_COORDINATOR: 'followUpCoordinator',
  MANAGEMENT: 'management',
  ACCOUNTS: 'accounts',
});

// Step-0's owner, as every feed, report and score names her: lib/so-fms-catalog.js
// ORDER_SCHEDULING_OWNER reads the name from here. Her address is the one the MIS
// desk already uses (lib/system-feedback-desk.js:19).
const ORDER_SCHEDULING_NAME = 'Sakshi Garg';
const ORDER_SCHEDULING_EMAIL = 'sakshi@shaziarice.com';

// The follow-up coordinator lib/scoring/crmExecScore.js FOLLOWUP_COORDINATOR reads from here.
const FOLLOW_UP_COORDINATOR = Object.freeze({ email: 'janki@shaziarice.com', name: 'Janki Singh' });

// The owner a management approval falls back to when Settings names no
// reviewer (hooks/useMisSteps.js:232, :390). The reviewer itself is
// systemSettings/globalCutoffDates.managementNotifyEmail / managementNotifyName,
// a runtime value, so the duty starts with nobody on it.
const MANAGEMENT_DESK_LABEL = 'Management';

// The accounts desk: its address as the notification presets use it
// (scripts/fix-notification-recipients.mjs:41), held by Amit (Accounts
// Executive in the team list). CRM FMS Step-4, the advance payment
// confirmation, is the desk's (owner, 16 Oct 2026, decision 30).
const ACCOUNTS_EMAIL = 'accdept.hrexports@shaziarice.com';
const ACCOUNTS_HOLDER = 'Amit';
const ACCOUNTS_LABEL = 'Accounts';

/** @type {Object<string, {label: string, people: {email: string, name: string}[]}>} */
export const DEFAULT_DUTIES = {
  [DUTY.ORDER_SCHEDULING]: {
    label: 'Order Scheduling',
    people: [{ email: ORDER_SCHEDULING_EMAIL, name: ORDER_SCHEDULING_NAME }],
  },
  [DUTY.FOLLOW_UP_COORDINATOR]: {
    label: 'Follow-up Coordinator',
    people: [{ ...FOLLOW_UP_COORDINATOR }],
  },
  [DUTY.MANAGEMENT]: {
    label: MANAGEMENT_DESK_LABEL,
    people: [],
  },
  [DUTY.ACCOUNTS]: {
    label: ACCOUNTS_LABEL,
    people: [{ email: ACCOUNTS_EMAIL, name: ACCOUNTS_HOLDER }],
  },
};

/**
 * The design team as the CRM knows it today: app/api/design-approval/route.js:40-44
 * (DESIGNER_EMAIL_MAP, mirrored in lib/designExhibitionNotify.js:49-53).
 *
 * Today's designer score keys a designer on the free-text 'Assigned Designer'
 * (lib/scoring/designerScore.js:62); `aliases` are exactly the spellings that
 * map looks up, lower-cased. No HR-ERP user id reaches the CRM yet.
 *
 * @type {{email: string, name: string, hrerpUserId: string|null, aliases: string[]}[]}
 */
export const DEFAULT_DESIGNERS = [
  { email: 'designs@shaziarice.com', name: 'Rishabh Rawat', hrerpUserId: null, aliases: ['rishabh rawat'] },
  { email: 'designs2@shaziarice.com', name: 'Manoj', hrerpUserId: null, aliases: ['manoj'] },
  { email: 'designs3@shaziarice.com', name: 'Arun', hrerpUserId: null, aliases: ['arun'] },
];
