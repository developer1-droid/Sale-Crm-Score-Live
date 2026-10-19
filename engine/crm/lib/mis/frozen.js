// VERBATIM COPY of CRM lib/mis/frozen.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/frozen.js
//
// A closed period's scores, frozen (owner decision #4): once an IST week or a
// calendar month has ended, a profile that freezes on close
// (ScoringProfile.outcome.freezeOnClose) is read from the record written for
// it, never recomputed, so a reward paid on it can always be reproduced. The
// record is written once, the first time a view-all reader asks for the
// period after it closed (app/api/mis/periods), and never overwritten.
//
// Only a whole period is frozen — a Monday-to-Sunday week or a calendar month,
// the periods decision #2 scores and rewards; a custom range is a view, read
// live. Here are the pure parts: which periods and profiles freeze, who may
// read them, the record's id and its shape, what a request may ask for, and a
// record as the pages list it. lib/mis/frozen.server.js computes and stores.
//
// Pure; lib/__tests__/mis-frozen.test.js, lib/__tests__/mis-frozen-views.test.js.

import { PERMISSIONS } from '../roles.js';
import { PROFILE } from '../rules/profiles-default.js';
import { isPlainObject } from '../rules/util.js';
import { STEP_FEED_VIEW_ALL_SLUGS } from '../step-feed/route-logic.js';
import { customPeriod } from './board-period.js';
import { parseMisDay, periodBounds, periodLabel } from './period.js';
import { PURCHASE_PROFILE, freezesOnClose, rewardRuleOf, scoresOnMisEngine } from './profile-engine.js';
import { missPct } from './score.js';

/** orgConfig/{orgId}/misPeriods/{profileKey}_{from}_{to}. */
export const ORG_CONFIG_COLLECTION = 'orgConfig';
export const MIS_PERIODS_COLLECTION = 'misPeriods';

/**
 * The profiles the reports show on the MIS engine, and so the ones whose
 * periods are frozen: the Scoreboard's teams, Department Analytics' Other tab,
 * and Purchase, whose record is HR-ERP's scores as sent.
 */
export const FROZEN_PROFILE_KEYS = Object.freeze([
  PROFILE.CRM_EXEC, PROFILE.PC_DESK, PROFILE.DEPT_OTHER, PROFILE.DESIGNER, PURCHASE_PROFILE,
]);

/** The profiles scored over the step feed; the designers' steps and the purchase scores come from hr-erp. */
export const FEED_PROFILE_KEYS = Object.freeze([PROFILE.CRM_EXEC, PROFILE.PC_DESK, PROFILE.DEPT_OTHER]);

/**
 * Who may read which records, each grant met by holding any one of its slugs:
 * a step-feed board holds everyone's places, so it takes a grant that already
 * shows everyone's steps; the Designer MIS and the Purchase MIS show every
 * person of their team to every reader they have, so theirs take only that
 * report's own grant.
 */
const FROZEN_GRANTS = Object.freeze([
  Object.freeze({
    profileKeys: FEED_PROFILE_KEYS,
    slugs: STEP_FEED_VIEW_ALL_SLUGS,
    refusal: "You need a grant that shows everyone's steps to read a period's frozen scores",
  }),
  Object.freeze({
    profileKeys: Object.freeze([PROFILE.DESIGNER]),
    slugs: Object.freeze([PERMISSIONS.VIEW_DESIGNER_MIS]),
    refusal: 'You do not have permission to read the Designer MIS',
  }),
  Object.freeze({
    profileKeys: Object.freeze([PURCHASE_PROFILE]),
    slugs: Object.freeze([PERMISSIONS.VIEW_PURCHASE_MIS]),
    refusal: 'You do not have permission to view the Purchase MIS',
  }),
]);

/**
 * The grants a request for these profiles' records needs — every one of them —
 * each with what the route says to a reader who lacks it.
 * @param {string[]} profileKeys
 * @returns {{ slugs: string[], refusal: string }[]}
 */
export const frozenGrantsOf = (profileKeys) => FROZEN_GRANTS
  .filter((grant) => (profileKeys ?? []).some((key) => grant.profileKeys.includes(key)))
  .map(({ slugs, refusal }) => ({ slugs: [...slugs], refusal }));

export const PERIOD_KIND = Object.freeze({ WEEK: 'week', MONTH: 'month' });

const DAY_MS = 86_400_000;
const DAYS_IN_WEEK = 7;
const MONDAY = 1;
const FIRST_OF_MONTH = '01';
const DAY_OF_MONTH_START = 8;

const utcDay = (day) => new Date(`${day}T00:00:00Z`);

/** A whole IST week (Monday to Sunday) or a whole calendar month; null for any other range. */
export function periodKindOf(period) {
  const from = parseMisDay(period?.from);
  const to = parseMisDay(period?.to);
  if (!from || !to) return null;
  const start = utcDay(from);
  const days = (utcDay(to).getTime() - start.getTime()) / DAY_MS + 1;
  if (start.getUTCDay() === MONDAY && days === DAYS_IN_WEEK) return PERIOD_KIND.WEEK;
  const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (from.slice(DAY_OF_MONTH_START) === FIRST_OF_MONTH && to === monthEnd) return PERIOD_KIND.MONTH;
  return null;
}

/** The period has ended: IST midnight after its last day has passed. */
export const isPeriodClosed = (period, now) => periodBounds(period).end.getTime() <= now.getTime();

/** The record's key within the profile: "2026-10-05_2026-10-11". */
export const frozenPeriodKey = (period) => `${period.from}_${period.to}`;

/** The record's document id: "crmExec_2026-10-05_2026-10-11". */
export const frozenDocId = (profileKey, period) => `${profileKey}_${frozenPeriodKey(period)}`;

/** A profile's period is read from its frozen record: it freezes on close, and this is a whole period that has closed. */
export const readsFrozen = (profile, period, now) =>
  scoresOnMisEngine(profile) && freezesOnClose(profile) && periodKindOf(period) !== null && isPeriodClosed(period, now);

/**
 * The step-feed profiles to freeze beside the ones a read has to compute:
 * every other one the rules freeze for the period, so one build of the feed is
 * one snapshot — a person's frozen score on the Scoreboard and on Department
 * Analytics never comes from two different instants. None when nothing from
 * the feed is being computed.
 *
 * @param {string[]} computing  The profiles being computed now.
 * @param {object} rules  The resolved rules.
 * @param {import('./types.js').MisPeriod} period
 * @param {Date} now
 * @returns {string[]}
 */
export function feedSiblingsOf(computing, rules, period, now) {
  if (!computing.some((key) => FEED_PROFILE_KEYS.includes(key))) return [];
  return FEED_PROFILE_KEYS.filter((key) => !computing.includes(key) && readsFrozen(rules?.profiles?.[key], period, now));
}

const refused = (status, error) => ({ ok: false, status, error });

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

/** The profile keys asked for, each once, in FROZEN_PROFILE_KEYS order; null when one is not a frozen profile. */
function profileKeysOf(asked) {
  const keys = [...new Set((asked ?? []).map((key) => String(key ?? '').trim()).filter(Boolean))];
  if (keys.length === 0 || keys.some((key) => !FROZEN_PROFILE_KEYS.includes(key))) return null;
  return FROZEN_PROFILE_KEYS.filter((key) => keys.includes(key));
}

/**
 * What a request for frozen records may have: frozen profiles, a whole period
 * that has closed, and profiles the rules freeze on close.
 *
 * @param {{ profileKeys: string[], from: string, to: string }} asked
 * @param {object} rules  The resolved rules.
 * @param {Date} now
 * @returns {{ ok: true, period: import('./types.js').MisPeriod, profileKeys: string[] } | { ok: false, status: number, error: string }}
 */
export function frozenRequestOf({ profileKeys, from, to }, rules, now) {
  const keys = profileKeysOf(profileKeys);
  if (!keys) return refused(HTTP_BAD_REQUEST, `Ask for one or more of: ${FROZEN_PROFILE_KEYS.join(', ')}.`);
  const period = customPeriod(from, to);
  if (!period || !periodKindOf(period)) {
    return refused(HTTP_BAD_REQUEST, 'Only a whole IST week (Monday to Sunday) or a calendar month is frozen.');
  }
  if (!isPeriodClosed(period, now)) return refused(HTTP_CONFLICT, 'The period has not closed yet, so its scores are read live.');
  const open = keys.filter((key) => !readsFrozen(rules?.profiles?.[key], period, now));
  if (open.length > 0) return refused(HTTP_CONFLICT, `The rules do not freeze these scores on close: ${open.join(', ')}.`);
  return { ok: true, period, profileKeys: keys };
}

/**
 * What Firestore stores and the route answers: plain data with nothing
 * undefined in it (Firestore refuses an undefined field) — such a field is
 * left out, an undefined array entry is null — and instants as ISO text.
 */
function plain(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : plain(item)));
  if (value instanceof Date) return value.toISOString();
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, plain(child)]));
}

/**
 * The record a closed period is frozen as.
 *
 * @param {{ board: import('./board.js').MisBoard, rules: object, orgId: string, createdBy: string, createdAt: Date }} input
 */
export function frozenRecordOf({ board, rules, orgId, createdBy, createdAt }) {
  const profile = rules?.profiles?.[board.profileKey] ?? null;
  return plain({
    profileKey: board.profileKey,
    period: board.period,
    periodKey: frozenPeriodKey(board.period),
    periodKind: periodKindOf(board.period),
    orgId,
    rulesVersion: Number.isInteger(rules?.version) ? rules.version : null,
    profile: {
      label: profile?.label ?? board.label,
      formula: profile?.formula ?? null,
      grades: profile?.grades ?? null,
      reward: profile?.reward ?? null,
      outcome: profile?.outcome ?? null,
    },
    board: { ...board, seesEveryone: true },
    createdAt: createdAt.toISOString(),
    createdBy,
  });
}

/**
 * The Purchase section's board as its record keeps it: HR-ERP's purchase
 * scores as sent (decision #22) — never re-scored here — with the period and
 * the reward rule they were frozen under.
 *
 * @param {{ coordinators?: object[] }} payload  HR-ERP's answer (lib/scoring/purchaseScores.server.js).
 * @param {{ rules: object, period: import('./types.js').MisPeriod, now: Date }} input
 */
export function purchaseBoardOf(payload, { rules, period, now }) {
  const profile = rules?.profiles?.[PURCHASE_PROFILE] ?? null;
  return {
    profileKey: PURCHASE_PROFILE,
    label: profile?.label ?? PURCHASE_PROFILE,
    period,
    periodLabel: periodLabel(period),
    generatedAt: now.toISOString(),
    coordinators: Array.isArray(payload?.coordinators) ? payload.coordinators : [],
    reward: rewardRuleOf(profile),
  };
}

/** A frozen board row as the engine's doer row (lib/mis/score.js scoreMis), with its rank, grade and reward. */
const doerOfRow = (row) => ({
  doer: row.name,
  doerId: row.doerId ?? null,
  rank: row.rank,
  notOnTimePct: row.score,
  notDonePct: missPct(row.planned - row.done, row.planned),
  planned: row.planned,
  done: row.done,
  onTime: row.onTime,
  late: row.late,
  notDone: row.notDone,
  carryover: row.carryover,
  upcoming: row.upcoming,
  excused: row.excused,
  backlog: row.backlog,
  avgDelayMin: row.avgDelayMin ?? null,
  grade: row.grade,
  isRewarded: Boolean(row.isRewarded),
  duties: [],
  flows: [],
  byStep: [],
});

const NO_LABELS = () => ({});

/**
 * A frozen board's people as the MIS pages list doers: the ranked, then those
 * with nothing planned — the scores of record, nothing recomputed. `labelsOf`
 * adds what a page shows beside a name from today's rules (duties, the
 * registry's mark), never a number.
 *
 * @param {{ rows?: object[], benched?: object[] }} board  A record's board (lib/mis/board.js MisBoard).
 * @param {(doerId: string|null) => object} [labelsOf]
 */
export function frozenDoersOf(board, labelsOf = NO_LABELS) {
  return [...(board?.rows ?? []), ...(board?.benched ?? [])]
    .map((row) => ({ ...doerOfRow(row), ...labelsOf(row.doerId ?? null) }));
}
