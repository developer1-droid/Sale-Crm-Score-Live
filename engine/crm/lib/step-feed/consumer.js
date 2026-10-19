// VERBATIM COPY of CRM lib/step-feed/consumer.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/step-feed/consumer.js
//
// The step feed as hooks/useMisSteps.js hands it to its consumers — the MIS
// Performance Report, Department Analytics and the Scoreboard.
//
// The hook used to assemble `allSteps` in the browser from four fetches
// (/api/pc-report, /api/tickets, /api/design-approval, /api/so-fms/step-feed)
// and the office calendar. GET /api/step-feed now builds the same list on the
// server (lib/step-feed/build.js; the parity gate is
// lib/__tests__/step-feed-parity.test.js), already deduped and folded per
// invoice and owner (decision 13). What the browser still does is here, pure,
// so a test can run the hook's post-processing over a served payload:
//   - the items in the hook's shape: the Date fields the wire dropped are put
//     back (lib/step-feed/client.js rehydrate) and nothing else changes;
//   - the payload's warnings as one list of { source, message }, and, when a
//     source the feed is built from could not be read, or was read only in
//     part, the error line the reports show: Department Analytics and the
//     Scoreboard read only the hook's `error`, and a feed short of a board's
//     steps must not pass for a whole one there (the hook said so of the SO
//     FMS board before);
//   - the approved-PI set the MIS gates PI-board steps on
//     (lib/reports/misScope.js misCountedSteps), from the PI approval maps the
//     feed was built with, which it carries as `meta`.
//
// Pure: no fetch, no React.

import { normPi } from '../pending-chase.js';
import { rehydrate } from './client.js';
import { STEP_FEED_SOURCE, feedMeta, isLoaderWarning } from './route-logic.js';

const REJECTED = 'rejected';
/** The source written on a warning that names none. */
const FEED_SOURCE = 'feed';

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The hook's `allSteps` from a GET /api/step-feed payload — [] until there is
 * one, so a consumer never builds on a partial list. A design step handed to
 * a reader of their own steps only as its PI's CRM (`asPiCrm`, route-logic
 * scopeItems) is the PC report's to list, not a step these reports count as
 * the reader's, so it is left out.
 *
 * @param {{ items?: object[] }|null} [payload]
 */
export function feedSteps(payload) {
  return payload ? rehydrate((payload.items || []).filter((item) => !item?.asPiCrm)) : [];
}

/**
 * The payload's warnings, each with a source: one line's worth for a page to
 * show beside its numbers. A source the build has no data from at all keeps
 * its `missing` mark (route-logic settledOutcomes).
 *
 * @param {{ warnings?: Array<{ source?: string, message?: string, missing?: boolean }|string> }|null} [payload]
 * @returns {{ source: string, message: string, missing?: true }[]}
 */
export function feedWarnings(payload) {
  return (payload?.warnings || []).map((warning) => {
    if (!warning || typeof warning !== 'object') return { source: FEED_SOURCE, message: String(warning ?? '') };
    const shaped = { source: warning.source || FEED_SOURCE, message: String(warning.message ?? '') };
    return warning.missing === true ? { ...shaped, missing: true } : shaped;
  });
}

/**
 * The sources a build went short of, from its warnings: `missing`, those it
 * has no data from (their steps are not in it), and `partial`, those it read
 * only in part (a tab beside it unreadable, a tab with no rows), with why.
 * Rule, calendar and registry notes are neither.
 *
 * @param {{ source: string, message: string, missing?: boolean }[]} warnings  feedWarnings' list.
 * @returns {{ missing: string[], partial: { source: string, message: string }[] }}
 */
export function sourceGaps(warnings) {
  const fromLoaders = (warnings || []).filter(isLoaderWarning);
  const missing = new Set(fromLoaders.filter((warning) => warning.missing).map((warning) => warning.source));
  const partial = fromLoaders
    .filter((warning) => !missing.has(warning.source))
    .map(({ source, message }) => ({ source, message }));
  return { missing: [...missing], partial };
}

/**
 * What a source the feed could not read costs the reports, in their words.
 * The SO FMS line is the one the hook showed before the feed.
 */
const MISSING_SOURCE_TEXT = Object.freeze({
  [STEP_FEED_SOURCE.SO_FMS]: 'SO FMS steps could not be loaded from the board, so none are counted.',
  [STEP_FEED_SOURCE.CRM_FMS]: 'CRM FMS steps could not be loaded, so none are counted.',
  [STEP_FEED_SOURCE.DESIGN_APPROVAL]: 'Design Approval steps could not be loaded, so none are counted.',
  [STEP_FEED_SOURCE.TICKETS]: 'Tickets could not be loaded, so none are counted.',
  [STEP_FEED_SOURCE.PI_MAPS]: 'The PI approval dates could not be loaded, so no PI-based step is counted.',
  [STEP_FEED_SOURCE.TEAM_DIRECTORY]: 'The team directory could not be loaded, so a step owned by name may be missing from its person.',
});
/** A source read only in part, named as the reports name it. */
const SOURCE_LABEL = Object.freeze({
  [STEP_FEED_SOURCE.SO_FMS]: 'The SO FMS board',
  [STEP_FEED_SOURCE.CRM_FMS]: 'CRM FMS',
  [STEP_FEED_SOURCE.DESIGN_APPROVAL]: 'Design Approval',
  [STEP_FEED_SOURCE.TICKETS]: 'Tickets',
  [STEP_FEED_SOURCE.PI_MAPS]: 'PI Data',
  [STEP_FEED_SOURCE.TEAM_DIRECTORY]: 'The team directory',
});
const RETRY_TEXT = 'Refresh to try again.';

const missingText = (source) => MISSING_SOURCE_TEXT[source] || `The feed could not read ${source}.`;
const partialText = ({ source, message }) => `${SOURCE_LABEL[source] || source} was read only in part (${message}).`;

/**
 * The error a report shows for a feed short of a source: one line naming
 * every source the build could not read, then every one it read only in
 * part, or null when it read them all.
 *
 * @param {{ warnings?: Array<{ source?: string, message?: string, missing?: boolean }|string> }|null} [payload]
 * @returns {string|null}
 */
export function feedError(payload) {
  const { missing, partial } = sourceGaps(feedWarnings(payload));
  if (missing.length === 0 && partial.length === 0) return null;
  return [...missing.map(missingText), ...partial.map(partialText), RETRY_TEXT].join(' ');
}

/**
 * The two PI maps the approved-PI set is built from: the feed payload's `meta`
 * (lib/step-feed/route-logic.js feedMeta), or any object carrying them.
 *
 * @param {{ piApprovalDates?: object, piApprovalStatus?: object }|null} [source]
 * @returns {{ piApprovalDates: Object<string, string>, piApprovalStatus: Object<string, string> }}
 */
export const piMapsOf = feedMeta;

/**
 * The PIs whose steps the MIS counts — the CRM FMS / SO FMS visibility rule:
 * the PI has an approval date, is not rejected, and was approved on or after
 * the line those boards show a PI behind. The caller draws the line from the
 * report rules (lib/work-clock.js boardCutoffLine over lib/rules/scope.js
 * boardCutoffOf): the CRM FMS cutoff, from IST midnight once the rules say so
 * (owner decision 7). Keys are normalised PI numbers (lib/pending-chase.js
 * normPi), as misCountedSteps looks them up.
 *
 * @param {{ piApprovalDates?: object, piApprovalStatus?: object }|null} [piMaps]
 * @param {Date|number|null} [crmFmsLine]  The instant the CRM FMS cutoff day starts; none for no cutoff.
 * @returns {Set<string>}
 */
export function approvedPiSet(piMaps, crmFmsLine) {
  const cutoff = crmFmsLine == null ? null : toDate(crmFmsLine);
  const statuses = piMaps?.piApprovalStatus || {};
  const set = new Set();
  Object.entries(piMaps?.piApprovalDates || {}).forEach(([pi, iso]) => {
    if (String(statuses[pi] || '').trim().toLowerCase().includes(REJECTED)) return;
    const approvedAt = toDate(iso);
    if (!approvedAt) return;
    if (cutoff && approvedAt < cutoff) return;
    set.add(normPi(pi));
  });
  return set;
}
