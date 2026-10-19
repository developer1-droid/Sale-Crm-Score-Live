// VERBATIM COPY of CRM score-live/engine/crmMisBoard.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// The CRM Executive board when the rules score the CRM Executives on the MIS
// engine (lib/mis/profile-engine.js): the same function the Scoreboard's CRM
// section scores through (lib/mis/board.js buildMisBoard, over the CRM MIS
// report), so the TV and the Scoreboard give one score, grade, rank and reward
// for the same person and period. The payments-not-received columns are the
// report's, as on the legacy board (crmBoard.js).
//
// The engine's counts, as the TV reads them: Steps are the steps due in the
// period so far (planned), On-time is on time ÷ planned, Overdue is due and
// still open (not done), Pending is the backlog — not done plus open work
// carried over from before the period, which is listed and not scored
// (decision #3).

import { buildMisBoard } from './crm/lib/mis/board.js';
import { MIS_TONE, fmtPct, fmtWorkingMinutes, scoreTone } from './crm/lib/mis/format.js';
import { periodBounds } from './crm/lib/mis/period.js';
import { usesIstCalendar } from './crm/lib/mis/profile-engine.js';
import { PROFILE } from './crm/lib/rules/profiles-default.js';
import { crmMisPeriod, crmPeriodLabelFor } from './crmPeriods.js';

/** What the TV draws a board with: today's weighted score, or the MIS engine's. */
export const CRM_ENGINE = Object.freeze({ WEIGHTED: 'weighted', MIS: 'mis' });

/** The engine's score tones (lib/mis/format.js) as the TV's bands. */
const TV_TONE = Object.freeze({ [MIS_TONE.GOOD]: 'good', [MIS_TONE.WARN]: 'warn', [MIS_TONE.BAD]: 'bad', [MIS_TONE.NONE]: null });

const PERCENT = 100;
const countOrNull = (n) => (n ? n : null);
const pctOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * PERCENT) : null);
const delayLabel = (min) => (fmtWorkingMinutes(min) === '—' ? null : fmtWorkingMinutes(min));

function personOf(row, payments) {
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
    onTimePct: pctOf(row.onTime, row.planned),
    late: countOrNull(row.late),
    overdue: countOrNull(row.notDone),
    pending: countOrNull(row.backlog),
    avgDelayLabel: delayLabel(row.avgDelayMin),
    ...payments(row.key),
  };
}

function summaryOf(board, payments) {
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
    avgDelayLabel: null,
    ...payments.summary,
  };
}

/**
 * One period's MIS board as the TV payload.
 *
 * @param {object} base  crmBoard.js prepare(): { now, mis: { items, rules, profile, clock, roleOf } }.
 * @param {string} key  A CRM_PERIODS key.
 * @param {{ title: string, payments: (owners: Set<string>) => { perPerson: (owner: string) => object, summary: object } }} shape
 *   crmBoard.js paymentsOf, for the people this board shows.
 */
export function misBoardFor(base, key, { title, payments }) {
  const { items, rules, profile, clock, roleOf, nameOf } = base.mis;
  const period = crmMisPeriod(key, profile, base.now);
  // acceptedFeed (lib/poller.js) refuses a feed of the reader's own steps: the TV always sees everyone.
  const board = buildMisBoard({ items, rules, profileKey: PROFILE.CRM_EXEC, period, now: clock, seesEveryone: true, roleOf, nameOf });
  const rows = [...board.rows, ...board.benched];
  const pay = payments(new Set(rows.map((row) => row.key)));
  const { start, end } = periodBounds(period);
  return {
    title,
    engine: CRM_ENGINE.MIS,
    period: {
      key,
      label: crmPeriodLabelFor(key, usesIstCalendar(profile)),
      start: start.toISOString(),
      end: end.toISOString(),
      dates: board.periodLabel,
    },
    summary: summaryOf(board, pay),
    people: rows.map((row) => personOf(row, pay.perPerson)),
    insights: board.insights,
  };
}
