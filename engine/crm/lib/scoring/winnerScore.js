// VERBATIM COPY of CRM lib/scoring/winnerScore.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * winnerScore — the shared performance-ranking formula behind every scorecard
 * (Designers, CRM Executives, and the unified Scoreboard).
 *
 *   Score (0–100) = 70% Timeliness + 30% Volume  [− overload penalty, optional]
 *     • Timeliness = 60% on-time rate + 40% delay severity, where severity is
 *       normalized against the WORST performer in the cohort (zero delay → full
 *       marks). Shipping on time is what wins — raw output alone does not.
 *     • Volume     = work done ÷ the busiest performer in the cohort.
 *
 * The 70/30 split and full-credit timeliness are the DEFAULT; a caller can tune
 * both via options (see rankCohort) without forking the math:
 *     • `weights`      — override the timeliness/volume split (e.g. CRM 60/40, so
 *                        raw output counts for more against a busy desk).
 *     • `shrinkageK`   — low-sample confidence discount: regress each person's
 *                        timeliness TOWARD the cohort mean by K "phantom" tasks
 *                        (empirical Bayes). A 2-task 100% run stops outranking a
 *                        60-task grind on a lucky sample; a real track record is
 *                        barely moved. Off (0) → full credit, as before.
 *     • `minDelivered` — a person must have delivered at least this many items to
 *                        be RANKED; below the bar they are benched as "unranked"
 *                        rather than crowned on 1–2 tasks. Off (0) → old rule.
 *
 * Extracted here so the reports share ONE implementation — fix the math once and
 * every surface agrees (DRY, the same reason useMisSteps was extracted). Callers
 * pass field accessors so a cohort row keeps its own field names (designers use
 * `completed`/`avgLateH`, CRM steps use `done`/`avgDelayH`).
 */

export const WINNER_WEIGHTS = { timeliness: 0.7, volume: 0.3 };
export const TIMELINESS_WEIGHTS = { onTime: 0.6, delay: 0.4 };

/* Overload penalty (designers only): docks someone who took on MORE than the
   team-average load AND delivered MORE late than average — hoarding a backlog
   and shipping it late costs turnaround; that work should have been delegated. */
export const OVERLOAD_PENALTY_CAP = 25;
export const OVERLOAD_LOAD_WEIGHT = 1;   // penalty points per task above the team-average load
export const OVERLOAD_LATE_WEIGHT = 1.2; // penalty points per late task above the team average

const DEFAULT_ACCESSORS = {
  getDone: (r) => r.done || 0, // volume numerator
  getOnTimePct: (r) => r.onTimePct, // 0–100, or null when nothing was submitted
  getDelayH: (r) => r.avgDelayH || 0, // average late hours per late item
  getTotal: (r) => r.total || 0, // for the overload check
  getLate: (r) => r.late || 0, // for the overload check
  getDelivered: (r) => (r.done || 0) > 0, // has this person shipped anything?
};

/**
 * Rank a cohort of people. Each ORIGINAL row is returned enriched with
 * { score, timeliness, volume, onTimeScore, delayScore, base, hasDelivered,
 *   overloaded, overloadPenalty }, split into ranked (delivered, desc by score)
 * and benched (nothing delivered yet), plus cohort `meta`.
 *
 * @param {Array<object>} people
 * @param {{ overload?: boolean, weights?: {timeliness:number,volume:number},
 *           shrinkageK?: number, minDelivered?: number }
 *          & Partial<typeof DEFAULT_ACCESSORS>} options
 */
export function rankCohort(people, options = {}) {
  const {
    overload = false,
    weights = WINNER_WEIGHTS,
    shrinkageK = 0, // >0 → regress timeliness toward the cohort mean for thin samples
    minDelivered = 0, // >0 → require this many delivered items to be ranked (else benched)
    ...overrides
  } = options;
  const acc = { ...DEFAULT_ACCESSORS, ...overrides };
  const empty = {
    ranked: [], benched: [], overloaded: [], winner: null,
    meta: { maxDone: 1, worstAvgDelayH: 0, avgTotal: 0, avgLate: 0, meanTimeliness: 0 },
  };
  if (!people || people.length === 0) return empty;

  const maxDone = Math.max(...people.map(acc.getDone), 1);
  const worstAvgDelayH = Math.max(...people.map(acc.getDelayH), 0);
  const avgTotal = people.reduce((s, r) => s + acc.getTotal(r), 0) / people.length;
  const avgLate = people.reduce((s, r) => s + acc.getLate(r), 0) / people.length;

  /* Raw (un-shrunk) timeliness + volume per person. Computed first so the
     shrink target — the mean timeliness of people who actually delivered — is
     known before any single person's number is regressed toward it. */
  const prelim = people.map((r) => {
    const onTimePct = acc.getOnTimePct(r);
    const onTimeScore = onTimePct == null ? 0 : onTimePct;
    const delaySeverity = worstAvgDelayH > 0 ? (acc.getDelayH(r) / worstAvgDelayH) * 100 : 0;
    const delayScore = 100 - delaySeverity; // zero delay → full marks
    const rawTimeliness = TIMELINESS_WEIGHTS.onTime * onTimeScore + TIMELINESS_WEIGHTS.delay * delayScore;
    const volume = (acc.getDone(r) / maxDone) * 100;
    return { r, onTimeScore, delayScore, rawTimeliness, volume };
  });

  /* Prior a thin sample regresses toward: the average timeliness of people with
     a real track record (delivered work). Zero-delivery rows carry no signal, so
     they don't drag the prior down. */
  const delivered = prelim.filter((p) => acc.getDelivered(p.r));
  const meanTimeliness = delivered.length
    ? delivered.reduce((s, p) => s + p.rawTimeliness, 0) / delivered.length
    : 0;

  const scored = prelim.map(({ r, onTimeScore, delayScore, rawTimeliness, volume }) => {
    const done = acc.getDone(r);
    // Low-sample confidence discount (empirical Bayes): (n·raw + K·mean)/(n+K).
    // Few completed tasks → pulled toward the cohort mean; a fat sample barely
    // moves. K=0 leaves timeliness at full credit, as the report always did.
    const timeliness = shrinkageK > 0
      ? (done * rawTimeliness + shrinkageK * meanTimeliness) / (done + shrinkageK)
      : rawTimeliness;
    const volumeScore = weights.volume * volume;
    const base = weights.timeliness * timeliness + volumeScore;

    const isOverloaded = overload && acc.getTotal(r) > avgTotal && acc.getLate(r) > avgLate;
    const overloadPenalty = isOverloaded
      ? Math.min(
          OVERLOAD_PENALTY_CAP,
          Math.round(
            (acc.getTotal(r) - avgTotal) * OVERLOAD_LOAD_WEIGHT +
            (acc.getLate(r) - avgLate) * OVERLOAD_LATE_WEIGHT,
          ),
        )
      : 0;
    const score = Math.max(0, Math.round(base - overloadPenalty));

    // Ranked only if they delivered AND cleared the minimum-volume bar; a thin
    // sample is shown as unranked rather than crowned on 1–2 lucky tasks.
    const hasDelivered = acc.getDelivered(r) && (minDelivered <= 0 || done >= minDelivered);

    return {
      ...r, hasDelivered, overloaded: isOverloaded, overloadPenalty,
      score, onTimeScore, delayScore, timeliness, volume, base,
    };
  });

  const ranked = scored.filter((r) => r.hasDelivered).sort((a, b) => b.score - a.score);
  const benched = scored.filter((r) => !r.hasDelivered);
  const overloadedList = scored
    .filter((r) => r.overloaded)
    .sort((a, b) => acc.getTotal(b) - acc.getTotal(a));

  return {
    ranked, benched, overloaded: overloadedList, winner: ranked[0] || null,
    meta: { maxDone, worstAvgDelayH, avgTotal, avgLate, meanTimeliness },
  };
}
