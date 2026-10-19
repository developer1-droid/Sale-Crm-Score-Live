// VERBATIM COPY of CRM lib/so-fms-step11-planned.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/so-fms-step11-planned.js
//
// When Step-11 (REQUEST PAYMENT) is due, per payment term — and how that date
// was arrived at.
//
// Until now one rule served every order: arrival minus six working days,
// written out as a literal in three separate files — the board engine
// (lib/so-fms-planned.js), the transform's own copy, and the reports
// (lib/so-working-hours.js). The business chases an advance, a DP, a DA and a
// CAD/LC on completely different clocks, so the single rule was wrong for three
// of the four, and any change to it had to be made three times or the same
// order would read on-time on the board and late in a report.
//
// One function now, imported by all three.
//
// Every answer carries an `explain` trace: the anchor it counted from, which
// feed that anchor came out of, each shift applied, and the result. This date
// decides whether an order reads late, and a deadline nobody can account for is
// a deadline nobody trusts — the board hangs the trace off the Planned cell.
//
// The windows are stated in CALENDAR days because a vessel does not wait for a
// Sunday. The resulting deadline does move off a Sunday, backwards, because
// nobody is at a desk to meet it.

import {
  ADVANCE_BALANCE_ANCHOR,
  resolveAdvanceBalanceAnchor,
} from './advance-balance-anchor.js';
import { PAYMENT_FAMILY, PAYMENT_FAMILY_LABEL } from './payment-terms-family.js';
import {
  isWorkingDate,
  parseDayFirstDT,
  parseDT,
  previousWorkingDay,
  shiftCalendarDays,
  subtractWorkingDays,
} from './so-fms-datetime.js';

/** Calendar days before the vessel arrives that a DP buyer is first reminded. */
export const DP_FIRST_REMINDER_DAYS = 15;
/** Calendar days before the anchor that the recurring chase begins. */
export const CHASE_LEAD_DAYS = 7;
/** The pre-existing rule, still used by terms that match no family. */
export const LEGACY_LEAD_WORKING_DAYS = 6;

export const STEP11_PENDING_REASON = {
  CI: 'Wait CI',
  SOB: 'Wait SOB ETD',
  BALANCE: 'Wait balance trigger',
  NO_BALANCE: 'Paid in full up front',
  SIGNED_PI: 'Wait Signed PI',
  ARRIVAL: 'Wait Arrival/ETA',
  DA_TENOR: 'Wait DA days',
  DA_BASE: 'Wait B/L date',
};

/**
 * The ETA the board counts from, and which feed it came out of. `arrivalDate`
 * is vessel planning's latest revision; the Step-6 and Step-5 values stand in
 * before one exists so a row is not blank for its whole pre-shipment life.
 */
const resolveArrival = (step11, step6, step5) => {
  if (step11?.arrivalDate) return { value: step11.arrivalDate, source: 'Vessel planning ETA' };
  if (step6?.finalETA) return { value: step6.finalETA, source: 'Step-6 Final ETA' };
  if (step5?.expectedETA) return { value: step5.expectedETA, source: 'Step-5 Expected ETA' };
  return { value: null, source: null };
};

const iso = (d) => (d ? d.toISOString() : null);

export const SOB_ETD_SOURCE = 'Step-8 SOB ETD';
export const SOB_CONFIRMED_SOURCE = 'Step-8 SOB confirmation — no ETD entered';
export const STEP8_ACTUAL_SOURCE = 'Step-8 actual — no SOB ETD on this feed';

// An ETD is a calendar date. Read 'YYYY-MM-DD' as that local day rather than
// UTC midnight, which would show as a made-up 05:30 in the explanation.
const DATE_ONLY_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const parseSobDate = (value) => {
  const m = String(value ?? '').trim().match(DATE_ONLY_ISO);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return parseDayFirstDT(value);
};

/**
 * When the vessel sailed, as Step-8 (SOB confirmation) records it — the moment
 * every Step-11 chase starts. The ETD the coordinator enters on the SOB form,
 * from its latest entry that has one; most older SOB rows leave it blank, and
 * the SOB confirmation's own date stands in. The form writes DD/MM or ISO.
 *
 * @param {object} step8  the board's Step-8: etd, formTimestamp, entries[{etdDate}]
 * @returns {{value: string|null, source: string|null}}
 */
export const resolveSobEtd = (step8 = {}) => {
  // Newest SOB entry first, by its own day-first timestamp — the transform's
  // order reads ambiguous DD/MM timestamps month-first. Ties keep sheet order.
  const entries = (Array.isArray(step8?.entries) ? step8.entries : [])
    .map((entry, index) => ({ entry, index, at: parseDayFirstDT(entry?.timestamp)?.getTime() ?? -Infinity }))
    .sort((a, b) => (b.at - a.at) || (b.index - a.index))
    .map(({ entry }) => entry);
  const etd = [...entries.map((e) => e?.etdDate), step8?.etd]
    .map((v) => parseSobDate(v))
    .find(Boolean);
  if (etd) return { value: iso(etd), source: SOB_ETD_SOURCE };
  const confirmed = parseDayFirstDT(step8?.formTimestamp);
  if (confirmed) return { value: iso(confirmed), source: SOB_CONFIRMED_SOURCE };
  return { value: null, source: null };
};

/** One line of the calculation the reader is being shown. */
const line = (label, value, note) => ({ label, value: value ?? null, ...(note ? { note } : {}) });

const waiting = (rule, reason, steps) => ({
  plannedDateTime: null,
  pendingReason: reason,
  isProvisional: false,
  explain: { rule, outcome: 'waiting', steps: [...steps, line('Waiting on', reason)] },
});

/** The close of the first working day on or after this date. */
const nextWorkingDayClose = (date) => {
  let d = shiftCalendarDays(date, 0);
  for (let i = 0; d && i < 14 && !isWorkingDate(d); i += 1) d = shiftCalendarDays(d, 1);
  return d;
};

/**
 * Finish a rule: hold the date back to the vessel sailing, move a Sunday
 * deadline, and record whichever of those actually happened.
 *
 * Nothing is chased before the goods are on the water, so a rule date that falls
 * earlier than the Step-8 SOB ETD is pulled forward to it. A Sunday deadline
 * moves back to the Saturday — unless that would land before the sailing, when
 * it moves forward to the next working day instead.
 */
const settled = (date, rule, steps, { isProvisional = false, notBefore = null } = {}) => {
  const floor = parseDT(notBefore);
  const held = floor && parseDT(date) && floor > parseDT(date) ? floor : parseDT(date);
  const heldBack = held && iso(held) !== iso(parseDT(date));
  const back = previousWorkingDay(held) || held;
  const nudged = floor && back && back < floor ? nextWorkingDayClose(floor) || back : back;
  const moved = held && iso(nudged) !== iso(held);
  const movedForward = moved && nudged > held;
  return {
    plannedDateTime: iso(nudged),
    pendingReason: null,
    isProvisional,
    explain: {
      rule,
      outcome: 'planned',
      steps: [
        ...steps,
        ...(heldBack ? [line('SOB ETD', notBefore, 'later than the rule date — nothing is chased before the vessel sails')] : []),
        ...(moved ? [line('Falls on a Sunday', iso(held), movedForward
          ? 'moved forward — the Saturday before would be ahead of the sailing'
          : 'moved back to the previous working day')] : []),
        line('Planned', iso(nudged)),
      ],
    },
  };
};

/* ------------------------------ per-term rules ----------------------------- */

// An ADVANCE order has already paid its advance — the existing reminder job
// chases that. Step-11 is the BALANCE, and the order's own terms say what the
// balance is due against: "30% & BALANCE AGAINST DOCUMENTS", "20% & Balance
// Against BL", "20% Balance after 35 days from SOB date". 803 of 1,018 live
// advance orders say documents, which is why that is the fallback.
const advanceRule = (advanceTerms, anchors, head) => {
  const { anchor, days } = resolveAdvanceBalanceAnchor(advanceTerms);
  const said = line('Balance due against', advanceTerms, `read as ${anchor.replace('_', ' ')}`);
  const A = ADVANCE_BALANCE_ANCHOR;

  if (anchor === A.NONE) {
    return waiting('Paid 100% in advance — no balance to chase', STEP11_PENDING_REASON.NO_BALANCE, [...head, said]);
  }
  if (anchor === A.UNCLEAR) {
    return waiting('These terms name no balance trigger we can read', STEP11_PENDING_REASON.BALANCE, [...head, said]);
  }
  // A balance payable in CAD or against an LC runs on the ordinary CAD clock.
  if (anchor === A.CAD || anchor === A.LC) return cadLcRule(anchors.arrival, [...head, said], anchors);

  // Balance "against documents" is chased from sailing, not from Step-9: the
  // documents follow the vessel, and waiting on the scan let orders drift.
  const from = {
    [A.DOCS]: ['Chased from', anchors.sob.value, 'SOB ETD — the documents follow the vessel'],
    [A.BL]: ['B/L date', anchors.blDate || anchors.sob.value, anchors.blDate ? undefined : 'SOB ETD standing in — no B/L date is recorded in the CRM yet'],
    [A.LOADING]: ['Container stuffing', anchors.loadingAt, 'Step-7 actual'],
    [A.DISPATCH]: ['Dispatch', anchors.dispatchAt, 'Step-4 actual'],
    [A.TELEX]: ['Telex release', anchors.telexAt, 'Step-13 actual'],
    [A.ARRIVAL]: ['Arrival', anchors.arrival.value, anchors.arrival.source],
    [A.SOB_DAYS]: ['Counted from', anchors.sob.value, `SOB ETD — balance falls due ${days} days later`],
  }[anchor];

  const [label, value, note] = from;
  const base = parseDT(value);
  const rule = {
    [A.SOB_DAYS]: `Balance ${days} days after SOB ETD`,
    [A.DOCS]: 'Balance against documents — chased from SOB ETD',
    [A.BL]: 'Balance against B/L',
  }[anchor] || `Balance against ${label.toLowerCase()}`;
  if (!base) return waiting(rule, STEP11_PENDING_REASON.BALANCE, [...head, said, line(label, value, note)]);

  const due = anchor === A.SOB_DAYS ? shiftCalendarDays(base, days) : base;
  const steps = [...head, said, line(label, value, note)];
  if (anchor === A.SOB_DAYS) steps.push(line('Balance due', iso(due)));
  return settled(due, rule, steps, { notBefore: anchors.sob.value });
};

const dpRule = (arrival, head, anchors) => {
  const rule = `Arrival − ${DP_FIRST_REMINDER_DAYS} calendar days (first reminder)`;
  if (!arrival.value) return waiting(rule, STEP11_PENDING_REASON.ARRIVAL, head);
  const d = shiftCalendarDays(arrival.value, -DP_FIRST_REMINDER_DAYS);
  return settled(d, rule, [
    ...head,
    line('Arrival', arrival.value, arrival.source),
    line(`Minus ${DP_FIRST_REMINDER_DAYS} calendar days`, iso(d)),
  ], { notBefore: anchors.sob.value });
};

const daRule = (noOfDaysIfDA, head, anchors) => {
  const rule = `(B/L date + DA days) − ${CHASE_LEAD_DAYS} calendar days`;
  const tenor = parseInt(noOfDaysIfDA, 10);
  if (!Number.isFinite(tenor) || tenor <= 0) return waiting(rule, STEP11_PENDING_REASON.DA_TENOR, head);
  // No B/L date is recorded anywhere yet. The SOB ETD is the closest real date
  // we hold and is usually within a day or two of the B/L.
  const usingStandIn = !anchors.blDate;
  const base = anchors.blDate || anchors.sob.value;
  if (!parseDT(base)) {
    return waiting(rule, STEP11_PENDING_REASON.DA_BASE, [...head, line('DA days', tenor)]);
  }
  const due = shiftCalendarDays(base, tenor);
  const planned = shiftCalendarDays(due, -CHASE_LEAD_DAYS);
  return settled(planned, rule, [
    ...head,
    usingStandIn
      ? line('B/L date', base, 'SOB ETD standing in — no B/L date is recorded in the CRM yet')
      : line('B/L date', base),
    line('DA days', tenor),
    line('Payment due', iso(due)),
    line(`Minus ${CHASE_LEAD_DAYS} calendar days`, iso(planned)),
  ], { isProvisional: usingStandIn, notBefore: anchors.sob.value });
};

const cadLcRule = (arrival, head, anchors) => {
  const rule = `Arrival − ${CHASE_LEAD_DAYS} calendar days`;
  if (!arrival.value) return waiting(rule, STEP11_PENDING_REASON.ARRIVAL, head);
  const d = shiftCalendarDays(arrival.value, -CHASE_LEAD_DAYS);
  return settled(d, rule, [
    ...head,
    line('Arrival', arrival.value, arrival.source),
    line(`Minus ${CHASE_LEAD_DAYS} calendar days`, iso(d)),
  ], { notBefore: anchors.sob.value });
};

// Split and free-text terms keep the rule they have always had. They are a few
// dozen live orders that no automatic chase should touch, and silently blanking
// their deadline would be a regression, not a fix.
const legacyRule = (arrival, head) => {
  const rule = `Arrival − ${LEGACY_LEAD_WORKING_DAYS} working days — these terms have no automatic rule`;
  if (!arrival.value) return waiting(rule, STEP11_PENDING_REASON.ARRIVAL, head);
  const d = subtractWorkingDays(parseDT(arrival.value), LEGACY_LEAD_WORKING_DAYS);
  return settled(d, rule, [
    ...head,
    line('Arrival', arrival.value, arrival.source),
    line(`Minus ${LEGACY_LEAD_WORKING_DAYS} working days`, iso(d), 'Sundays skipped'),
  ]);
};

/**
 * @param {object} input
 * @param {string} input.family          one of PAYMENT_FAMILY
 * @param {string} [input.paymentTerms]  the raw terms, shown in the explanation
 * @param {string} [input.advanceTerms]  the raw "Advance Percentage" cell, which
 *   names what an advance order's BALANCE is due against
 * @param {object} input.step11          arrivalDate, blDate
 * @param {object} input.step6           for its finalETA
 * @param {object} input.step5           for its expectedETA
 * @param {{value: string|null, source: string|null}} [input.sob]  resolveSobEtd() —
 *   the vessel sailing, which starts every chase
 * @param {string} [input.loadingAt]     Step-7 actual — container stuffing
 * @param {string} [input.dispatchAt]    Step-4 actual — dispatch
 * @param {string} [input.telexAt]       Step-13 actual — telex release
 * @param {string|number} input.noOfDaysIfDA  the DA tenor, as the sheet stores it
 * @param {boolean} [input.hasCi]        false when no Commercial Invoice exists yet
 * @param {string} [input.ciNo]          shown in the explanation
 * @returns {{plannedDateTime: string|null, pendingReason: string|null, isProvisional: boolean, explain: object}}
 */
export const step11Planned = ({
  family,
  paymentTerms,
  advanceTerms,
  step11 = {},
  step6 = {},
  step5 = {},
  sob = {},
  loadingAt,
  dispatchAt,
  telexAt,
  noOfDaysIfDA,
  hasCi,
  ciNo,
} = {}) => {
  const head = [
    line('Payment terms', paymentTerms, `read as ${PAYMENT_FAMILY_LABEL[family] || 'Manual'}`),
    line('Commercial Invoice', hasCi === false ? null : ciNo),
  ];

  // Step-11 is REQUEST PAYMENT. There is nothing to request payment against
  // until a Commercial Invoice exists — no number to quote and no amount to
  // chase — so an order without one has no deadline, whatever its terms say.
  // `undefined` means the caller does not know; only an explicit false gates.
  if (hasCi === false) {
    return waiting('No deadline until a Commercial Invoice exists', STEP11_PENDING_REASON.CI, head);
  }

  // Every chase starts when the vessel sails — the Step-8 SOB ETD. The owner
  // moved this off Step-9 (final documents shared) on 2026-09-26: the scan can
  // lag the sailing by days, and the chase lagged with it.
  if (!parseDT(sob?.value)) {
    return waiting('The chase starts when the vessel sails (Step-8 SOB ETD)', STEP11_PENDING_REASON.SOB, head);
  }
  head.push(line('SOB ETD', sob.value, sob.source));

  const anchors = {
    arrival: resolveArrival(step11, step6, step5),
    sob,
    loadingAt,
    dispatchAt,
    telexAt,
    blDate: step11.blDate,
  };

  switch (family) {
    case PAYMENT_FAMILY.ADVANCE:
      return advanceRule(advanceTerms, anchors, head);
    case PAYMENT_FAMILY.DP:
      return dpRule(anchors.arrival, head, anchors);
    case PAYMENT_FAMILY.DA:
      return daRule(noOfDaysIfDA, head, anchors);
    case PAYMENT_FAMILY.CAD_LC:
      return cadLcRule(anchors.arrival, head, anchors);
    default:
      return legacyRule(anchors.arrival, head);
  }
};
