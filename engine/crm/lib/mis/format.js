// VERBATIM COPY of CRM lib/mis/format.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/format.js
//
// How the MIS writes its numbers — pure, shared by the page, the CSVs and the
// PDF so all three say the same thing the same way.
//
// Ported from hr-erp lib/mis/format.ts. The CRM adds the excused outcome's
// label and `excuseText`, the reason line an excused step is listed with.

import { MIS_WARN_FLOOR } from './score.js';
import { MIS_OUTCOME } from './types.js';

/** The four tones a score can take; the screen maps them to its colours. */
export const MIS_TONE = Object.freeze({
  GOOD: 'emerald',
  WARN: 'amber',
  BAD: 'rose',
  NONE: 'slate',
});

/** Green only at 0, amber down to the warning floor, red below it; grey with nothing planned. */
export function scoreTone(pct) {
  if (pct === null) return MIS_TONE.NONE;
  if (pct === 0) return MIS_TONE.GOOD;
  return pct >= MIS_WARN_FLOOR ? MIS_TONE.WARN : MIS_TONE.BAD;
}

/** "0%", "−12.5%", "—": a true minus sign, and a decimal only when there is one. */
export function fmtPct(pct) {
  if (pct === null) return '—';
  if (pct === 0) return '0%';
  const abs = Math.abs(pct);
  return `−${Number.isInteger(abs) ? abs : abs.toFixed(1)}%`;
}

/** "−(250 − 155) ÷ 250 × 100" — a score's sum with the period's own numbers in it. */
export function missSum(planned, counted) {
  return `−(${planned} − ${counted}) ÷ ${planned} × 100`;
}

/** Past a day the minutes are noise. */
const MINUTES_SHOWN_BELOW_HOURS = 24;
const MINUTES_PER_HOUR = 60;

/**
 * Working minutes as "45m", "12h 30m", "972h" — hours, never days, since the
 * flows' working days differ in length.
 */
export function fmtWorkingMinutes(minutes) {
  if (minutes === null || minutes <= 0) return '—';
  const total = Math.round(minutes);
  const h = Math.floor(total / MINUTES_PER_HOUR);
  const m = total % MINUTES_PER_HOUR;
  if (h === 0) return `${m}m`;
  if (h >= MINUTES_SHOWN_BELOW_HOURS || m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const WHEN = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Kolkata',
});

/** "06 Oct, 14:30" on the office clock. */
export function fmtWhen(iso) {
  return iso ? WHEN.format(new Date(iso)) : '—';
}

/**
 * When a closed period's scores were frozen (owner decision #4), on the office
 * clock and under which rules: "12 Oct, 00:05 IST · rules v7".
 * @param {{ createdAt: string, rulesVersion?: number|null }} frozen
 */
export function fmtFrozen(frozen) {
  const when = `${fmtWhen(frozen?.createdAt)} IST`;
  return Number.isInteger(frozen?.rulesVersion) ? `${when} · rules v${frozen.rulesVersion}` : when;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "5 Oct" — the period's first day, for "carried over from before 5 Oct". */
export function periodStartLabel(period) {
  return DAY.format(new Date(`${period.from}T00:00:00Z`));
}

/** What each outcome is called wherever a step is listed. */
export const OUTCOME_LABEL = Object.freeze({
  [MIS_OUTCOME.ON_TIME]: 'On time',
  [MIS_OUTCOME.LATE]: 'Done late',
  [MIS_OUTCOME.NOT_DONE]: 'Not done',
  [MIS_OUTCOME.CARRIED_OVER]: 'Carried over',
  [MIS_OUTCOME.UPCOMING]: 'Not due yet',
  [MIS_OUTCOME.EXCUSED]: 'Excused',
});

/** "Done late · 3h 20m", "Not done · 5h late", "On time" — the outcome and how late. */
export function outcomeText(outcome, delayMin) {
  const late = fmtWorkingMinutes(delayMin);
  if (outcome === MIS_OUTCOME.LATE) return `${OUTCOME_LABEL[outcome]} · ${late}`;
  const isPending = outcome === MIS_OUTCOME.NOT_DONE || outcome === MIS_OUTCOME.CARRIED_OVER;
  if (isPending && late !== '—') return `${OUTCOME_LABEL[outcome]} · ${late} late`;
  return OUTCOME_LABEL[outcome];
}

/**
 * "Buyer cancelled the order — Janki Singh, 06 Oct, 14:30": the reason an
 * excused step is listed with, and who gave it when that is known.
 * @param {import('./types').MisExcuse|null} excuse
 */
export function excuseText(excuse) {
  const reason = excuse?.reason?.trim();
  if (!reason) return '—';
  const by = excuse.by?.trim();
  const when = excuse.at ? fmtWhen(excuse.at) : '';
  const signature = [by, when].filter(Boolean).join(', ');
  return signature ? `${reason} — ${signature}` : reason;
}
