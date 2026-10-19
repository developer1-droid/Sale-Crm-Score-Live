// Prints the CRM board (every period, or CRM_PERIODS=this-week,last-month) and the Sales board from saved CRM responses.
//   node engine/selftest.mjs                 → engine/sample/ (sanitized, clock pinned to sample/meta.json)
//   LIVE_DIR=<dir> node engine/selftest.mjs  → files saved by tools/fetch-crm.mjs, clock = now (or NOW=<iso>)
// Files: feed (GET /api/step-feed) team cutoffs advancePending balancePending
//        salesCurrent salesPrevious [salesToday salesWeek] (.json)
//        [rules] (GET /api/rules/resolved) — without it, the CRM's default rules as
//        that route serves them; RULES=decided lays the owner's decisions over them
//        [frozen-*.json] (GET /api/mis/periods) — closed weeks / months as the CRM froze them
//        CUSTOM=2026-10-01,2026-10-15 adds the custom period
process.env.TZ = 'Asia/Kolkata';

const { readFileSync, existsSync, readdirSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { dirname, join } = await import('node:path');
const { computeCrmMisBoards, salesRange, previousMonthRange, shapeSales } = await import('./index.js');

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.env.LIVE_DIR || join(here, 'sample');
const load = (name) => {
  const file = join(dir, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};
const meta = load('meta');
const now = new Date(process.env.NOW || meta?.now || Date.now());

const raw = Object.fromEntries(['feed', 'team', 'cutoffs', 'rules', 'advancePending', 'balancePending'].map((name) => [name, load(name)]));
const isDecided = process.env.RULES === 'decided';
const rulesSource = raw.rules ? join(dir, 'rules.json') : `the CRM's default rules${isDecided ? " with the owner's decisions" : ''} (no rules.json saved)`;
if (!raw.rules) {
  const [{ DEFAULT_RULES }, { withOwnerDecisions }, { publicRules }] = await Promise.all([
    import('./crm/lib/rules/defaults.js'), import('./crm/lib/rules/decisions-2026-10-10.js'), import('./crm/lib/rules-public.js'),
  ]);
  raw.rules = { success: true, ...publicRules(isDecided ? withOwnerDecisions(DEFAULT_RULES) : DEFAULT_RULES) };
}
// Saved frozen records, keyed as the CRM keys them (from_to).
raw.frozen = Object.fromEntries(readdirSync(dir).filter((name) => /^frozen.*.json$/.test(name))
  .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8'))?.records?.crmExec)
  .filter(Boolean).map((record) => [record.periodKey, record]));
const [customFrom, customTo] = (process.env.CUSTOM || '').split(',');
const boards = computeCrmMisBoards(raw, { now, custom: customFrom && customTo ? { from: customFrom, to: customTo } : null });
const only = process.env.CRM_PERIODS ? process.env.CRM_PERIODS.split(',') : null;

const dash = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);
const cell = (v, w, suffix) => dash(v, suffix).padStart(w);

const printCrm = (crm) => {
  const s = crm.summary;
  console.log(`
CRM · ${crm.title} · ${crm.period.label} · ${crm.period.dates}${crm.period.frozenAt ? ` · frozen ${crm.period.frozenAt}` : ''}${crm.period.frozenMissing ? ' · frozen record missing: live' : ''}`);
  console.log(`  SCORE ${s.scoreText} ${s.grade} (${s.overdue + s.lateDone} of ${s.steps} not on time)`);
  console.log(`  ON-TIME ${dash(s.onTimePct, '%')} (${s.onTimeDone} ÷ ${s.doneTotal} done) · STEPS ${s.steps} (${s.doneTotal} done) · LATE DONE ${s.lateDone}`
    + ` · OVERDUE ${s.overdue} · PENDING ${s.pending} (${s.overdue} overdue + ${s.openInTime} open${s.onHold ? ` (${s.onHold} on hold)` : ''})`
    + ` · AVG DELAY ${dash(s.avgDelayLabel)}`);
  console.log(`  SIGNED PI DUE ${s.signedPiDue} · ADVANCE DUE ${s.advanceDue} (${dash(s.advanceDueAmountLabel)}) · BALANCE DUE ${s.balanceDue} (${dash(s.balanceDueAmountLabel)})`);
  console.log('   #  Person            Score Steps On-time Late Overdue Pending  Avg delay  SignedPI Adv Bal');
  const scoreOf = (p) => (p.scoreText ? `${p.scoreText} ${p.grade}`.padStart(5) : cell(p.score, 5));
  crm.people.forEach((p) => console.log(`  ${cell(p.rank, 2)}  ${p.name.padEnd(17)} ${scoreOf(p)} ${cell(p.steps, 5)} ${cell(p.onTimePct, 7, '%')}`
    + ` ${cell(p.late, 4)} ${cell(p.overdue, 7)} ${cell(p.pending, 7)} ${cell(p.avgDelayLabel, 10)} ${cell(p.signedPi, 9)} ${cell(p.advance, 3)} ${cell(p.balance, 3)}`
    + `  worst ${p.worstStep ? `${p.worstStep.code} ${p.worstStep.missed}/${p.worstStep.planned}` : '—'} · ${p.topReason ? p.topReason.reason.slice(0, 30) : '—'}`));
};

console.log(`data ${dir}
rules ${rulesSource} · CRM board on the ${boards.engine} score
now  ${now.toISOString()} (TZ ${process.env.TZ})
feed ${raw.feed?.items?.length ?? 0} items, built ${raw.feed?.builtAt ?? '—'}${raw.feed?.warnings?.length ? `, warnings: ${raw.feed.warnings.map((w) => `${w.source}: ${w.message}`).join('; ')}` : ''}`);
boards.periods.filter((p) => !only || only.includes(p.key)).forEach((p) => {
  if (boards.byPeriod[p.key]) printCrm(boards.byPeriod[p.key]);
});
boards.failed.forEach((f) => console.log(`
CRM ${f.key} FAILED: ${f.error}`));

const printSales = (title, sales) => {
  if (!sales) { console.log(`\n${title}: no data`); return; }
  console.log(`\n${title} · ${sales.period.label} · ${sales.period.key}`);
  sales.coordinators.forEach((c) => {
    const n = c.counts;
    const cats = c.categories.map((k) => `${k.label} ${k.na ? 'N/A' : dash(k.value, '%')}${k.rank ? ` #${k.rank}` : ''}`).join(' · ');
    const score = c.rankScore == null ? '—' : `${c.rankScore} (${c.rankFormula} · ${c.qualityPct}% quality)`;
    console.log(`  ${cell(c.overallRank, 2)} ${c.name} (CRM: ${c.crmNames.join(', ') || '—'}) ${n.done} done/${n.backlog} backlog/${n.pending} pending`
      + `${n.earlier ? `/+${n.earlier} earlier` : ''} · ${cats} · Score ${score} · ${c.reward === 'cash' ? 'Cash' : '—'}`);
  });
};
const sales = shapeSales(load('salesCurrent'), salesRange('month', now));
printSales('SALES (today)', shapeSales(load('salesToday'), salesRange('today', now)));
printSales('SALES (this week)', shapeSales(load('salesWeek'), salesRange('week', now)));
printSales('SALES (this month)', sales);
printSales('SALES (previous month)', shapeSales(load('salesPrevious'), previousMonthRange(now)));

const problems = [];
const weekly = boards.byPeriod['this-week'];
if (!raw.feed?.items?.length) problems.push('empty step feed');
if (boards.failed.length) problems.push(`CRM periods failed: ${boards.failed.map((f) => f.key).join(', ')}`);
if (!weekly?.people.length) problems.push('empty CRM people table');
if (!weekly?.people.some((p) => p.rank != null)) problems.push('nobody ranked on the CRM board');
if (!sales?.coordinators.length) problems.push('empty sales coordinators');
if (problems.length) {
  console.error(`\nSELFTEST FAILED: ${problems.join(', ')}`);
  process.exit(1);
}
console.log('\nSELFTEST OK');
