// Pulls every CRM source the two boards need, keeps the last good copy of each
// (one failing endpoint should not blank the TV), runs the engine for every
// period and hands the payload (contract v3) to `onScores`. The CRM board's
// periods are the CRM MIS page's (engine/crmMis.js); a closed week or month is
// read from the CRM's frozen record (GET /api/mis/periods), once, as the page
// reads it; the custom dates come from the settings (`getCustom`), and
// `recompute()` redraws the boards from the last reads when they change.
//
// Runs in two hosts with one client contract — `getJson(path, options)` and
// `getCutoffDates(options)`: Score Live's own server (lib/crmClient.js, logged
// in as the TV's account) and the CRM itself (lib/viewerClient.js, read as the
// admin looking at the page). `refresh(options)` hands its options to every
// client call of that poll, which is how the CRM host says whose session to
// read with.

import { STEP_FEED_SCOPE, isCacheable } from '../engine/crm/lib/step-feed/route-logic.js';
import {
  computeCrmMisBoards, frozenPeriodsWanted, salesRange, previousMonthRange, salesQuery, shapeSales, SALES_PERIODS,
} from '../engine/index.js';

/* What the CRM Executive Report page loads: the step feed (every board's steps,
   as the boards show them), the team directory, the payments-pending reports,
   and the report rules that decide how the board is scored (as the Scoreboard
   reads them). */
const CRM_SOURCES = {
  feed: '/api/step-feed',
  team: '/api/teamSheets',
  rules: '/api/rules/resolved',
  advancePending: '/api/reports/pi-advance-pending?data=1',
  balancePending: '/api/reports/arrived-payment-pending',
};
/* Without these the board would be wrong (no cutoffs = no carry-forward filter,
   no feed = no steps, no team = nobody is a CRM Executive, no rules = no way to
   know the score); keep the last good board instead, and the status says why. */
const CRM_REQUIRED = ['feed', 'team', 'cutoffs', 'rules'];
/* The step-feed route rebuilds the SO FMS board on a cold cache (maxDuration 120s). */
const CRM_TIMEOUTS_MS = { feed: 130_000 };
const PREVIOUS = 'previous';
/* Last month is closed; re-read it only this often (or when the month rolls over). */
const PREVIOUS_REFRESH_MS = 15 * 60 * 1000;

const salesPath = (range) => `/api/sales-coordinator-report?${salesQuery(range)}`;
/* A closed period's frozen CRM Executive board; its first read after the period closes builds it (maxDuration 120s). */
const frozenPath = (period) => `/api/mis/periods?from=${period.from}&to=${period.to}&profile=crmExec`;
const FROZEN_TIMEOUT_MS = 130_000;
const errorText = (err) => err?.message || String(err);
/* A last-good copy fetched for another window (yesterday's "today", last month's
   "month") must not show under this window's label. */
const isForPeriod = (json, range) => !json?.meta?.periodKey || json.meta.periodKey === range.periodKey;

/* What the reader must hold for the whole feed (app/api/step-feed/route.js readerScope). */
const OWN_SCOPE_ERROR = "step feed holds only the reader's own steps: the account needs Super Admin, "
  + 'a report view-all (pc_report / mis_report / dept_analytics) or scoreboard.view';

/**
 * The feed as fetched, or a throw. A feed the CRM built without one of its
 * boards (a source warning, the same test the route uses to refuse to cache
 * it) would read as people with no steps, and so would a feed scoped to the
 * reader's own steps — a reader holding a report's view and no view-all — so
 * both are refused and the last good board stands.
 */
export function acceptedFeed(feed) {
  if (!feed?.success || !Array.isArray(feed.items)) throw new Error('step feed unavailable');
  if (feed.scope === STEP_FEED_SCOPE.OWN) throw new Error(OWN_SCOPE_ERROR);
  if (!isCacheable(feed.warnings)) {
    throw new Error(`step feed is missing a board: ${feed.warnings.map((w) => `${w.source}: ${w.message}`).join('; ')}`);
  }
  return feed;
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * The report rules as fetched (GET /api/rules/resolved), or a throw: an answer
 * with no profiles or steps could not say how anyone is scored, so the last
 * good board stands and the status says why.
 */
export function acceptedRules(rules) {
  if (!rules?.success || !isRecord(rules.profiles) || !isRecord(rules.steps)) throw new Error('report rules unavailable');
  return rules;
}

const ACCEPT = Object.freeze({ feed: acceptedFeed, rules: acceptedRules });

/** The ranges fetched this poll: one per sales period plus the previous month. */
function salesRanges(now) {
  const ranges = Object.fromEntries(SALES_PERIODS.map(({ key }) => [key, salesRange(key, now)]));
  ranges[PREVIOUS] = previousMonthRange(now);
  return ranges;
}

export function createPoller({ client, pollSeconds, onScores, getCustom = () => null }) {
  const lastGood = {};
  const lastSales = {};
  /* 'from_to' → the CRM's frozen record of a closed period: written once, never changed, so read once. */
  const frozen = {};
  let latest = null;
  let lastRaw = null;
  let timer = null;
  let inFlight = null;
  let previousFetchedAt = 0;

  const customRange = () => {
    const custom = getCustom();
    return custom && custom.from && custom.to ? custom : null;
  };

  /** The frozen records the periods on screen need and this poller has not read yet. */
  async function loadFrozen(rules, now, errors, options) {
    if (!rules) return;
    for (const { key, period } of frozenPeriodsWanted(rules, now, customRange())) {
      if (frozen[key]) continue;
      try {
        const json = await client.getJson(frozenPath(period), { ...options, timeoutMs: FROZEN_TIMEOUT_MS });
        const record = json?.records?.crmExec;
        if (!json?.success || !record?.board) throw new Error('the CRM sent no frozen record');
        frozen[key] = record;
      } catch (err) {
        // The board is then scored live, and says so (period.frozenMissing).
        errors.push(`frozen ${key}: ${errorText(err)}`);
      }
    }
  }

  async function load(name, task, sources, errors) {
    try {
      lastGood[name] = await task();
      sources[name] = 'ok';
    } catch (err) {
      sources[name] = lastGood[name] !== undefined ? 'stale' : 'error';
      errors.push(`${name}: ${errorText(err)}`);
    }
    return lastGood[name] ?? null;
  }

  function buildCrm(raw, now, errors) {
    const previous = latest?.crm ?? null;
    if (CRM_REQUIRED.some((name) => !raw[name])) return previous;
    try {
      const { periods, engine, byPeriod, failed } = computeCrmMisBoards({ ...raw, frozen }, { now, custom: customRange() });
      failed.forEach(({ key, error }) => {
        errors.push(`crm engine (${key}): ${error}`);
        if (previous?.byPeriod[key]) byPeriod[key] = previous.byPeriod[key];
      });
      return { periods, engine, byPeriod };
    } catch (err) {
      errors.push(`crm engine: ${errorText(err)}`);
      return previous;
    }
  }

  /** One period: shaped from this poll's fresh JSON, else the last good board for the same window, else absent. */
  function salesFor(key, json, range, errors) {
    const kept = lastSales[key]?.period.key === range.periodKey ? lastSales[key] : null;
    if (!json || !isForPeriod(json, range)) return kept;
    try {
      lastSales[key] = shapeSales(json, range) ?? kept;
      return lastSales[key];
    } catch (err) {
      errors.push(`sales engine (${key}): ${errorText(err)}`);
      return kept;
    }
  }

  function buildSales(salesJson, ranges, errors) {
    const byPeriod = {};
    SALES_PERIODS.forEach(({ key }) => {
      const board = salesFor(key, salesJson[key], ranges[key], errors);
      if (board) byPeriod[key] = board;
    });
    const previous = salesFor(PREVIOUS, salesJson[PREVIOUS], ranges[PREVIOUS], errors);
    if (!Object.keys(byPeriod).length && !previous) return null;
    return { periods: SALES_PERIODS.map((p) => ({ ...p })), byPeriod, previous };
  }

  const isPreviousFresh = (range, now) =>
    lastSales[PREVIOUS]?.period.key === range.periodKey && now - previousFetchedAt < PREVIOUS_REFRESH_MS;

  /** One sales call at a time (each reads several full sheets); last month comes from cache while fresh. */
  async function loadSales(ranges, now, sources, errors, options) {
    const pairs = [];
    for (const [key, range] of Object.entries(ranges)) {
      const name = `sales.${key}`;
      if (key === PREVIOUS && isPreviousFresh(range, now)) {
        sources[name] = 'ok';
        pairs.push([key, null]);
        continue;
      }
      const value = await load(name, () => client.getJson(salesPath(range), options), sources, errors);
      if (key === PREVIOUS && sources[name] === 'ok') previousFetchedAt = now.getTime();
      pairs.push([key, sources[name] === 'ok' ? value : null]);
    }
    return pairs;
  }

  const readSource = (name, options) => {
    const json = client.getJson(CRM_SOURCES[name], { ...options, timeoutMs: CRM_TIMEOUTS_MS[name] });
    return ACCEPT[name] ? json.then(ACCEPT[name]) : json;
  };

  async function run(options) {
    const errors = [];
    const sources = {};
    const now = new Date();
    const ranges = salesRanges(now);
    const crmLoads = Object.keys(CRM_SOURCES).map((name) =>
      load(name, () => readSource(name, options), sources, errors).then((value) => [name, value]));
    // A failed fetch yields null (not the last raw JSON) so salesFor keeps the board
    // as it was shaped then, instead of relabelling old numbers with this poll's window.
    const [crmPairs, cutoffs, salesPairs] = await Promise.all([
      Promise.all(crmLoads),
      load('cutoffs', () => client.getCutoffDates(options), sources, errors),
      loadSales(ranges, now, sources, errors, options),
    ]);

    const raw = Object.fromEntries(crmPairs);
    raw.cutoffs = cutoffs;
    await loadFrozen(raw.rules, now, errors, options);
    lastRaw = raw;

    latest = {
      updatedAt: now.toISOString(),
      pollSeconds,
      status: { ok: errors.length === 0, errors, sources },
      crm: buildCrm(raw, now, errors),
      sales: buildSales(Object.fromEntries(salesPairs), ranges, errors),
    };
    latest.status.ok = errors.length === 0;
    onScores(latest);
    if (errors.length) console.error(`[score-live] ${now.toISOString()} ${errors.join(' | ')}`);
  }

  /** One poll; a caller that arrives while one is running waits for that one. */
  function tick(options) {
    if (!inFlight) inFlight = run(options).finally(() => { inFlight = null; });
    return inFlight;
  }

  const safeTick = () => tick().catch((err) => console.error(`[score-live] poll failed: ${errorText(err)}`));

  /** The CRM boards again from the last reads (the custom dates changed): no wait for the next poll. */
  async function recompute(options) {
    if (inFlight) await inFlight.catch(() => {});
    if (!lastRaw || !latest) return;
    const errors = [];
    const now = new Date();
    await loadFrozen(lastRaw.rules, now, errors, options);
    latest = { ...latest, crm: buildCrm(lastRaw, now, errors) };
    if (errors.length) console.error(`[score-live] ${now.toISOString()} ${errors.join(' | ')}`);
    onScores(latest);
  }

  return {
    start() {
      safeTick();
      timer = setInterval(safeTick, pollSeconds * 1000);
    },
    stop() {
      clearInterval(timer);
    },
    refresh: tick,
    recompute: () => recompute().catch((err) => console.error(`[score-live] recompute failed: ${errorText(err)}`)),
    latest: () => latest,
  };
}
