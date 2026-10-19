// VERBATIM COPY of CRM lib/team-directory.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/team-directory.js
//
// The three resolvers a report reads a step owner through — the person's
// role (designationOf), their canonical key (identityOf) and their display
// name (nameOf) — built once from the team roster that /api/teamSheets serves
// ({ name, email, designation } per member).
//
// They were the useMemo bodies of hooks/useTeamDirectory.js, a 'use client'
// hook. Pure here, so the hook, a server route and Score Live's TV board
// (score-live/engine/crmBoard.js) resolve an owner one way.

import { ROLE, normalizeDesignation } from './team-roles.js';

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const emailLocal = (e) => e.split('@')[0].replace(/[._]+/g, ' ').trim();

/* Owner sentinels that carry no real person — these resolve to null. */
const NO_OWNER = new Set(['', 'unassigned', 'unknown', 'so team', 'na', 'n/a', '-']);

/**
 * Owner string (name or email) → job designation (ROLE.*). The MIS feed labels
 * each step with an `owner` string but never says what ROLE that person holds;
 * the single source of truth is the `Designation` column on each team member.
 */
function buildDesignationOf(members) {
  const byEmail = new Map();   // full email           → role
  const byLocal = new Map();   // email local-part     → role
  const byName = new Map();    // full normalized name → role
  const byFirst = new Map();   // first token          → Set<role>

  members.forEach((m) => {
    const role = normalizeDesignation(m.designation);
    if (!role) return;
    const email = norm(m.email);
    if (email.includes('@')) {
      byEmail.set(email, role);
      byLocal.set(emailLocal(email), role);
    }
    const name = norm(m.name);
    if (name) {
      byName.set(name, role);
      const first = name.split(' ')[0];
      if (first) {
        if (!byFirst.has(first)) byFirst.set(first, new Set());
        byFirst.get(first).add(role);
      }
    }
  });

  const firstTokenRole = (token) => {
    const set = byFirst.get(token);
    return set && set.size === 1 ? [...set][0] : null; // only if unambiguous
  };

  return (owner) => {
    const raw = norm(owner);
    if (NO_OWNER.has(raw)) return null;
    if (raw.includes('@')) {
      const local = emailLocal(raw);
      return byEmail.get(raw) || byLocal.get(local) || byName.get(local)
        || firstTokenRole(local.split(' ')[0]) || ROLE.OTHER;
    }
    return byName.get(raw) || firstTokenRole(raw.split(' ')[0]) || ROLE.OTHER;
  };
}

/**
 * Owner string (name OR email) → canonical identity key: the person's email
 * when it can be established, else their normalized name. Lets a report answer
 * "is this MY step?" exactly (email-based) instead of by a first-name substring
 * match. Mirrors how the Sales scorecard attributes each PI to a person by email.
 */
function buildIdentityOf(members) {
  const emailByName = new Map();  // normalized full name → email
  const emailByLocal = new Map(); // email local-part     → email
  members.forEach((m) => {
    const email = norm(m.email);
    if (!email.includes('@')) return;
    emailByLocal.set(emailLocal(email), email);
    const name = norm(m.name);
    if (name) emailByName.set(name, email);
  });
  return (owner) => {
    const raw = norm(owner);
    if (NO_OWNER.has(raw)) return null;
    if (raw.includes('@')) return raw; // an email is already a canonical key
    // A bare name: resolve to its owner's email when known, else the name
    // itself so two identical unknown names still collapse to one key.
    return emailByName.get(raw) || emailByLocal.get(emailLocal(raw)) || raw;
  };
}

/**
 * Owner string (name OR email) → the person's display name as the directory
 * spells it, so a report shows "Shivani Yadav" instead of the email-derived
 * "Crm1". Falls back to a title-cased email local-part, else the raw string.
 */
function buildNameOf(members) {
  const byEmail = new Map();  // full email       → display name
  const byLocal = new Map();  // email local-part → display name
  const byName = new Map();   // normalized name  → display name (canonical case)
  members.forEach((m) => {
    const display = String(m.name || '').trim();
    const email = norm(m.email);
    if (email.includes('@')) {
      if (display) { byEmail.set(email, display); byLocal.set(emailLocal(email), display); }
    }
    if (display) byName.set(norm(display), display);
  });
  const titleCase = (s) => s.replace(/\b\w/g, (l) => l.toUpperCase());
  return (owner) => {
    const raw = norm(owner);
    if (NO_OWNER.has(raw)) return '';
    if (raw.includes('@')) {
      return byEmail.get(raw) || byLocal.get(emailLocal(raw)) || titleCase(emailLocal(raw));
    }
    return byName.get(raw) || String(owner || '').trim();
  };
}

/**
 * The resolvers over one roster. Anything that is not an array of members
 * reads as an empty roster: every owner is then ROLE.OTHER, keyed and named
 * by their own string.
 *
 * @param {{ name?: string, email?: string, designation?: string }[]} members
 * @returns {{
 *   designationOf: (owner: string) => string|null,
 *   identityOf: (owner: string) => string|null,
 *   nameOf: (owner: string) => string,
 * }}
 */
export function createTeamDirectory(members) {
  const roster = Array.isArray(members) ? members : [];
  return {
    designationOf: buildDesignationOf(roster),
    identityOf: buildIdentityOf(roster),
    nameOf: buildNameOf(roster),
  };
}
