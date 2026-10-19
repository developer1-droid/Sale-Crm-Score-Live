// VERBATIM COPY of CRM lib/step-feed/owners.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/step-feed/owners.js
//
// Who owns a step, as the registry says (rules.steps[key].owner, with the
// kinds of lib/rules/owners-default.js OWNER_KIND), named by canonical email.
//
// Each board's adapter states who could own its step — the PI's CRM, the
// requester, the assignee — and which of them the board itself names
// (`ownKind`). The step's owner rule picks:
//   piOwner       the PI's current CRM
//   piOwnerAtDue  whoever held the PI when the step fell due — its plan, else
//                 its finish — from the PI's transfers (pi-transfers.js); the
//                 current CRM when the PI has not moved since (decision 12)
//   duty          the first person the registry puts on the duty (decision
//                 12's editable duty list). Settings' management reviewer fills
//                 the Management duty while it has nobody; any other empty duty
//                 is a desk, its label, naming nobody
//   management    Settings' management reviewer, else the Management duty's desk
//   requester, assignee …  as the board names them
// A kind the board cannot answer for — a help ticket's design row has no PI —
// falls back to the board's own owner: decision 10's "a help ticket with no
// PI keeps its requester".
//
// Beside the owner — whom the step is scored to — the feed names its chase
// owner: whoever can act on it now, whom the chase lists (the PC report's open
// items, the pending-work digest) send it to. They differ only for a step read
// as of when it fell due (piOwnerAtDue) that is still open on a PI transferred
// since: it stays the earlier CRM's score, and the PI's current CRM is chased
// for it (decision 12). A done step is history and stays with its owner; under
// today's rules no step is read that way, so the two are always the same.
//
// The boards name an owner three ways: an email, a directory name or a desk
// ('SO Team', 'Management', 'Unassigned'). The reports fold them with
// hooks/useTeamDirectory.js identityOf; this does the same over a plain
// name/email → email map so the server can run it. An owner nobody can name
// keeps the step — it is listed with no email and the kind 'unknown', never
// dropped.
//
// Pure.

import { dutyHolder, dutyLabel } from '../rules/duties.js';
import { DUTY, OWNER_KIND } from '../rules/owners-default.js';
import { holderAt } from './pi-transfers.js';

export const OWNER_KIND_UNKNOWN = 'unknown';

/** The feed's status of a finished step (lib/step-feed/build.js StepFact). */
const DONE = 'DONE';

/** Owner strings that carry no person (hooks/useTeamDirectory.js NO_OWNER). */
const NO_OWNER = new Set(['', 'unassigned', 'unknown', 'so team', 'na', 'n/a', '-']);

const text = (value) => String(value ?? '').trim();
const norm = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');
const isEmail = (value) => value.includes('@');
/** 'shivani.yadav@x.com' → 'shivani yadav', the name an email usually spells. */
const emailLocal = (email) => email.split('@')[0].replace(/[._]+/g, ' ').trim();
const ownEntry = (record, key) =>
  (record && typeof key === 'string' && Object.hasOwn(record, key) ? record[key] : undefined);

/**
 * A team directory as the feed wants it: every name and email a member goes by
 * → their email. Built from /api/teamSheets members ({ name, email }).
 *
 * @param {{ name?: string, email?: string }[]} members
 * @returns {Map<string, string>}
 */
export function teamDirectoryOf(members = []) {
  const directory = new Map();
  (members || []).forEach((member) => {
    const email = norm(member?.email);
    if (!isEmail(email)) return;
    directory.set(email, email);
    const name = norm(member?.name);
    if (name) directory.set(name, email);
  });
  return directory;
}

/**
 * An owner string → canonical lower-case email, or '' when nobody can be named.
 * Mirrors hooks/useTeamDirectory.js identityOf: an email is already canonical;
 * a name is looked up as written, then as the local part of a known email.
 *
 * @param {Map<string, string>|Object<string, string>|null} teamDirectory  name or email → email.
 * @returns {(owner: string) => string}
 */
export function createOwnerResolver(teamDirectory) {
  const entries = teamDirectory instanceof Map ? [...teamDirectory.entries()] : Object.entries(teamDirectory || {});
  const emailByName = new Map();
  const emailByLocal = new Map();
  entries.forEach(([key, value]) => {
    const email = norm(value);
    if (!isEmail(email)) return;
    emailByLocal.set(emailLocal(email), email);
    const name = norm(key);
    if (name) emailByName.set(name, email);
  });
  return (owner) => {
    const raw = norm(owner);
    if (NO_OWNER.has(raw)) return '';
    if (isEmail(raw)) return raw;
    return emailByName.get(raw) || emailByLocal.get(emailLocal(raw)) || '';
  };
}

/* ── who could own a step ────────────────────────────────────────────────── */

/**
 * @typedef {{ owner: string, hint: string }} OwnerCandidate  An owner string as
 *   the board or the registry names them, and an address recorded beside it.
 */

/**
 * One way a step can be owned; null when neither the owner nor the address says anything.
 * @returns {OwnerCandidate|null}
 */
export function ownerCandidate(owner, hint = '') {
  const named = text(owner);
  const address = text(hint);
  if (!named && !address) return null;
  return { owner: named || address, hint: address };
}

/** Whether any step's owner is read as of when it fell due, so the feed needs the PIs' transfers. */
export const readsOwnerHistory = (rules) =>
  Object.values(rules?.steps ?? {}).some((step) => step?.owner?.kind === OWNER_KIND.PI_OWNER_AT_DUE);

/** A duty with nobody on it, as a desk: its label, naming nobody. */
const deskOf = (rules, dutyKey) => ownerCandidate(dutyLabel(rules, dutyKey));

/** The first person on the duty; Settings' reviewer while the Management duty has nobody; else the duty's desk. */
function dutyOwner(rules, dutyKey, reviewer) {
  const holder = dutyHolder(rules, dutyKey);
  if (!holder.email && dutyKey === DUTY.MANAGEMENT && text(reviewer)) return ownerCandidate(reviewer);
  return ownerCandidate(holder.name, holder.email);
}

/** The PI's CRM when the step fell due — its plan, else its finish — or the current CRM when the PI has not moved since. */
function piOwnerAtDue(record, history) {
  const { step } = record;
  const holder = holderAt(history, step?.piNo, step?.planDate || step?.actDate || null);
  return holder ? ownerCandidate(holder, holder) : record.owners?.[OWNER_KIND.PI_OWNER] || null;
}

/** The candidate a kind of owner picks for one record; null when the board cannot answer for that kind. */
function candidateFor(kind, ownerRule, record, context) {
  switch (kind) {
    case OWNER_KIND.PI_OWNER_AT_DUE:
      return piOwnerAtDue(record, context.history);
    case OWNER_KIND.DUTY:
      return dutyOwner(context.rules, ownerRule?.duty, context.reviewer);
    case OWNER_KIND.MANAGEMENT:
      return ownerCandidate(context.reviewer) || deskOf(context.rules, DUTY.MANAGEMENT);
    default:
      return ownEntry(record.owners, kind) || null;
  }
}

/**
 * The owner the rule names; else the board's own, under the board's kind —
 * or under none of the registry's when the registry has no rule for the step;
 * else the owner string the step carries.
 */
function chooseOwner(record, rule, context) {
  const ruleKind = text(rule?.owner?.kind);
  const fromRule = ruleKind ? candidateFor(ruleKind, rule.owner, record, context) : null;
  if (fromRule) return { ...fromRule, kind: ruleKind };
  const fromBoard = record.ownKind ? candidateFor(record.ownKind, null, record, context) : null;
  if (!fromBoard) return { owner: text(record.step?.owner), hint: '', kind: '' };
  return { ...fromBoard, kind: rule ? record.ownKind : '' };
}

/**
 * Whom a chase sends the step to: the PI's current CRM for an open step read
 * as of when it fell due, the owner for any other (see the note at the top).
 */
function chaseCandidate(record, chosen) {
  if (chosen.kind !== OWNER_KIND.PI_OWNER_AT_DUE || record.step?.status === DONE) return chosen;
  return record.owners?.[OWNER_KIND.PI_OWNER] || chosen;
}

/** A candidate's canonical email: the address recorded beside it, else its owner string. */
const emailOfCandidate = ({ owner, hint }, resolve) => resolve(hint) || resolve(owner);

/**
 * @param {{ step: object, owners?: Object<string, OwnerCandidate|null>, ownKind?: string }} record
 *   An adapter's record: who could own the step, by OWNER_KIND, and the kind the board names.
 * @param {import('../rules/contract.js').StepRule|null} rule
 * @param {{ rules: object, resolve: (owner: string) => string, reviewer?: string, history?: Map }} context
 *   `reviewer`: Settings' management reviewer; `history`: the PIs' transfers (pi-transfers.js transferHistory).
 * @returns {{ owner: string, ownerEmail: string, ownerKind: string, chaseOwner: string, chaseOwnerEmail: string }}
 */
export function ownerOf(record, rule, context) {
  const chosen = chooseOwner(record, rule, context);
  const ownerEmail = emailOfCandidate(chosen, context.resolve);
  const chase = chaseCandidate(record, chosen);
  return {
    owner: chosen.owner,
    ownerEmail,
    ownerKind: ownerEmail && chosen.kind ? chosen.kind : OWNER_KIND_UNKNOWN,
    chaseOwner: chase.owner,
    chaseOwnerEmail: chase === chosen ? ownerEmail : emailOfCandidate(chase, context.resolve),
  };
}

/**
 * A feed item as a chase list reads it: owned by its chase owner, whoever can
 * act on it now. Scores keep reading `owner`. An item that names no chase
 * owner — one built by hand — is chased to its owner.
 *
 * @template {{ owner?: string, ownerEmail?: string, chaseOwner?: string, chaseOwnerEmail?: string }} T
 * @param {T} item
 * @returns {T}
 */
export const withChaseOwner = (item) => ({
  ...item,
  owner: item.chaseOwner ?? item.owner,
  ownerEmail: item.chaseOwnerEmail ?? item.ownerEmail,
});
