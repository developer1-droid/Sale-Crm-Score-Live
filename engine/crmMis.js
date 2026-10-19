// The CRM Executive board as the CRM MIS page shows it (app/(app)/reports/crm-mis): the page's
// periods — This week, Last week, This month, Last month, or two dates (lib/mis/period.js) — scored
// by the CRM's MIS engine (lib/mis/board.js buildMisBoard, the Scoreboard's own board), a closed
// week or month read from the CRM's frozen record (owner decision #4, as the page reads it through
// GET /api/mis/periods), the page's average delay over the period's delayed work, and for each
// person what the TV's walkthrough says about them: the step they miss most and the delay reason
// they write most (as the page's table shows them). Payments not received are the CRM Executive
// Report's, as on the CRM's own Score Live board (crmBoard.js).

import {
  PAYMENT_KIND, advancePendingItems, balancePendingItems, paymentsByOwner, withoutInvoicedAdvances,
} from './crm/lib/reports/deptPerformance.js';
import { buildCrmMisReport, clockOf, profileOf } from './crm/lib/crm-mis/report.js';
import { buildMisBoard } from './crm/lib/mis/board.js';
import { customPeriod } from './crm/lib/mis/board-period.js';
import { topReasonByDoer } from './crm/lib/mis/delay-reasons.js';
import { MIS_TONE, fmtPct, fmtWorkingMinutes, scoreTone } from './crm/lib/mis/format.js';
import { frozenPeriodKey, readsFrozen } from './crm/lib/mis/frozen.js';
import { MIS_PRESET, periodBounds, periodLabel, presetPeriod } from './crm/lib/mis/period.js';
import { doerKeyOf } from './crm/lib/mis/score.js';
import { averageDelayHours, stepDelayRows } from './crm/lib/mis/step-delay.js';
import { PROFILE } from './crm/lib/rules/profiles-default.js';
import { feedSteps } from './crm/lib/step-feed/consumer.js';
import { createTeamDirectory } from './crm/lib/team-directory.js';
import { CRM_TITLE, RULES_MISSING, fmtMoneyMap } from './crmBoard.js';

export const CRM_ENGINE_MIS = 'mis';
export const CUSTOM = 'custom';

/* The CRM MIS page's period picker, plus its From–To dates (set on the settings page). */
export const CRM_PERIODS = [
  { key: MIS_PRESET.THIS_WEEK, label: 'This week' },
  { key: MIS_PRESET.LAST_WEEK, label: 'Last week' },
  { key: MIS_PRESET.THIS_MONTH, label: 'This month' },
  { key: MIS_PRESET.LAST_MONTH, label: 'Last month' },
  { key: CUSTOM, label: 'Custom' },
];
export const CRM_PERIOD_KEYS = CRM_PERIODS.map((p) => p.key);
export const CRM_DEFAULT_PERIOD = MIS_PRESET.THIS_WEEK;
export const isCrmPeriod = (key) => CRM_PERIOD_KEYS.includes(key);

/* The TV's earlier filter (rolling windows) read as the nearest MIS period, so saved settings keep working. */
const LEGACY_PERIOD = Object.freeze({
  today: MIS_PRESET.THIS_WEEK,
  weekly: MIS_PRESET.THIS_WEEK,
  monthly: MIS_PRESET.THIS_MONTH,
  quarterly: MIS_PRESET.THIS_MONTH,
  halfyearly: MIS_PRESET.THIS_MONTH,
  yearly: MIS_PRESET.THIS_MONTH,
});
export const crmPeriodOrDefault = (key) => (isCrmPeriod(key) ? key : LEGACY_PERIOD[key] || CRM_DEFAULT_PERIOD);

/** The MIS period a key names: a preset as of `now`, or the custom dates (null while none are set). */
export function crmMisPeriod(key, now, custom) {
  if (key === CUSTOM) return custom ? customPeriod(custom.from, custom.to) : null;
  return presetPeriod(key, now) || null;
}

/** The closed weeks and months this poll reads from the CRM's frozen record: [{ key: 'from_to', period }]. */
export function frozenPeriodsWanted(rules, now, custom) {
  const profile = profileOf(rules, PROFILE.CRM_EXEC);
  const wanted = new Map();
  CRM_PERIOD_KEYS.forEach((key) => {
    const period = crmMisPeriod(key, now, custom);
    if (period && readsFrozen(profile, period, now)) wanted.set(frozenPeriodKey(period), period);
  });
  return [...wanted].map(([key, period]) => ({ key, period }));
}

/* ---------- payments not received (crmBoard.js: usePaymentPending + SummaryStrip) ---------- */
const KINDS = [PAYMENT_KIND.SIGNED_PI, PAYMENT_KIND.ADVANCE, PAYMENT_KIND.BALANCE];
const countOrNull = (n) => (n ? n : null);

function paymentItems(advanceBody, balanceBody) {
  const advance = advanceBody && advanceBody.success !== false ? advancePendingItems(advanceBody) : [];
  const balance = balanceBody && balanceBody.success !== false ? balancePendingItems(balanceBody.rows) : [];
  return withoutInvoicedAdvances([...advance, ...balance], balanceBody?.invoicedPiNos);
}

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

function paymentsOf(base, owners) {
  const payMap = new Map([...paymentsByOwner(base.payItems, base.identityOf)].filter(([owner]) => owners.has(owner)));
  const pay = paymentTotals([...payMap.values()]);
  const kindCount = (entry, kind) => countOrNull(entry?.kinds[kind]?.count || 0);
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

/* ---------- the board, as crmMisBoard.js shapes it, plus the page's details ---------- */
/* The engine's score tones (lib/mis/format.js) as the TV's bands. */
const TV_TONE = Object.freeze({ [MIS_TONE.GOOD]: 'good', [MIS_TONE.WARN]: 'warn', [MIS_TONE.BAD]: 'bad', [MIS_TONE.NONE]: null });
const PERCENT = 100;
const pctOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * PERCENT) : null);
const delayLabel = (min) => (fmtWorkingMinutes(min) === '—' ? null : fmtWorkingMinutes(min));
/* The page's KPI card: "73.7h" working hours. */
const hoursLabel = (hours) => (hours === null || hours === undefined ? null : `${hours}h`);

/** The step a person misses most this period (the page's "Where work misses", for one person). */
function worstStepOf(steps) {
  const top = stepDelayRows(steps || []).find((row) => row.missed > 0);
  return top ? { code: top.code, label: top.label, missed: top.missed, planned: top.planned, avgDelayHours: top.avgDelayHours } : null;
}

function personOf(row, payments, details) {
  return {
    id: row.key,
    rank: row.rank,
    name: row.name,
    score: row.score,
    scoreText: row.scoreText,
    scoreTone: TV_TONE[scoreTone(row.score)],
    grade: row.grade,
    reward: row.isRewarded,
    steps: row.planned,
    onTime: row.onTime,
    onTimePct: pctOf(row.onTime, row.planned),
    late: countOrNull(row.late),
    overdue: countOrNull(row.notDone),
    pending: countOrNull(row.backlog),
    avgDelayLabel: delayLabel(row.avgDelayMin),
    ...details(row.key),
    ...payments(row.key),
  };
}

function summaryOf(board, payments, avgDelayHours) {
  const t = board.team;
  return {
    score: t.notOnTimePct,
    scoreText: fmtPct(t.notOnTimePct),
    scoreTone: TV_TONE[scoreTone(t.notOnTimePct)],
    grade: board.teamGrade,
    onTimePct: pctOf(t.onTime, t.planned),
    onTimeDone: t.onTime,
    doneTotal: t.planned,
    steps: t.planned,
    lateDone: t.late,
    overdue: t.notDone,
    pending: t.backlog,
    openInTime: t.carryover,
    onHold: 0,
    avgDelayLabel: hoursLabel(avgDelayHours),
    ...payments.summary,
  };
}

/** Everything that does not depend on the period: built once per poll. */
function prepare(raw, now, custom) {
  if (!raw.rules) throw new Error(RULES_MISSING);
  const { designationOf, identityOf, nameOf } = createTeamDirectory(raw.team);
  return {
    now,
    custom,
    items: feedSteps(raw.feed),
    rules: raw.rules,
    profile: profileOf(raw.rules, PROFILE.CRM_EXEC),
    clock: clockOf(raw.feed?.builtAt, now),
    roleOf: designationOf,
    nameOf,
    identityOf,
    frozen: raw.frozen || {},
    payItems: paymentItems(raw.advancePending, raw.balancePending),
  };
}

const periodLabelOf = (key, period) => (key === CUSTOM ? periodLabel(period) : CRM_PERIODS.find((p) => p.key === key).label);

/** One period's board, or null for the custom period while it has no dates. */
function boardFor(base, key) {
  const period = crmMisPeriod(key, base.now, base.custom);
  if (!period) return null;
  const { items, rules, clock, roleOf, nameOf } = base;
  const shouldFreeze = readsFrozen(base.profile, period, base.now);
  const record = shouldFreeze ? base.frozen[frozenPeriodKey(period)] : null;
  const board = record?.board ?? buildMisBoard({ items, rules, profileKey: PROFILE.CRM_EXEC, period, now: clock, seesEveryone: true, roleOf, nameOf });
  // As on the page: the average delay and each person's steps come from the period's live report, frozen or not.
  const report = buildCrmMisReport({ items, rules, profileKey: PROFILE.CRM_EXEC, period, now: clock, seesEveryone: true, roleOf });
  const reasons = topReasonByDoer(report.steps, doerKeyOf);
  const stepsByDoer = new Map();
  report.steps.forEach((step) => {
    const doer = doerKeyOf(step);
    if (!stepsByDoer.has(doer)) stepsByDoer.set(doer, []);
    stepsByDoer.get(doer).push(step);
  });
  const details = (doer) => {
    const reason = reasons.get(doer);
    return {
      worstStep: worstStepOf(stepsByDoer.get(doer)),
      topReason: reason ? { reason: reason.reason, count: reason.count, delayed: reason.delayed } : null,
    };
  };
  const rows = [...board.rows, ...board.benched];
  const pay = paymentsOf(base, new Set(rows.map((row) => row.key)));
  const { start, end } = periodBounds(period);
  return {
    title: CRM_TITLE,
    engine: CRM_ENGINE_MIS,
    period: {
      key,
      label: periodLabelOf(key, period),
      from: period.from,
      to: period.to,
      start: start.toISOString(),
      end: end.toISOString(),
      dates: board.periodLabel || periodLabel(period),
      clock: clock.toISOString(),
      frozenAt: record ? record.createdAt || null : null,
      // A closed period whose record could not be read is shown live, and says so.
      frozenMissing: shouldFreeze && !record,
    },
    summary: summaryOf(board, pay, averageDelayHours(report.steps)),
    people: rows.map((row) => personOf(row, pay.perPerson, details)),
    insights: board.insights,
  };
}

/**
 * Every period from the same raw data. A period that throws is left out and reported in `failed`
 * so the caller can keep its last good board.
 * @param {object} raw  { feed, team, cutoffs, rules, advancePending, balancePending, frozen: { 'from_to': record } }
 * @param {{ now?: Date, custom?: { from: string, to: string }|null }} options
 * @returns {{ periods: {key,label,dates}[], engine: string, byPeriod: Record<string, object>, failed: {key, error}[] }}
 */
export function computeCrmMisBoards(raw, { now = new Date(), custom = null } = {}) {
  const base = prepare(raw, now, custom);
  const byPeriod = {};
  const failed = [];
  CRM_PERIODS.forEach(({ key }) => {
    try {
      const board = boardFor(base, key);
      if (board) byPeriod[key] = board;
    } catch (err) {
      failed.push({ key, error: err?.message || String(err) });
    }
  });
  const periods = CRM_PERIODS
    .filter(({ key }) => key !== CUSTOM || byPeriod[CUSTOM])
    .map(({ key, label }) => ({ key, label: byPeriod[key]?.period.label || label, dates: byPeriod[key]?.period.dates || null }));
  return { periods, engine: CRM_ENGINE_MIS, byPeriod, failed };
}
