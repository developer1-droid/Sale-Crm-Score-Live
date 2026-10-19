/* Demo mode only: random drift so the count-ups, row moves and rank chips can be seen. */
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function driftCrm(board) {
  const scored = (board.people || []).filter((p) => isNum(p.score));
  if (!scored.length) return;
  const p = scored[rand(0, scored.length - 1)];
  const done = rand(1, 3);
  p.steps = (p.steps || 0) + done;
  p.score = clamp(p.score + rand(-4, 9), 20, 99);
  if (isNum(p.onTimePct)) p.onTimePct = clamp(p.onTimePct + rand(-3, 4), 30, 100);
  if (isNum(p.overdue)) p.overdue = Math.max(0, p.overdue - rand(0, 2));
  const s = board.summary;
  s.steps += done;
  s.doneTotal += done;
  s.onTimeDone += rand(0, done);
  s.onTimePct = Math.round((s.onTimeDone / s.doneTotal) * 100);
  board.people.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  board.people.forEach((x, i) => { x.rank = isNum(x.score) ? i + 1 : null; });
}

function rerank(list) {
  ['stability', 'feedback', 'tickets', 'enquiry'].forEach((key) => {
    list.map((x) => x.categories.find((k) => k.key === key))
      .filter((k) => k && !k.na && isNum(k.value))
      .sort((a, b) => b.value - a.value)
      .forEach((k, i) => { k.rank = i + 1; });
  });
  list.forEach((x) => {
    const ranks = x.categories.map((k) => k.rank).filter(Boolean);
    x.rankScore = ranks.reduce((a, b) => a * b, 1);
    x.rankFormula = ranks.join(' × ');
    const scored = x.categories.filter((k) => isNum(k.value));
    x.qualityPct = Math.round((scored.reduce((a, k) => a + k.value * k.weight, 0) / 100) * 10) / 10;
  });
  list.sort((a, b) => a.rankScore - b.rankScore || b.qualityPct - a.qualityPct);
  list.forEach((x, i) => { x.overallRank = i + 1; x.reward = i < 2 ? 'cash' : null; });
}

function driftSales(sales) {
  const list = sales.coordinators || [];
  if (!list.length) return;
  const c = list[rand(0, list.length - 1)];
  const crmCat = c.categories.find((k) => k.key === 'stability');
  if (crmCat && isNum(crmCat.value)) crmCat.value = clamp(crmCat.value + rand(-6, 14), 0, 100);
  c.counts.done += rand(0, 2);
  rerank(list);
}

export function mutateMock(d) {
  const next = JSON.parse(JSON.stringify(d));
  next.updatedAt = new Date().toISOString();
  Object.values((next.crm && next.crm.byPeriod) || {}).forEach(driftCrm);
  Object.values((next.sales && next.sales.byPeriod) || {}).forEach(driftSales);
  return next;
}

/* ?rows=N pads the demo boards to N rows so paging can be seen. */
export function padMock(d, n) {
  if (!n) return d;
  const pad = (list, make) => { const base = list.length; for (let i = base; i < n; i += 1) list.push(make(list[i % base], i)); };
  Object.values((d.crm && d.crm.byPeriod) || {}).forEach((b) => pad(b.people, (p, i) => ({ ...p, id: `${p.id}-${i}`, name: `${p.name} ${i + 1}`, rank: i + 1, score: Math.max(10, (p.score || 40) - i) })));
  Object.values((d.sales && d.sales.byPeriod) || {}).forEach((s) => pad(s.coordinators, (c, i) => ({ ...c, email: `${i}-${c.email}`, name: `${c.name} ${i + 1}`, overallRank: i + 1, reward: null })));
  return d;
}
