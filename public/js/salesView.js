/* Sales Coordinator board (Sales Report page leaderboard). */
import { el, isNum, fmtInt, fmtPct, fmtDec, setNumber, restartClass, medal, setMedal, headCell, REWARD_CASH } from './dom.js';
import { createRowList } from './rowList.js';

const CATS = [
  { key: 'enquiry', label: 'Enquiry', weight: 30 },
  { key: 'stability', label: 'CRM', weight: 20 },
  { key: 'tickets', label: 'Tickets', weight: 20 },
  { key: 'feedback', label: 'Client Feedback', weight: 30 },
];

export const coordPartners = (c) => (Array.isArray(c.crmNames) ? c.crmNames : []);
export const coordQuality = (c) => (isNum(c.qualityPct) ? c.qualityPct : null);
export const coordFormula = (c) => c.rankFormula || (c.categories || []).map((k) => k.rank).filter(Boolean).join(' × ');
export const catByKey = (c, key) => (c.categories || []).find((k) => k.key === key) || null;
export const byOverallRank = (list) => (list || []).slice().sort((a, b) => (a.overallRank ?? 999) - (b.overallRank ?? 999));

function chip(cls, value, label) {
  const node = el('span', `chip ${cls}`);
  if (value !== undefined) node.appendChild(el('b', '', value));
  node.appendChild(document.createTextNode(label));
  return node;
}

function countChips(n) {
  if (!n) return [];
  const out = [
    chip('chip-done', n.done, 'done'),
    chip(n.backlog > 0 ? 'chip-backlog' : 'chip-zero', n.backlog, 'backlog'),
    chip(n.pending > 0 ? 'chip-pending' : 'chip-zero', n.pending, 'pending'),
  ];
  if (n.earlier > 0) out.push(chip('chip-earlier', undefined, `+${n.earlier} earlier`));
  return out;
}

function updateCategory(cell, cat, animate) {
  if (cat && cat.na) { cell.replaceChildren(el('span', 'na', 'N/A')); return; }
  if (!cat || !isNum(cat.value)) { cell.replaceChildren(el('span', 'cat-dash', '—')); return; }
  let wrap = cell.firstElementChild;
  if (!wrap || !wrap.classList.contains('cat')) {
    wrap = el('span', 'cat');
    wrap.append(el('span', 'cat-val'), el('span', 'rank-badge'));
    cell.replaceChildren(wrap);
  }
  const [val, badge] = wrap.children;
  if (setNumber(val, cat.value, fmtPct, animate) && animate) restartClass(cell, 'flash');
  badge.hidden = !isNum(cat.rank);
  badge.dataset.rank = isNum(cat.rank) ? String(cat.rank) : '';
  badge.textContent = isNum(cat.rank) ? String(cat.rank) : '';
}

/* The 20% client-feedback rule under the Client Feedback score: "got 8 · need 3" (FeedbackRuleLine). */
const RULE_TEXT = { none: () => 'no feedback due', unavailable: () => 'rule not checked' };
function setRuleLine(cell, rule) {
  let line = cell.querySelector('.rule-line');
  if (!rule) {
    if (line) line.remove();
    return;
  }
  if (!line) line = el('div', 'rule-line');
  line.dataset.status = rule.status;
  line.textContent = RULE_TEXT[rule.status] ? RULE_TEXT[rule.status]() : `got ${rule.obtained} · need ${rule.required}`;
  // updateCategory may have replaced the cell's children: keep the line last.
  if (line.parentNode !== cell || line !== cell.lastChild) cell.appendChild(line);
}

/* Cash, "Not eligible" (missed the feedback minimum: the cash moved down), "On hold" (rule not checked), or — (RewardTag). */
function rewardNodes(c) {
  if (c.reward === REWARD_CASH) return [el('span', 'reward-cash', 'Cash')];
  const rule = c.feedbackRule || {};
  if (c.rewardBlockedBy === 'data') return [el('span', 'reward-hold', 'On hold')];
  if (c.rewardBlockedBy === 'feedback') {
    return [el('span', 'reward-blocked', 'Not eligible'),
      el('div', 'reward-note', `feedback ${rule.obtained || 0}/${rule.required || 0}${rule.inProgress ? ' so far' : ''}`)];
  }
  return [el('span', 'reward-none', '—')];
}

function updateScore(rankScore, formula, scoreCell, c, animate) {
  if (!isNum(c.rankScore)) {
    rankScore._num = null;
    rankScore.textContent = '—';
    formula.textContent = 'nothing to score yet';
    return;
  }
  if (setNumber(rankScore, c.rankScore, fmtInt, animate) && animate) restartClass(scoreCell, 'flash');
  const q = coordQuality(c);
  formula.textContent = [coordFormula(c), isNum(q) ? `${fmtDec(q)}% quality` : null].filter(Boolean).join(' · ');
}

function buildRow() {
  const root = el('div');
  const rankCell = el('div', 'c');
  const m = medal();
  rankCell.appendChild(m);
  const coord = el('div', 'coord');
  const top = el('div', 'coord-top');
  const name = el('span', 'name');
  const move = el('span', 'move');
  top.append(name, move);
  const team = el('div', 'chips');
  const counts = el('div', 'chips');
  coord.append(top, team, counts);
  const catCells = CATS.map(() => el('div', 'r'));
  const scoreCell = el('div', 'score-cell');
  const rankScore = el('div', 'rank-score');
  const formula = el('div', 'rank-formula');
  scoreCell.append(rankScore, formula);
  const rewardCell = el('div', 'r');
  root.append(rankCell, coord, ...catCells, scoreCell, rewardCell);
  let sig = '';
  return {
    el: root, move,
    update(c, animate) {
      setMedal(m, c.rank);
      root.classList.toggle('is-leader', c.rank === 1);
      name.textContent = c.name || c.email || '—';
      const partners = coordPartners(c);
      const nextSig = JSON.stringify([c.name, partners, c.counts]);
      if (nextSig !== sig) {
        sig = nextSig;
        team.replaceChildren(chip('chip-self', undefined, `${c.name || c.email} · self`), ...partners.map((p) => chip('chip-partner', undefined, p)));
        counts.replaceChildren(...countChips(c.counts));
      }
      CATS.forEach((def, i) => {
        updateCategory(catCells[i], catByKey(c, def.key), animate);
        if (def.key === 'feedback') setRuleLine(catCells[i], c.feedbackRule);
      });
      updateScore(rankScore, formula, scoreCell, c, animate);
      rewardCell.replaceChildren(...rewardNodes(c));
    },
  };
}

export function createSalesView() {
  const root = el('div', 'view');
  const heads = [headCell('#', 'c'), headCell('Coordinator'), ...CATS.map((c) => headCell(c.label, 'r', `${c.weight}%`)), headCell('Score ↑', 'r sorted'), headCell('Reward', 'r')];
  const list = createRowList({ headCells: heads, gridClass: 'sales-grid', rowClass: 'sales-row', keyOf: (c) => c.email || c.name, buildRow });
  const empty = el('div', 'view-empty');
  root.append(list.root, empty);
  return {
    root, list,
    update(sales, { animate, trackMoves, periodLabel }) {
      const rows = byOverallRank(sales && sales.coordinators).map((c) => ({ ...c, rank: c.overallRank }));
      root.classList.toggle('is-empty', !rows.length);
      empty.textContent = `No sales data for ${periodLabel || 'this period'} yet`;
      list.update(rows, animate, trackMoves);
    },
  };
}
