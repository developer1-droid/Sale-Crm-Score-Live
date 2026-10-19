// VERBATIM COPY of CRM lib/scoring/crmExecScore.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * crmExecScore — CRM / coordinator performance pipeline over the MIS step feed
 * (useMisSteps allSteps → role-scoped steps → per-person scorecard → ranking).
 *
 * The math lived inline in the Department Analytics page; it is lifted here so
 * the unified Scoreboard scores CRM executives with the EXACT same rules and the
 * two surfaces can never drift (DRY). This is today's weighted score: a profile
 * the rules put on the MIS engine (lib/mis/profile-engine.js) is scored by
 * lib/mis/board.js instead.
 *
 * A CRM Executive is scored on the CRM Executive Report's own steps
 * (lib/reports/deptPerformance.js scopeCrmExecutiveSteps); the Process
 * Coordinator desk on its follow-up lens (scopePcSteps), over the steps the
 * rules registry counts for it (`scoreIn`, lib/scoring/scoredIn.js).
 */

// The role buckets, not the 'use client' hook that re-exports them: this module
// is scored on the server too (Score Live's TV board), where a client module
// is a boundary, not a value.
import { ROLE } from '../team-roles.js';
import { PROFILE } from '../rules/profiles-default.js';
import { fmtDelay, ownerLabel } from '../reports/misFormat.js';
import { rankCohort } from './winnerScore.js';
import { isScoredIn } from './scoredIn.js';
import { scopeCrmExecutiveSteps, inPeriod, isBeforeCutoff, isLate } from '../reports/deptPerformance.js';
import { collapseCiSiblings } from '../so-fms-step-feed.js';
import { isLegacyDesignStep } from '../reports/misScope.js';
import { dutyPeople } from '../rules/duties.js';
import { DUTY } from '../rules/owners-default.js';

/** The scorecard's row for steps nobody owns; never ranked. */
const UNASSIGNED = 'Unassigned';

/** Group role-scoped steps into one scorecard row per owner. */
export function buildRoleScorecard(steps) {
  const m = new Map();
  steps.forEach((s) => {
    const o = s.owner || UNASSIGNED;
    if (!m.has(o)) {
      m.set(o, {
        owner: o, label: s.ownerName || ownerLabel(o), role: s.tab,
        total: 0, done: 0, overdue: 0, onTime: 0, lateCount: 0, delayMin: 0, bySrc: {},
      });
    }
    const r = m.get(o);
    r.total++;
    r.bySrc[s.source] = (r.bySrc[s.source] || 0) + 1;
    if (s.status === 'DONE') { r.done++; if (s.onTime) r.onTime++; }
    if (s.status === 'OVERDUE') r.overdue++;
    // A held step's frozen delay and an on-time step inside its grace band are not lateness.
    if (isLate(s)) { r.lateCount++; r.delayMin += s.delayMin; }
  });
  return [...m.values()].map((r) => ({
    ...r,
    active: r.total - r.done,
    onTimePct: r.done ? Math.round((r.onTime / r.done) * 100) : null,
    avgDelayH: r.lateCount ? r.delayMin / r.lateCount / 60 : 0,
    avgDelayLabel: r.lateCount ? fmtDelay(r.delayMin / r.lateCount) : '—',
  }));
}

/* CRM-cohort scoring tune (see winnerScore rankCohort options). Fixes the
   "did little, ranked #1" bug: a thin sample of perfectly-on-time steps used to
   win because timeliness was 70% of the score and gave full credit on 1–2 tasks.
     • 60/40 — raw output counts for more, so a busy desk isn't beaten on volume.
     • K=6   — regress timeliness toward the cohort mean until ~6 steps are done;
               a lucky short run no longer reads as a flawless record.
     • min 3 — under 3 delivered steps → shown as UNRANKED, not crowned. */
export const CRM_WEIGHTS = { timeliness: 0.6, volume: 0.4 };
export const CRM_SHRINKAGE_K = 6;
export const CRM_MIN_DELIVERED = 3;

/** Rank a role scorecard (overload penalty OFF — doing more work is never punished). */
export function rankRole(scorecard) {
  const people = scorecard.filter((r) => r.owner !== UNASSIGNED);
  return rankCohort(people, {
    overload: false,
    weights: CRM_WEIGHTS,
    shrinkageK: CRM_SHRINKAGE_K,
    minDelivered: CRM_MIN_DELIVERED,
  });
}

/**
 * The CRM Executive cohort inside a period, scored on exactly what the CRM
 * Executive Report shows — every planned step they own, with open work carried
 * forward — so the Scoreboard's score and the report it links to are one number.
 * @returns {{ scorecard: object[], ranking: object }}
 */
export function scoreRole(allSteps, { designationOf, identityOf, nameOf, rules = null, range }) {
  const cohort = inPeriod(scopeCrmExecutiveSteps(allSteps, { designationOf, identityOf, nameOf, rules }), {
    start: range?.start || new Date(0), end: range?.end || new Date(8.64e15),
  });
  const scorecard = buildRoleScorecard(cohort.map((s) => ({ ...s, tab: ROLE.CRM })));
  return { scorecard, ranking: rankRole(scorecard) };
}

/* The ops desk has no per-step owner field, so its two responsibilities come
   from the registry's duty list (decision 12, edited in Settings > Report Rules):
     • SO-0 "Order Scheduled" → the order scheduling duty (Sakshi Garg today) —
       her ONLY job, already the raw owner in the feed
     • EVERY OTHER step, in EVERY department (SO-1..SO-14, Design Approval,
       CRM FMS, Tickets) → the follow-up coordinator duty (Janki Singh today),
       who chases the whole business to keep it on time; each step's
       plan-vs-actual delay is her delay. */

/** The follow-up coordinator: the first person the rules put on the follow-up duty — today's without rules; null while nobody is on it. */
export const followUpCoordinatorOf = (rules) => dutyPeople(rules, DUTY.FOLLOW_UP_COORDINATOR)[0] || null;

/** Today's follow-up coordinator, the default rules' (lib/rules/owners-default.js). */
export const FOLLOWUP_COORDINATOR = followUpCoordinatorOf(null);

/**
 * Bucket the WHOLE MIS feed into the ops-desk universe with ops ownership
 * applied, crediting each step to EXACTLY ONE owner (see the block comment
 * above): SO-0 → order scheduling, everything else → the follow-up
 * coordinator the rules name — or nobody, "Unassigned", while that duty has
 * no one on it, as the MIS desk lens hands it (lib/mis/lens.js). DISTINCT
 * from the CRM / Designer cohorts, which score the SAME steps under their doer —
 * a separate lens computed independently, so this never touches their numbers.
 * No date filter here (callers window it). Shared by scorePc AND the Department
 * Analytics PC view so the two never drift. Only the steps the rules count for
 * the desk (`scoreIn` naming pcDesk) are in it: every step under the default
 * rules, all but SO-4, SO-11.5 and SO-13 under the owner's decision #9.
 */
export function scopePcSteps(allSteps, { identityOf, nameOf, rules = null }) {
  const followUp = followUpCoordinatorOf(rules);
  const out = [];
  allSteps.forEach((s) => {
    // The legacy Design board's D1/D2 are no one's score (lib/reports/misScope.js);
    // the chase list and the digest still carry them on purpose.
    if (isLegacyDesignStep(s)) return;
    if (!isScoredIn(rules, s, PROFILE.PC_DESK)) return;
    // Each step's own cutoff, as the rules draw it (lib/reports/deptPerformance.js
    // isBeforeCutoff): an order from before it is out by its PI's approval date,
    // whatever its steps' plans, and an older PI the CRM FMS board still shows is
    // not scored.
    if (isBeforeCutoff(s, rules)) return;

    let ownerKey, ownerName;
    if (s.tab === 'SO FMS' && s.stepCode === 'SO-0') {
      // Order scheduling — the duty's person, already the raw owner in the feed.
      ownerKey = identityOf(s.owner) || s.owner || UNASSIGNED;
      ownerName = nameOf(s.owner) || ownerLabel(ownerKey);
    } else if (followUp) {
      // Every other step, any department, is the follow-up coordinator's to chase.
      ownerKey = followUp.email;
      ownerName = nameOf(followUp.email) || followUp.name;
    } else {
      ownerKey = UNASSIGNED;
      ownerName = ownerLabel(UNASSIGNED);
    }
    out.push({ ...s, owner: ownerKey, ownerName, source: s.tab, tab: ROLE.PC });
  });
  return collapseCiSiblings(out);
}

export function scorePc(allSteps, { identityOf, nameOf, range, rules = null }) {
  const out = scopePcSteps(allSteps, { identityOf, nameOf, rules });
  // In-period activity (done / late / upcoming inside the window) PLUS every
  // still-open OVERDUE item, whatever its plan date — the "previous pending"
  // work a coordinator still owes carries forward instead of vanishing the
  // moment the window rolls over. Overdue is judged as-of-now (its status), so
  // a task planned before the window but never closed keeps counting against
  // this period's standing (and its delay keeps growing).
  const period = out.filter((s) => {
    if (s.status === 'OVERDUE') return true;
    const ref = s.planDate || s.actDate;
    return ref && (!range?.start || ref >= range.start) && (!range?.end || ref <= range.end);
  });
  const scorecard = buildRoleScorecard(period);
  // Unlike CRM, a coordinator buried in overdue work with nothing yet closed is
  // exactly who a manager needs to SEE (with a near-zero score) — not hidden
  // under "no activity". So holding at least one task is enough to be ranked;
  // benched now means a genuinely empty desk (zero tasks).
  const people = scorecard.filter((r) => r.owner !== UNASSIGNED);
  const ranking = rankCohort(people, { overload: false, getDelivered: (r) => (r.total || 0) > 0 });
  return { scorecard, ranking };
}
