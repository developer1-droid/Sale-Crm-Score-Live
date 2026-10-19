// VERBATIM COPY of CRM lib/rules/names.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/rules/names.js
//
// The names the registry's default steps and the boards' clocks both use: the
// flows a step can live on and the calendars a plan can run on.
//
// They sat in ./steps-default.js, which every clock imports from — so a clock
// could not import them back without a cycle. Here they depend on nothing, and
// ./steps-default.js re-exports them for its readers.
//
// Pure data.

export const FLOW = Object.freeze({
  CRM_FMS: 'crmFms',
  SO_FMS: 'soFms',
  DESIGN_APPROVAL: 'designApproval',
  DESIGN_REQUEST: 'designRequest',
  TICKET: 'ticket',
  HRERP_DESIGN: 'hrerpDesign',
  HRERP_CYLINDER: 'hrerpCylinder',
});

export const CALENDAR = Object.freeze({ OFFICE: 'office', OFFICE_DA: 'officeDa', DESIGNER: 'designer' });
