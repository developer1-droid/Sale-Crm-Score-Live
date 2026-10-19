// VERBATIM COPY of CRM lib/step-feed/route-logic.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/step-feed/route-logic.js
//
// The decisions GET /api/step-feed makes that need no server: who sees how
// much of the feed, what one build is identified by, when a held build still
// serves, how a source that could not be read is written into the warnings,
// and what goes over the wire.
//
// Pure, so it runs under Jest; app/api/step-feed/route.js plugs in the
// session, the permission check, the loaders and the builder.

import { PERMISSIONS } from '../roles.js';

/** Where an item or a warning comes from. */
export const STEP_FEED_SOURCE = Object.freeze({
  CRM_FMS: 'crmFms',
  SO_FMS: 'soFms',
  PI_MAPS: 'piMaps',
  DESIGN_APPROVAL: 'designApproval',
  TICKETS: 'tickets',
  TEAM_DIRECTORY: 'teamDirectory',
  PI_TRANSFERS: 'piTransfers',
  RULES: 'rules',
  CALENDAR: 'calendar',
  BUILD: 'build',
});

/** The loaders; a warning from one of them means the feed is missing a source. */
const LOADER_SOURCES = new Set([
  STEP_FEED_SOURCE.CRM_FMS,
  STEP_FEED_SOURCE.SO_FMS,
  STEP_FEED_SOURCE.PI_MAPS,
  STEP_FEED_SOURCE.DESIGN_APPROVAL,
  STEP_FEED_SOURCE.TICKETS,
  STEP_FEED_SOURCE.TEAM_DIRECTORY,
  STEP_FEED_SOURCE.PI_TRANSFERS,
]);

export const STEP_FEED_SCOPE = Object.freeze({ ALL: 'all', OWN: 'own' });

/**
 * Grants under which a report page already shows everyone's steps: a
 * report's own view-all, and the Scoreboard's view — the Scoreboard ranks
 * every person for whoever holds it (app/(app)/scoreboard/page.jsx checks
 * scoreboard.view alone and scores allSteps for everyone), so that grant has
 * no own scope to fall back to. A super admin holds every one.
 */
export const STEP_FEED_VIEW_ALL_SLUGS = Object.freeze([
  PERMISSIONS.VIEW_ALL_PC_REPORT,
  PERMISSIONS.VIEW_ALL_MIS_REPORT,
  PERMISSIONS.VIEW_ALL_DEPT_ANALYTICS,
  PERMISSIONS.VIEW_SCOREBOARD,
]);

/**
 * Grants that open a report at all. Without a view-all beside them the page
 * shows the reader their own steps (app/(app)/pc-report/mis/page.jsx,
 * the retired Department Analytics page), and so does the feed.
 * The three own-scope grants are read grants too, as VIEW_OWN_DEPT_ANALYTICS
 * is on the advance-pending feed (lib/reports/piAdvancePending.js
 * FEED_READ_SLUGS): lib/roles.js declares them, no page checks them (own
 * scope is what a page shows whenever the view-all is absent), and a reader
 * holding one alone is handed their own steps rather than refused.
 */
export const STEP_FEED_READ_SLUGS = Object.freeze([
  PERMISSIONS.VIEW_PC_REPORT,
  PERMISSIONS.VIEW_OWN_PC_REPORT,
  PERMISSIONS.VIEW_MIS_REPORT,
  PERMISSIONS.VIEW_OWN_MIS_REPORT,
  PERMISSIONS.VIEW_DEPT_ANALYTICS,
  PERMISSIONS.VIEW_OWN_DEPT_ANALYTICS,
]);

/**
 * The order to ask about the grants in, for a caller that checks one at a
 * time and stops at the first it finds: a view-all settles the scope on its
 * own, so those come first.
 */
export const STEP_FEED_CHECK_ORDER = Object.freeze([...STEP_FEED_VIEW_ALL_SLUGS, ...STEP_FEED_READ_SLUGS]);

const VIEW_ALL = new Set(STEP_FEED_VIEW_ALL_SLUGS);
const READ = new Set(STEP_FEED_READ_SLUGS);

/** What one grant opens: everything, the reader's own steps, or nothing. */
export function scopeOfSlug(slug) {
  if (VIEW_ALL.has(slug)) return STEP_FEED_SCOPE.ALL;
  if (READ.has(slug)) return STEP_FEED_SCOPE.OWN;
  return null;
}

/**
 * How much of the feed a reader gets from the grants they hold.
 *
 * @param {Iterable<string>} granted
 * @returns {'all'|'own'|null} null: no report of theirs reads the feed.
 */
export function stepFeedScope(granted) {
  const held = new Set(granted);
  if (STEP_FEED_VIEW_ALL_SLUGS.some((slug) => held.has(slug))) return STEP_FEED_SCOPE.ALL;
  if (STEP_FEED_READ_SLUGS.some((slug) => held.has(slug))) return STEP_FEED_SCOPE.OWN;
  return null;
}

/** An email the way the feed keys owners: trimmed, lower-case, '' for none. */
export const canonicalEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * The items a reader sees. Own scope keeps the items whose owner is the
 * reader; and, marked `asPiCrm`, the ones the reader is chased for as the PI's
 * current CRM without being their owner — a Design Approval review or buyer
 * step whose PI's CRM is the reader (piCrmEmail), or an open step of a PI
 * transferred to the reader that stays its earlier CRM's score
 * (chaseOwnerEmail, decision 12; lib/step-feed/build.js). The PC report lists
 * those as the reader's, while the MIS, Department Analytics and the
 * Scoreboard count them as their owner's and leave them out
 * (lib/step-feed/consumer.js feedSteps). An item with no known owner is
 * nobody's.
 */
export function scopeItems(items, scope, email) {
  const list = Array.isArray(items) ? items : [];
  if (scope === STEP_FEED_SCOPE.ALL) return list;
  const me = canonicalEmail(email);
  if (scope !== STEP_FEED_SCOPE.OWN || !me) return [];
  return list.flatMap((item) => {
    if (canonicalEmail(item?.ownerEmail) === me) return [item];
    const isChasedToMe = canonicalEmail(item?.chaseOwnerEmail) === me || canonicalEmail(item?.piCrmEmail) === me;
    return isChasedToMe ? [{ ...item, asPiCrm: true }] : [];
  });
}

/* ── one build, identified ───────────────────────────────────────────────── */

export const STEP_FEED_CACHE_TTL_MS = 60 * 1000;

/**
 * What a build was made from: the SO FMS board's build time (the board is the
 * one source that rebuilds on its own clock), the rules version and the
 * office calendar's version. A build made from the same three is the same
 * build for a minute.
 */
export function feedFingerprint({ soBuiltAt, rulesVersion, calendarVersion }) {
  return `${soBuiltAt ?? ''}|${rulesVersion ?? ''}|${calendarVersion ?? ''}`;
}

/**
 * The last build, served again while it is under `ttlMs` old and was made
 * from the same fingerprint. One entry: every reader is scoped from the same
 * build, which is read as the system, so there is nothing per reader to keep.
 */
export function createFeedCache({ ttlMs = STEP_FEED_CACHE_TTL_MS, now = Date.now } = {}) {
  let entry = null;
  return {
    read(fingerprint) {
      if (!entry || entry.fingerprint !== fingerprint) return null;
      if (now() - entry.at >= ttlMs) return null;
      return entry.build;
    },
    write(fingerprint, build) {
      entry = { fingerprint, at: now(), build };
    },
    clear() {
      entry = null;
    },
  };
}

/* ── sources and their warnings ──────────────────────────────────────────── */

const messageOf = (error) => (error instanceof Error ? error.message : String(error ?? 'unknown error'));

/**
 * A source read that never rejects. `read` answers `{ data, warning }`; a
 * throw becomes `{ data: null, warning }`, reported, so the feed loses that
 * source and says so instead of failing.
 *
 * @param {string} source  A STEP_FEED_SOURCE.
 * @param {() => Promise<{ data: any, warning?: string|null }>} read
 * @param {{ report?: (...args: any[]) => void }} [options]
 */
export async function guardedSource(source, read, { report = console.error } = {}) {
  try {
    const result = await read();
    return { data: result?.data ?? null, warning: result?.warning || null };
  } catch (error) {
    report(`step feed: the ${source} source could not be read:`, error);
    return { data: null, warning: messageOf(error) };
  }
}

/**
 * The loaders' settled results as one data record and the warnings they owe.
 *
 * @param {Array<[string, PromiseSettledResult<{ data: any, warning?: string|null }>]>} pairs
 *   Each loader's STEP_FEED_SOURCE and its Promise.allSettled result.
 * @returns {{ data: Object<string, any>, warnings: Array<{ source: string, message: string }> }}
 */
export function settledOutcomes(pairs) {
  const data = {};
  const warnings = [];
  for (const [source, outcome] of pairs) {
    if (outcome?.status === 'fulfilled') {
      data[source] = outcome.value?.data ?? null;
      if (outcome.value?.warning) warnings.push(sourceWarning(source, outcome.value.warning, data[source] === null));
      continue;
    }
    data[source] = null;
    warnings.push(sourceWarning(source, messageOf(outcome?.reason), true));
  }
  return { data, warnings };
}

/**
 * A loader's warning. `missing` marks a source the feed has no data from at
 * all — its steps or facts are not in the build — as against one read only
 * in part (a tab beside it unreadable, a tab with no rows), whose data the
 * build still used.
 */
function sourceWarning(source, message, missing) {
  return missing ? { source, message, missing: true } : { source, message };
}

/** The rules loader's notes, as feed warnings. */
export const ruleWarnings = (notes) => (notes || []).map((message) => ({ source: STEP_FEED_SOURCE.RULES, message }));

export const NO_HOLIDAYS_MESSAGE = 'no office holidays are loaded (hr-erp unreachable, or HRERP_BASE_URL / REPORT_EMBED_SECRET unset): '
  + 'the Design Approval clock skipped Sundays only';

/**
 * The office calendar's warning for a build. An empty holiday list means
 * hr-erp could not be read or is not configured — lib/work-calendar-source.js
 * keeps the last good list, and none has ever come — so the design clocks
 * measured without holidays. The feed says so; it never serves a silently
 * empty list.
 *
 * @param {number} holidayCount  getHolidays().length after ensureWorkCalendar.
 */
export const calendarWarnings = (holidayCount) =>
  (holidayCount > 0 ? [] : [{ source: STEP_FEED_SOURCE.CALENDAR, message: NO_HOLIDAYS_MESSAGE }]);

/** The builder's notes — text, or already `{ source, message }` — as feed warnings. */
export function buildWarnings(notes) {
  return (notes || []).map((note) => {
    if (note && typeof note === 'object' && note.message) {
      // A board the builder could not build keeps its `missing` mark.
      return sourceWarning(note.source || STEP_FEED_SOURCE.BUILD, String(note.message), note.missing === true);
    }
    return { source: STEP_FEED_SOURCE.BUILD, message: String(note) };
  });
}

/**
 * A build missing a source is not held: the next reader retries the source.
 * A calendar warning does not stop a hold — the fingerprint carries the
 * calendar version, so the build is remade the moment the holidays land.
 */
export const isCacheable = (warnings) => !(warnings || []).some(isLoaderWarning);

/** A warning from one of the loaders: the feed is missing that source's steps or facts. */
export function isLoaderWarning(warning) {
  return LOADER_SOURCES.has(warning?.source);
}

/* ── over the wire ───────────────────────────────────────────────────────── */

/**
 * Items as they go over HTTP: the Date fields are dropped and the ISO text
 * (`planned`, `actual`) stays; lib/step-feed/client.js puts the Dates back.
 * JSON alone would send the Dates as a second copy of the same text.
 */
export function serialisableItems(items) {
  return (items || []).map((item) => {
    const copy = { ...item };
    delete copy.planDate;
    delete copy.actDate;
    return copy;
  });
}

/**
 * The PI facts the feed was built with that a report still reads on its own:
 * the MIS gates every PI-board step on its PI's approval (lib/reports/misScope.js
 * misCountedSteps, through lib/step-feed/consumer.js approvedPiSet). The two
 * maps only, as /api/pc-report sends them — every signed-in reader could read
 * them there.
 *
 * @param {{ piApprovalDates?: object, piApprovalStatus?: object }|null} [piMaps]
 * @returns {{ piApprovalDates: Object<string, string>, piApprovalStatus: Object<string, string> }}
 */
export function feedMeta(piMaps) {
  return {
    piApprovalDates: piMaps?.piApprovalDates || {},
    piApprovalStatus: piMaps?.piApprovalStatus || {},
  };
}

/**
 * The response body of GET /api/step-feed. `scope` says how much of the feed
 * the reader was given (STEP_FEED_SCOPE), so a caller that needs everyone's
 * steps — Score Live's whole-team boards — can tell a reader's own steps from
 * the whole feed instead of reading everyone else as having none.
 */
export function feedPayload({ builtAt, rulesVersion, calendarVersion, warnings, items, meta, scope }) {
  return {
    success: true,
    builtAt,
    rulesVersion,
    calendarVersion,
    ...(scope ? { scope } : {}),
    warnings: warnings || [],
    meta: meta || feedMeta(null),
    items: items || [],
  };
}
