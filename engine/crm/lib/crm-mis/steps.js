// VERBATIM COPY of CRM lib/crm-mis/steps.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/crm-mis/steps.js
//
// The step feed (GET /api/step-feed, lib/step-feed/build.js) as the MIS engine
// (lib/mis) reads it: one MisStep per feed item a scoring profile counts.
//
// Which items: the registry decides. An item's `stepKey` names its rule, and
// the rule's `scoreIn` names the profiles that score it, so under
// lib/rules/defaults.js the 'crmExec' profile is today's CRM Executive cohort
// of steps, and the page asks for whichever profile it shows. Left out: an
// item the cutoff keeps out (`scope.inScope` false), one the registry has no
// rule for, and one the board has not planned yet (no `planned` means nothing
// can fall due).
//
// What a row carries:
//   doers       the owner the feed named by email, with the name the registry
//               or any feed row gives that address; [] when the feed could
//               name nobody, which the engine scores to "Unassigned" (a gap to
//               fill, never a silent drop)
//   plannedAt, actualAt, delayMin   the board's own clock, as the feed states it
//   status      the board's word ('DONE', 'OVERDUE', 'HOLD' …), carried for the
//               drill-down; the engine reads actualAt and excuse, not this
//   excuse      the board's reason when it shows the step closed, waived or
//               held. A HOLD with no reason is an open step like any other: a
//               manual close or hold needs a visible reason before it excuses
//               anything. A step the board shows DONE with no finish time on
//               record is excused with that said ('Done on the board; no
//               finish time recorded'): done is never missed nor backlog, and
//               with no finish there is no on-time to score.
//   code, label the registry's, so a step reads the same in every report and a
//               person's breakdown groups every help ticket as the one TK step
//               (the ticket's own id and title are in refs)
//   refs        what the row is about, for the list and the search box
//
// Pure; lib/__tests__/crm-mis-steps.test.js.

// The feed's tab names (lib/step-feed/registry.js TAB), restated so the page
// does not bundle the board code that module imports.
const TAB = Object.freeze({ CRM_FMS: 'CRM FMS', SO_FMS: 'SO FMS', DESIGN_APPROVAL: 'Design Approval', TICKETS: 'Tickets' });

const DONE = 'DONE';
/** The excuse of a step the board shows done with no finish time it can read. */
export const UNDATED_DONE_REASON = 'Done on the board; no finish time recorded';

const text = (value) => String(value ?? '').trim();
const isEmail = (value) => text(value).includes('@');
const joinParts = (parts, separator = ' · ') => parts.map(text).filter(Boolean).join(separator);

/** The ISO text the feed carries when it names an instant; null when it is blank or unreadable. */
function isoOf(value) {
  const iso = text(value);
  return iso && Number.isFinite(Date.parse(iso)) ? iso : null;
}

/** A rule of the registry by key, without ever reaching Object.prototype. */
const ruleOf = (rules, stepKey) =>
  (typeof stepKey === 'string' && rules?.steps && Object.hasOwn(rules.steps, stepKey) ? rules.steps[stepKey] : null);

/**
 * The name each owner address goes by: the registry's duty people and
 * designers first (they name a person on purpose), then the first feed row
 * that names the address by a name rather than by the address itself.
 * @returns {Map<string, string>}  Lower-case email → name.
 */
export function doerNamesOf(items, rules) {
  const names = new Map();
  const learn = (email, name) => {
    const address = text(email).toLowerCase();
    const label = text(name);
    if (address && label && !isEmail(label) && !names.has(address)) names.set(address, label);
  };
  Object.values(rules?.duties ?? {}).forEach((duty) => (duty?.people ?? []).forEach((p) => learn(p?.email, p?.name)));
  (rules?.designers ?? []).forEach((p) => learn(p?.email, p?.name));
  (items ?? []).forEach((item) => learn(item?.ownerEmail, item?.owner));
  return names;
}

/** The feed's owner as the engine's people: one, by email, or nobody. */
function doersOf(item, names) {
  const email = text(item.ownerEmail).toLowerCase();
  if (!email) return [];
  return [{ email, name: names.get(email) ?? email }];
}

/**
 * The board's reason, as the engine's excuse; the feed carries no signature
 * with it. A step done with no finish time (`actualAt` null) is excused as
 * such, so the engine never reads it as open.
 */
function excuseOf(item, actualAt) {
  const reason = text(item.excuse);
  if (reason) return { reason, by: null, at: null };
  return text(item.status) === DONE && !actualAt ? { reason: UNDATED_DONE_REASON, by: null, at: null } : null;
}

/** "PI 26127", "SO 2631 · CI HR/ES/26/0121", "Design 26127-MC", "Ticket CON-TKT-1". */
function refOf(item) {
  switch (item.tab) {
    case TAB.SO_FMS:
      return joinParts([item.soNumber && `SO ${item.soNumber}`, item.ciNo && `CI ${item.ciNo}`]) || text(item.indentNo);
    case TAB.DESIGN_APPROVAL:
      return `Design ${text(item.indentNo)}`;
    case TAB.TICKETS:
      return `Ticket ${text(item.indentNo)}`;
    default:
      return `PI ${text(item.piNo || item.indentNo)}`;
  }
}

/** The line under the reference: the ticket's title, the buyer, the brand, the PI an order belongs to. */
function detailOf(item) {
  const piOfOrder = item.tab === TAB.SO_FMS && item.piNo ? `PI ${item.piNo}` : '';
  const title = item.tab === TAB.TICKETS ? item.stepName : '';
  return joinParts([title, item.buyerName, item.brand, piOfOrder]);
}

function refsOf(item) {
  return {
    ref: refOf(item),
    detail: detailOf(item),
    // Everything the board's row holds, for the search box (lib/mis/text-search.js).
    search: joinParts([
      item.piNo, item.soNumber, item.ciNo, item.indentNo, item.stepCode, item.stepName, item.tab,
      item.buyerName, item.brand, item.owner, item.ownerEmail, item.status, item.delayReason,
    ], ' '),
    piNo: text(item.piNo),
    soNo: text(item.soNumber),
    ciNo: text(item.ciNo),
    stepCode: text(item.stepCode),
    tab: text(item.tab),
    buyer: text(item.buyerName),
  };
}

/**
 * @param {object[]} items  Feed items, served or rehydrated (lib/step-feed/client.js).
 * @param {{ steps: Object<string, { flow: string, code: string, label: string, scoreIn: string[] }>, duties?: object, designers?: object[] }} rules
 *   The resolved rules, whole or as GET /api/rules/resolved trims them.
 * @param {string} profileKey  A key of rules.profiles.
 * @returns {import('../mis/types.js').MisStep[]}  In the feed's order.
 */
export function toMisSteps(items, rules, profileKey) {
  const names = doerNamesOf(items, rules);
  const steps = [];
  for (const item of items ?? []) {
    const rule = ruleOf(rules, item?.stepKey);
    if (!rule || !Array.isArray(rule.scoreIn) || !rule.scoreIn.includes(profileKey)) continue;
    if (item.scope?.inScope !== true) continue;
    const plannedAt = isoOf(item.planned);
    if (!plannedAt) continue;
    const actualAt = isoOf(item.actual);
    steps.push({
      id: text(item.id),
      flow: rule.flow,
      stepKey: item.stepKey,
      code: rule.code,
      label: rule.label,
      plannedAt,
      actualAt,
      delayMin: Number.isFinite(item.delayMin) ? item.delayMin : null,
      doers: doersOf(item, names),
      status: text(item.status),
      excuse: excuseOf(item, actualAt),
      delayReason: text(item.delayReason),
      refs: refsOf(item),
    });
  }
  return steps;
}
