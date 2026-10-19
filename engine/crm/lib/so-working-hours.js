// VERBATIM COPY of CRM lib/so-working-hours.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/so-working-hours.js
// Working-hour calendar + SO-FMS per-step PLANNED-date computation, derived
// purely from a single SO master row's step data (no Split-SO / cutoff gating).
// Mirrors the SO FMS dashboard's recomputePlannedForSO so reports can reproduce
// the same planned dates the dashboard shows, for EVERY order in the tracker.
//
// Two clocks, one implementation (lib/rules/calendar.js createWorkCalendar):
//   - addWorkingMinutes / workingMinutesBetween are the office clock of the
//     rules registry (lib/work-clock.js) — the CRM FMS clock, the settlement
//     lane, tickets and the telex clock measure on it, so an hour or a holiday
//     edited in Settings > Report Rules moves them with the boards.
//   - computeSoStepPlanned runs on the built-in office calendar, pinned: the
//     Sales Coordinator report reads it, and the owner's scope keeps that report
//     exactly as it is (docs/reports-rules-decisions.md). The SO FMS board and
//     every other report read the board's own plans (lib/so-fms-planned.js).

import { classifyPaymentFamily } from './payment-terms-family.js';
import { ORDER_SCHEDULED_LEAD_MIN, SO_SLA_MIN } from './so-fms-sla.js';
import { SOB_CONFIRMED_SOURCE, SOB_ETD_SOURCE, STEP8_ACTUAL_SOURCE, step11Planned } from './so-fms-step11-planned.js';
import { createWorkCalendar } from './rules/calendar.js';
import { BUILT_IN_OFFICE } from './work-clock.js';

export { addWorkingMinutes, workingMinutesBetween } from './so-fms-datetime.js';

/** The office calendar as it was before the registry, never edited: the Sales Coordinator's planner. */
const PINNED_OFFICE = createWorkCalendar(BUILT_IN_OFFICE);
const PINNED_CLOSE = { h: Math.floor(PINNED_OFFICE.closingMinute / 60), m: PINNED_OFFICE.closingMinute % 60 };

const pinnedAdd = (start, minutes) => (start ? PINNED_OFFICE.addWorkingMinutes(start, minutes) : null);
const isPinnedWorkingDay = (d) => PINNED_OFFICE.isWorkingDay(d);

// A dispatch date maps to a Step-0 (Order Scheduled) Planned of that day at
// 18:00:00 local — the working-day end. Shared by the SO FMS board's override
// and PC Report so their Step-0 planned dates match. Accepts a Date, a parseable
// value, or null; returns a Date at 18:00:00, or null when unparseable.
export function plannedFromDispatch(dispatchDate) {
  if (!dispatchDate) return null;
  const d = dispatchDate instanceof Date ? dispatchDate : new Date(dispatchDate);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0, 0, 0);
}

/** `days` working days before the date, at the close of that day — on the pinned calendar. */
export function subtractWorkingDays(startDate, days) {
  if (!startDate) return null;
  let d = new Date(startDate.getTime());
  let left = Math.max(0, days);
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    if (isPinnedWorkingDay(d)) left--;
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), PINNED_CLOSE.h, PINNED_CLOSE.m, 0);
}

// Tolerant timestamp parse: DD/MM or MM/DD slash (with optional am/pm), ISO, or
// Google Sheets serial number. Returns a Date or null.
export function parseSoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const num = Number(v);
  if (!Number.isNaN(num) && num > 25569 && num < 100000) {
    const utcDays = Math.floor(num - 25569);
    const sec = Math.round(86400 * (num - Math.floor(num)));
    const d = new Date(utcDays * 86400 * 1000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60);
  }
  let s = String(v).replace(',', '').replace(/\s+/g, ' ').trim();
  if (!s || s === '0') return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?$/i);
  if (m) {
    let [, a, b, yyyy, hh, mi, ss, ap] = m;
    const A = +a, B = +b; hh = hh ? +hh : 0; mi = mi ? +mi : 0; ss = ss ? +ss : 0;
    if (ap && ap.toLowerCase() === 'pm' && hh < 12) hh += 12;
    if (ap && ap.toLowerCase() === 'am' && hh === 12) hh = 0;
    // Ambiguous slash dates (both ≤ 12) default to MM/DD/YYYY — matches Sheets/V8,
    // the canonical parseIndianTimestamp (/api/pc-report) and the SO FMS page. Was
    // DD/MM, which misread e.g. "06/12/2026" (12 Jun) as 6 Dec → phantom delays.
    const dd = A > 12 ? A : B, mm = A > 12 ? B : A;
    const d = new Date(+yyyy, mm - 1, dd, hh, mi, ss);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) { const [, y, mo, da, hh = '0', mi = '0', ss = '0'] = m; const d = new Date(+y, +mo - 1, +da, +hh, +mi, +ss); return Number.isNaN(d.getTime()) ? null : d; }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Group a normalized SO master row object → { step1: { actual_date, planned_date,
// extended_date, form_timestamp, ... }, ... }. Handles step_11_5 etc.
export function buildStepData(rowObj) {
  const stepData = {};
  Object.keys(rowObj).forEach((k) => {
    const m = k.match(/^step_?(\d+(?:_\d+)?)_(planned_date|actual_date|extended_date|dispatch_date|delay_reason|form_timestamp|final_eta|expected_eta|expected_dispatch|arrival_date|actual_arrival_date)$/);
    if (!m) return;
    const key = m[1] === '0' ? 'orderScheduled' : `step${m[1]}`;
    if (!stepData[key]) stepData[key] = {};
    stepData[key][m[2]] = rowObj[k];
  });
  return stepData;
}

/** Step-10 (legalisation / consulate scan) is an Egypt-only leg of the flow. */
export const isEgypt = (country) => String(country ?? '').toLowerCase().includes('egypt');

/**
 * Day-first reader for the one timestamp the sheet stores India-format.
 *
 * parseSoDate resolves an ambiguous "06/12/2026" as MM/DD, matching Sheets and
 * most of this data. The SOB form does not: it writes DD/MM, so the same string
 * there means 12 June. Reading it the general way moves the Step-8 deadline by
 * months, which is why the board has always parsed this one day-first.
 */
export function parseDayFirstSoDate(v) {
  const s = String(v ?? '').replace(',', '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?$/i);
  if (!m) return parseSoDate(v);

  let [, dd, mm, yyyy, hh, mi, ss, ap] = m;
  hh = hh ? +hh : 0; mi = mi ? +mi : 0; ss = ss ? +ss : 0;
  if (ap && ap.toLowerCase() === 'pm' && hh < 12) hh += 12;
  if (ap && ap.toLowerCase() === 'am' && hh === 12) hh = 0;

  const d = new Date(+yyyy, +mm - 1, +dd, hh, mi, ss);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A scheduled dispatch turns into a deadline at 18:00 on that day - the close of
 * the working day the order was promised for. Day-first, like the board.
 */
export function plannedFromDispatchDate(dispatchDate) {
  const d = parseDayFirstSoDate(dispatchDate);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0, 0);
}

/**
 * Planned date for one step, matching the SO FMS board rule for rule.
 *
 * The board is the source of truth for these deadlines: it is where the
 * operations team reads them, and every report has to agree with it or the same
 * order looks on-time in one screen and late in another.
 *
 * Precedence is the board's: a stored extended date beats a stored planned
 * date, which beats the computed rule (the board applies this later in its
 * pipeline; same order, same result).
 *
 * @param {object} stepData  From buildStepData.
 * @param {string} stepId    'orderScheduled', 'step7', 'step11_5', ...
 * @param {object} [context] Facts the master row does not carry:
 *   - country            Step-10 is Egypt-only.
 *   - orderSchedBaseTime Step-0's clock: MAX(design approval, SO approval).
 *   - arrivalDate        Step-11's preferred reference.
 *   - paymentTerms       Step-11's rule differs per term; omit for the legacy rule.
 *   - advanceTerms       Step-11 ADVANCE: what its BALANCE is due against.
 *   - sobEtd             Step-11 starts from the vessel's SOB ETD; without it
 *                        the SOB confirmation, then the Step-8 actual stands in.
 *   - blDate             Step-11 DA counts its tenor from here when recorded.
 *   - noOfDaysIfDA       Step-11 DA tenor, as the sheet stores it.
 *   - latestPaymentAt    Step-11.5 runs from the latest payment entry.
 *   - expectedDispatch   Step-4's reference when the row does not carry it.
 * @returns {Date|null}
 */
export function computeSoStepPlanned(stepData, stepId, context = {}) {
  const sd = stepData[stepId] || {};
  const stored = String(sd.extended_date || sd.planned_date || '').trim();
  if (stored && parseSoDate(stored)) return parseSoDate(stored);

  const ts = (id, field) => parseSoDate(String(stepData[id]?.[field] || '').trim());
  const ctx = (value) => parseSoDate(String(value || '').trim());
  const dispatch = ts('orderScheduled', 'dispatch_date');

  switch (stepId) {
    // A promised dispatch is the deadline; before one exists, the order is due
    // to be scheduled 3 working days after the last approval it was waiting on.
    case 'orderScheduled': {
      const scheduled = plannedFromDispatchDate(
        stepData.orderScheduled?.dispatch_date || context.dispatchDate
      );
      if (scheduled) return scheduled;
      const base = ctx(context.orderSchedBaseTime);
      return base ? pinnedAdd(base, ORDER_SCHEDULED_LEAD_MIN) : null;
    }

    case 'step1': return dispatch ? subtractWorkingDays(dispatch, 10) : null;

    // Buyer approval of pre-shipment drafts - due 3 working hours after the
    // Step-1 drafts were shared (the approve-button click time).
    case 'step2': { const r = ts('step1', 'actual_date'); return r ? pinnedAdd(r, SO_SLA_MIN.step2) : null; }

    // Packing images are due two working days before the dispatch the order is
    // booked on NOW, so a reschedule moves the deadline with it. The master
    // tracker's Step-0 Dispatch Date is that current date - the same one the
    // board reads off the newest schedule-history entry.
    case 'step3': return dispatch ? subtractWorkingDays(dispatch, 2) : null;

    // The dispatch update is due the working day before the cargo is expected
    // out. The expected date comes from cargo-ready, so a caller without it can
    // pass one in rather than leaving Step-4 unplanned.
    case 'step4': {
      const r = ts('step4', 'expected_dispatch') || ts('step4', 'dispatch_date') || ctx(context.expectedDispatch);
      return r ? subtractWorkingDays(r, 1) : null;
    }

    case 'step5': { const r = ts('step4', 'actual_date') || ts('step4', 'planned_date'); return r ? pinnedAdd(r, SO_SLA_MIN.step5) : null; }
    case 'step6': { const r = ts('step5', 'actual_date') || ts('step5', 'planned_date'); return r ? pinnedAdd(r, SO_SLA_MIN.step6) : null; }

    case 'step7': { const r = ts('step7', 'form_timestamp'); return r ? pinnedAdd(r, SO_SLA_MIN.step7) : null; }

    // Day-first: the SOB form writes DD/MM. See parseDayFirstSoDate.
    case 'step8': {
      const raw = String(stepData.step8?.form_timestamp || '').trim();
      const r = raw ? parseDayFirstSoDate(raw) : null;
      return r ? pinnedAdd(r, SO_SLA_MIN.step8) : null;
    }

    case 'step9': { const r = ts('step9', 'form_timestamp'); return r ? pinnedAdd(r, SO_SLA_MIN.step9) : null; }

    // Egypt only - the legalisation scan does not exist elsewhere, so without a
    // country (or outside Egypt) the step has no deadline and is not scored.
    case 'step10': {
      if (!isEgypt(context.country)) return null;
      const r = ts('step9', 'actual_date') || ts('step9', 'planned_date');
      return r ? pinnedAdd(r, SO_SLA_MIN.step10) : null;
    }

    // When payment is due, per payment term — the board's rule, shared from
    // lib/so-fms-step11-planned.js rather than copied, because this file and the
    // board drifting apart is exactly the failure the header warns about.
    //
    // A caller that does not pass `paymentTerms` gets the OTHER branch, which is
    // the unchanged arrival-minus-6-working-days rule. So a report keeps reading
    // as it always has until its context is wired up.
    case 'step11': {
      // Every chase starts when the vessel sails. The master tracker holds no
      // ETD and no SOB form timestamp — only a caller that merged the vessel
      // feed (withFormTimestamps) has the SOB confirmation, which the form
      // writes day-first. The tracker's own Step-8 actual (SOB confirmed on the
      // board) stands in after that, so no report loses Step-11 altogether.
      const [value, source] = [
        [ctx(context.sobEtd), SOB_ETD_SOURCE],
        [parseDayFirstSoDate(String(stepData.step8?.form_timestamp || '').trim()), SOB_CONFIRMED_SOURCE],
        [ts('step8', 'actual_date'), STEP8_ACTUAL_SOURCE],
      ].find(([date]) => date) || [null, null];
      const sob = { value: value ? value.toISOString() : null, source };
      const { plannedDateTime } = step11Planned({
        family: classifyPaymentFamily(context.paymentTerms),
        advanceTerms: context.advanceTerms,
        sob,
        loadingAt: ts('step7', 'actual_date'),
        dispatchAt: ts('step4', 'actual_date'),
        telexAt: ts('step13', 'actual_date'),
        step11: {
          arrivalDate: ctx(context.arrivalDate),
          blDate: ctx(context.blDate),
        },
        step6: { finalETA: ts('step6', 'final_eta') },
        step5: { expectedETA: ts('step5', 'expected_eta') },
        noOfDaysIfDA: context.noOfDaysIfDA,
      });
      return plannedDateTime ? new Date(plannedDateTime) : null;
    }

    // Accounts confirm within 3 working hours of the payment entry itself. The
    // Step-11 actual is only a fallback for callers without the payment ledger.
    case 'step11_5': {
      const r = ctx(context.latestPaymentAt) || ts('step11', 'actual_date');
      return r ? pinnedAdd(r, SO_SLA_MIN.step11_5) : null;
    }

    // Container arrived -> confirm it within 6 working hours. Keyed off the
    // arrival date the Step-12 modal records, not off Step-12's own actual.
    case 'step12': {
      const r = ts('step12', 'actual_arrival_date') || ts('step12', 'arrival_date');
      return r ? pinnedAdd(r, SO_SLA_MIN.step12) : null;
    }

    // CRM telex submission + 1 working HOUR (form only - no accounts fallback).
    case 'step13': { const r = ts('step13', 'form_timestamp'); return r ? pinnedAdd(r, SO_SLA_MIN.step13) : null; }

    // Six working days after the container was confirmed arrived.
    case 'step14': { const r = ts('step12', 'actual_date'); return r ? pinnedAdd(r, SO_SLA_MIN.step14) : null; }

    default: return null;
  }
}
