// Sales Coordinator Scorecard (CRM origin/main app/(app)/sales-report/page.jsx, with the
// 20% client-feedback rule for the cash reward of Oct 2026: Leaderboard.jsx, RewardTag.jsx).
// Range and periodKey are built exactly as the page builds them: 'week' and
// 'month' end at now; 'today' and the previous month are the page's custom
// range (customStart T00:00:00 → customEnd T23:59:59, key custom_<start>_<end>,
// which the route accepts and, for a whole calendar month, also binds to month_YYYY-MM). The page
// does no scoring of its own: the API's order and numbers are shown as-is, and
// this shapes them into what the leaderboard row prints.
import { startOfWeek, startOfMonth, toDateInput, periodKeyFor } from './crm/lib/scoring/period.js';

/* page.jsx CATEGORIES */
export const SALES_CATEGORIES = [
  { key: 'enquiry', label: 'Enquiry', weight: 30 },
  { key: 'stability', label: 'CRM', weight: 20 },
  { key: 'tickets', label: 'Tickets', weight: 20 },
  { key: 'feedback', label: 'Client Feedback', weight: 30 },
];

const MONTH_FMT = { month: 'long', year: 'numeric' };
const DAY_FMT = { day: '2-digit', month: 'short' };

/* Periods the TV fetches every poll (the previous month is fetched too, as `previous`). */
export const SALES_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];
export const SALES_PERIOD_KEYS = SALES_PERIODS.map((p) => p.key);
export const SALES_DEFAULT_PERIOD = 'month';

const labelFor = (mode, range) => {
  if (mode === 'month') return `This Month · ${range.start.toLocaleDateString('en-IN', MONTH_FMT)}`;
  if (mode === 'week') return `This Week · from ${range.start.toLocaleDateString('en-IN', DAY_FMT)}`;
  return `${range.start.toLocaleDateString('en-IN', DAY_FMT)} – ${range.end.toLocaleDateString('en-IN', { ...DAY_FMT, year: 'numeric' })}`;
};

const withKey = (mode, range) => ({
  mode,
  start: range.start,
  end: range.end,
  periodKey: periodKeyFor(mode, range),
  label: labelFor(mode, range),
});

/** The page's custom range for two YYYY-MM-DD days. */
const customRange = (startYmd, endYmd) => withKey('custom', {
  start: new Date(`${startYmd}T00:00:00`),
  end: new Date(`${endYmd}T23:59:59`),
});

/** 'today' | 'week' | 'month' window (page.jsx range memo; today = custom today). */
export function salesRange(key = SALES_DEFAULT_PERIOD, now = new Date()) {
  if (key === 'today') {
    const today = toDateInput(now);
    return { ...customRange(today, today), label: `Today · ${now.toLocaleDateString('en-IN', DAY_FMT)}` };
  }
  if (key === 'week') return withKey('week', { start: startOfWeek(now), end: now });
  return withKey('month', { start: startOfMonth(now), end: now });
}

/** The previous full calendar month as the page's custom range (customStart/customEnd → T00:00:00 / T23:59:59). */
export function previousMonthRange(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { ...customRange(toDateInput(first), toDateInput(last)), label: `Last Month · ${first.toLocaleDateString('en-IN', MONTH_FMT)}` };
}

/** Query string the page sends to /api/sales-coordinator-report. */
export function salesQuery(range) {
  return new URLSearchParams({
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    periodKey: range.periodKey,
  }).toString();
}

function shapeCategory({ key, label, weight }, cat = {}) {
  return {
    key,
    label,
    weight: cat.weight ?? weight,
    value: cat.value ?? null,
    // CategoryCell prints "N/A" only for an Enquiry nobody has entered yet; any
    // other missing value prints "—".
    na: key === 'enquiry' && Boolean(cat.na),
    rank: cat.rank || null,
  };
}

const REWARD_BLOCKS = ['feedback', 'data'];

/** The 20% client-feedback rule for the cash reward (FeedbackRuleLine + RewardTag). The tasks
    behind it — buyer names and remarks — stay on the CRM. */
function shapeFeedbackRule(rule) {
  if (!rule || typeof rule !== 'object' || !rule.status) return null;
  const { status, obtained = 0, required = 0, due = 0, carried = 0, inProgress = false, evaluates = '', minPercent = null } = rule;
  return { status, obtained, required, due, carried, inProgress: Boolean(inProgress), evaluates, minPercent };
}

/** One leaderboard row (CoordinatorRow + BucketChips). */
function shapeCoordinator(c = {}) {
  const categories = SALES_CATEGORIES.map((meta) => shapeCategory(meta, c.categories?.[meta.key]));
  const isScored = !c.noWorkDone && c.rankScore != null;
  const buckets = c.detail?.buckets || {};
  return {
    name: c.name || c.email || '',
    email: c.email || '',
    crmNames: (c.cluster || []).filter((m) => !m.isSelf).map((m) => String(m.name || m.email || '').trim()),
    overallRank: c.overallRank ?? null,
    noWorkDone: Boolean(c.noWorkDone),
    rankScore: isScored ? c.rankScore : null,
    rankFormula: isScored ? categories.map((k) => k.rank).filter(Boolean).join(' × ') : null,
    // The page prints finalScore as "· 22.4% quality" under the rank product.
    qualityPct: isScored ? c.finalScore ?? null : null,
    reward: c.reward === 'cash' ? 'cash' : null,
    // Why a ranked coordinator gets no cash: missed the feedback rule, or the rule could not be checked.
    rewardBlockedBy: REWARD_BLOCKS.includes(c.rewardBlockedBy) ? c.rewardBlockedBy : null,
    rewardMovedUp: Boolean(c.rewardMovedUp),
    feedbackRule: shapeFeedbackRule(c.feedbackRule),
    counts: {
      done: buckets.completed || 0,
      backlog: buckets.prevPending || 0,
      pending: buckets.pendingMonth || 0,
      earlier: buckets.completedEarlier > 0 ? buckets.completedEarlier : null,
    },
    categories,
  };
}

/** API JSON + the range it was fetched for → payload.sales (one period). */
export function shapeSales(apiJson, range) {
  if (!apiJson || !Array.isArray(apiJson.coordinators)) return null;
  return {
    period: {
      mode: range.mode,
      key: range.periodKey,
      label: range.label,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    overall: apiJson.overall || { completed: 0, completedEarlier: 0, prevPending: 0, pendingMonth: 0 },
    stepSummary: Array.isArray(apiJson.stepSummary)
      ? apiJson.stepSummary.map(({ code, name, planned, completed, rate }) => ({ code, name, planned, completed, rate }))
      : [],
    coordinators: apiJson.coordinators.map(shapeCoordinator),
  };
}
