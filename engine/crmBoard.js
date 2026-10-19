// VERBATIM COPY of CRM score-live/engine/crmBoard.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// The CRM Executive Report (app/(app)/pc-report/department-analytics) for a
// viewer who can see everyone: the "CRM Executive" tab, all people, for each
// period of the page's time filter (see crmPeriods.js). Mirrors page.jsx +
// useDeptReport + usePaymentPending + PeopleTable + SummaryStrip, on the
// CRM's own maths (lib/reports/deptPerformance.js, lib/scoring/crmExecScore.js).
//
// The steps come from the CRM's step feed (GET /api/step-feed): every board's
// steps as the boards show them, already deduplicated and clocked; the TV
// re-derives nothing. They are read the way the page's hook reads them
// (lib/step-feed/consumer.js feedSteps): the Dates the wire dropped put back,
// and a design step handed to its PI's CRM only to list (`asPiCrm`) left out.
//
// The report rules (GET /api/rules/resolved) decide the score, as they do on
// the Scoreboard: today's weighted score, or — once the rules put the CRM
// Executives on the MIS engine — the Scoreboard's own MIS board
// (crmMisBoard.js). Without the rules there is no board: a score is never
// guessed.

import {
  scopeCrmExecutiveSteps, inPeriod, teamWork, summarize, personRows, advancePendingItems,
  balancePendingItems, withoutInvoicedAdvances, paymentsByOwner, PAYMENT_KIND,
} from './crm/lib/reports/deptPerformance.js';
import { buildRoleScorecard, rankRole, FOLLOWUP_COORDINATOR } from './crm/lib/scoring/crmExecScore.js';
import { fmtDelay } from './crm/lib/reports/misFormat.js';
import { clockOf, profileOf } from './crm/lib/crm-mis/report.js';
import { buildMisBoard } from './crm/lib/mis/board.js';
import { periodOfWindow } from './crm/lib/mis/board-period.js';
import { scoresOnMisEngine, usesIstCalendar } from './crm/lib/mis/profile-engine.js';
import { PROFILE } from './crm/lib/rules/profiles-default.js';
import { feedSteps } from './crm/lib/step-feed/consumer.js';
import { createTeamDirectory } from './crm/lib/team-directory.js';
import { CRM_PERIODS, CRM_DEFAULT_PERIOD, isCrmPeriod, crmPeriodLabel, crmPeriodLabelFor, crmRange } from './crmPeriods.js';
import { CRM_ENGINE, misBoardFor } from './crmMisBoard.js';

export const CRM_TITLE = 'CRM Executive';

/** Said when the poll could not read the rules: the board is not drawn on a guess. */
export const RULES_MISSING = 'the report rules could not be read, so no CRM score is shown';

/** reportConfig.fmtMoneyMap: { USD: 1200, EUR: 50 } → "USD 1,200 · EUR 50" ('' when nothing). */
export function fmtMoneyMap(money) {
  const parts = Object.entries(money || {})
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => `${currency} ${Math.round(amount).toLocaleString('en-US')}`);
  return parts.length ? parts.join(' · ') : '';
}

const KINDS = [PAYMENT_KIND.SIGNED_PI, PAYMENT_KIND.ADVANCE, PAYMENT_KIND.BALANCE];

/** SummaryStrip.paymentTotals */
function paymentTotals(entries) {
  const totals = Object.fromEntries(KINDS.map((k) => [k, { count: 0, money: {} }]));
  entries.forEach((entry) => {
    Object.entries(entry.kinds).forEach(([kind, k]) => {
      totals[kind].count += k.count;
      Object.entries(k.money).forEach(([cur, amt]) => { totals[kind].money[cur] = (totals[kind].money[cur] || 0) + amt; });
    });
  });
  return totals;
}

/** usePaymentPending: both feeds merged, an invoiced PI's advance dropped. */
function paymentItems(advanceBody, balanceBody) {
  const advance = advanceBody && advanceBody.success !== false ? advancePendingItems(advanceBody) : [];
  const balance = balanceBody && balanceBody.success !== false ? balancePendingItems(balanceBody.rows) : [];
  return withoutInvoicedAdvances([...advance, ...balance], balanceBody?.invoicedPiNos);
}

const countOrNull = (n) => (n ? n : null);
const pctOrNull = (v) => (v == null ? null : v);
const delayLabel = (min) => (fmtDelay(min) === '—' ? null : fmtDelay(min));
const kindCount = (entry, kind) => countOrNull(entry?.kinds[kind]?.count || 0);

/** The payments not received of the people a board shows: per person, and as the strip's totals. */
function paymentsOf(base, owners) {
  const payMap = new Map([...paymentsByOwner(base.payItems, base.identityOf)].filter(([owner]) => owners.has(owner)));
  const pay = paymentTotals([...payMap.values()]);
  return {
    perPerson: (owner) => {
      const entry = payMap.get(owner);
      return {
        signedPi: kindCount(entry, PAYMENT_KIND.SIGNED_PI),
        advance: kindCount(entry, PAYMENT_KIND.ADVANCE),
        balance: kindCount(entry, PAYMENT_KIND.BALANCE),
      };
    },
    summary: {
      signedPiDue: pay[PAYMENT_KIND.SIGNED_PI].count,
      advanceDue: pay[PAYMENT_KIND.ADVANCE].count,
      advanceDueAmountLabel: fmtMoneyMap(pay[PAYMENT_KIND.ADVANCE].money) || null,
      balanceDue: pay[PAYMENT_KIND.BALANCE].count,
      balanceDueAmountLabel: fmtMoneyMap(pay[PAYMENT_KIND.BALANCE].money) || null,
    },
  };
}

/** PeopleTable default sort: score desc (unscored last), then name. */
function byScore(a, b) {
  return ((b.scored?.score ?? -1) - (a.scored?.score ?? -1)) || a.label.localeCompare(b.label);
}

/**
 * Everything that does not depend on the period: built once per poll.
 * @param {object} raw  { feed, team, cutoffs, rules, advancePending, balancePending }:
 *   GET /api/step-feed, /api/teamSheets, systemSettings/globalCutoffDates,
 *   GET /api/rules/resolved and the two payment-pending reports. A step is cut
 *   by its cutoff as the rules draw it (lib/reports/deptPerformance.js isBeforeCutoff).
 */
function prepare(raw, now) {
  if (!raw.rules) throw new Error(RULES_MISSING);
  const { designationOf, identityOf, nameOf } = createTeamDirectory(raw.team);
  const profile = profileOf(raw.rules, PROFILE.CRM_EXEC);
  const base = { now, identityOf, payItems: paymentItems(raw.advancePending, raw.balancePending) };
  if (scoresOnMisEngine(profile)) {
    const items = feedSteps(raw.feed);
    return { ...base, mis: { items, rules: raw.rules, profile, clock: clockOf(raw.feed?.builtAt, now), roleOf: designationOf, nameOf } };
  }
  const deps = { designationOf, identityOf, nameOf, rules: raw.rules, followUpOwner: FOLLOWUP_COORDINATOR.email };
  const items = feedSteps(raw.feed);
  // The findings under the board are the MIS engine's whatever the score: one way to say where work misses and why.
  const insightsBase = { items, rules: raw.rules, clock: clockOf(raw.feed?.builtAt, now), roleOf: designationOf, nameOf };
  return { ...base, scoped: scopeCrmExecutiveSteps(items, deps), insightsBase };
}

/** The steps that miss most and the delay reasons written most for a window (lib/mis/insights.js). */
function insightsFor(base, range) {
  const { items, rules, clock, roleOf, nameOf } = base.insightsBase;
  return buildMisBoard({
    items, rules, profileKey: PROFILE.CRM_EXEC, period: periodOfWindow(range), now: clock, seesEveryone: true, roleOf, nameOf,
  }).insights;
}

function weightedBoardFor(base, key) {
  const range = crmRange(key, base.now);
  const cohort = inPeriod(base.scoped, range);

  const ranking = rankRole(buildRoleScorecard(cohort));
  const scored = new Map();
  ranking.ranked.forEach((r, i) => scored.set(r.owner, { ...r, rank: i + 1 }));
  ranking.benched.forEach((r) => scored.set(r.owner, { ...r, rank: null }));

  const rows = personRows(cohort).map((row) => ({ ...row, scored: scored.get(row.owner) || null })).sort(byScore);
  const s = summarize(teamWork(cohort));
  const pay = paymentsOf(base, new Set(rows.map((r) => r.owner)));

  return {
    title: CRM_TITLE,
    period: { key, label: crmPeriodLabel(key), start: range.start.toISOString(), end: range.end.toISOString() },
    summary: {
      onTimePct: pctOrNull(s.onTimePct),
      onTimeDone: s.onTime,
      doneTotal: s.done,
      steps: s.total,
      lateDone: s.lateDone,
      overdue: s.overdue,
      pending: s.pending,
      openInTime: s.open,
      onHold: s.held,
      avgDelayLabel: s.lateDone + s.overdue ? delayLabel(s.avgDelayMin) : null,
      ...pay.summary,
    },
    people: rows.map((r) => ({
      id: r.owner,
      rank: r.scored?.rank ?? null,
      name: r.label,
      score: r.scored?.score ?? null,
      steps: r.total,
      onTimePct: pctOrNull(r.onTimePct),
      late: countOrNull(r.lateDone),
      overdue: countOrNull(r.overdue),
      pending: countOrNull(r.pending),
      avgDelayLabel: r.lateDone + r.overdue ? delayLabel(r.avgDelayMin) : null,
      ...pay.perPerson(r.owner),
    })),
    insights: insightsFor(base, range),
  };
}

function boardFor(base, key) {
  if (!base.mis) return weightedBoardFor(base, key);
  return misBoardFor(base, key, {
    title: CRM_TITLE,
    payments: (owners) => paymentsOf(base, owners),
  });
}

/** The period list with each key's label for the engine in use. */
const periodsOf = (base) => CRM_PERIODS.map((p) => ({ ...p, label: crmPeriodLabelFor(p.key, Boolean(base.mis) && usesIstCalendar(base.mis.profile)) }));

/** One period's board → payload.crm (contract v2 shape). */
export function computeCrmBoard(raw, { now = new Date(), period = CRM_DEFAULT_PERIOD } = {}) {
  return boardFor(prepare(raw, now), isCrmPeriod(period) ? period : CRM_DEFAULT_PERIOD);
}

/**
 * Every period from the same raw data. A period that throws is left out and
 * reported in `failed` so the caller can keep its last good board.
 * @returns {{ periods: {key,label}[], engine: string, byPeriod: Record<string, object>, failed: {key, error}[] }}
 */
export function computeCrmBoards(raw, { now = new Date() } = {}) {
  const base = prepare(raw, now);
  const byPeriod = {};
  const failed = [];
  CRM_PERIODS.forEach(({ key }) => {
    try {
      byPeriod[key] = boardFor(base, key);
    } catch (err) {
      failed.push({ key, error: err?.message || String(err) });
    }
  });
  return { periods: periodsOf(base), engine: base.mis ? CRM_ENGINE.MIS : CRM_ENGINE.WEIGHTED, byPeriod, failed };
}
