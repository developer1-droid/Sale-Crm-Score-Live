// VERBATIM COPY of CRM lib/team-roles.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/team-roles.js
// Canonical job-role buckets for a team member, and the mapping from the free-text
// `Designation` column onto them.
//
// Extracted from hooks/useTeamDirectory (which stays the client-side reader) so a
// SERVER route can ask "is this person a CRM Executive?" without importing a
// 'use client' module. Both sides must answer that question identically — a
// transfer authorised in the browser and re-checked on the server has to agree.

/* Canonical role buckets used across reports, scoring and ownership checks. */
export const ROLE = {
  CRM: 'CRM Executive',
  SALES: 'Sales Coordinator',
  HEAD: 'CRM Head',
  DESIGNER: 'Designer',
  PC: 'Process Coordinator',
  OTHER: 'Other',
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Map a raw designation string to one of the canonical buckets (or null). */
export const normalizeDesignation = (d) => {
  const n = norm(d);
  if (!n) return null;
  if (n.includes('sales')) return ROLE.SALES;
  if (n.includes('crm') && n.includes('head')) return ROLE.HEAD;
  if (n.includes('crm')) return ROLE.CRM;
  if (n.includes('design')) return ROLE.DESIGNER;
  // Process Coordinator / operations — the ops desk (order scheduling, follow-up).
  // Kept narrow (no bare "coordinator", which would swallow Sales Coordinator).
  if (n.includes('process') || n.includes('operation') || /\bops\b/.test(n) || n === 'pc') return ROLE.PC;
  return null; // unrecognized designation → caller treats as "Other"
};

/** The CRM side of the house — the people a PI's ownership can sit with. */
export const isCrmSide = (member) => {
  const bucket = normalizeDesignation(member?.designation);
  return bucket === ROLE.CRM || bucket === ROLE.HEAD;
};

/** Sales Coordinator — the role that owns a cluster of CRMs. */
export const isSalesCoordinator = (member) => normalizeDesignation(member?.designation) === ROLE.SALES;

/**
 * Is this member still on the desk? The directory keeps leavers, and a PI must
 * never be transferred to one. `status` arrives as a boolean from Firestore and
 * as text from the sheet, so both shapes are read.
 */
export const isActiveMember = (member) => {
  const status = member?.status;
  if (status === false) return false;
  const text = norm(status);
  return !(text === 'inactive' || text === 'disabled' || text === 'false' || text === 'left');
};
