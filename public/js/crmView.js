/* CRM Executive board: summary strip + people table (Department Analytics page).
   A board the CRM scored on the MIS engine (board.engine === 'mis') reads the
   signed miss % with its grade, 0% best, as the Scoreboard does; its tones come
   from the CRM (the engine's own bands), never worked out here. */
import { el, isNum, fmtInt, fmtPct, band, setNumber, setText, setTone, restartClass, medal, setMedal, headCell, ON_TIME_BANDS, SCORE_BANDS } from './dom.js';
import { createRowList } from './rowList.js';
import { createInsightsView } from './insightsView.js';
import { coach, flame } from './mascot.js';

const MIS = 'mis';
const WEIGHTED = 'weighted';
const isMis = (board) => Boolean(board && board.engine === MIS);

/* The first tile: on-time % on today's board, the team's miss % and grade on the MIS engine. */
const LEAD = {
  [WEIGHTED]: { label: 'On-time', value: (s) => s.onTimePct, fmt: fmtPct, tone: (s) => (isNum(s.onTimePct) ? band(s.onTimePct, ON_TIME_BANDS) : null),
    sub: (s) => (isNum(s.onTimeDone) && isNum(s.doneTotal) ? `${fmtInt(s.onTimeDone)} ÷ ${fmtInt(s.doneTotal)} done` : '') },
  [MIS]: { label: 'Score', grade: true, text: (s) => s.scoreText, tone: (s) => s.scoreTone || null,
    sub: (s) => (isNum(s.onTimeDone) && isNum(s.steps) ? `${fmtInt(s.steps - s.onTimeDone)} of ${fmtInt(s.steps)} not on time` : '0% is best') },
};

/* The MIS engine's tiles, as the CRM MIS page's KPI cards name them (their notes shortened to fit
   nine across a TV); payments as on the weighted board. */
const STRIP_MIS = [
  { lead: true },
  { label: 'On time', value: (s) => s.onTimeDone, fmt: fmtInt, tone: () => 'good',
    sub: (s) => (isNum(s.onTimePct) ? `${fmtPct(s.onTimePct)} by the plan` : 'by the plan') },
  { label: 'Late', value: (s) => s.lateDone, fmt: fmtInt, tone: () => 'warn', sub: () => 'after the plan' },
  { label: 'Not done', value: (s) => s.overdue, fmt: fmtInt, tone: () => 'bad', sub: () => 'open past the plan' },
  { label: 'Pending now', value: (s) => s.pending, fmt: fmtInt,
    sub: (s) => `${fmtInt(s.overdue || 0)} not done + ${fmtInt(s.openInTime || 0)} carried` },
  { label: 'Avg delay', text: (s) => s.avgDelayLabel, sub: () => 'working hours late' },
];

const STRIP = [
  { lead: true },
  { label: 'Steps', value: (s) => s.steps, fmt: fmtInt, sub: (s, mis) => (isNum(s.doneTotal) ? (mis ? 'due so far' : `${fmtInt(s.doneTotal)} done`) : '') },
  { label: 'Late done', value: (s) => s.lateDone, fmt: fmtInt, tone: () => 'warn' },
  { label: 'Overdue', value: (s) => s.overdue, fmt: fmtInt, tone: () => 'bad' },
  { label: 'Pending', value: (s) => s.pending, fmt: fmtInt, sub: pendingSub },
  { label: 'Avg delay', text: (s) => s.avgDelayLabel, sub: () => 'late steps' },
  { label: 'Signed PI due', value: (s) => s.signedPiDue, fmt: fmtInt, tone: () => 'warn' },
  { label: 'Advance due', value: (s) => s.advanceDue, fmt: fmtInt, tone: () => 'bad', sub: (s) => s.advanceDueAmountLabel || '' },
  { label: 'Balance due', value: (s) => s.balanceDue, fmt: fmtInt, tone: () => 'bad', sub: (s) => s.balanceDueAmountLabel || '' },
];
STRIP_MIS.push(...STRIP.slice(STRIP_MIS.length));

function pendingSub(s, mis) {
  const open = mis ? 'carried over' : 'open';
  const parts = [isNum(s.overdue) ? `${fmtInt(s.overdue)} overdue` : null, isNum(s.openInTime) ? `${fmtInt(s.openInTime)} ${open}` : null].filter(Boolean);
  return parts.join(' + ') + (isNum(s.onHold) && s.onHold > 0 ? ` (${s.onHold} on hold)` : '');
}

const toneIfPositive = (tone) => (v) => (isNum(v) && v > 0 ? tone : null);
const COLS = [
  { key: 'steps', head: 'Steps', fmt: fmtInt, cls: 'num-strong' },
  { key: 'onTimePct', head: 'On-time', fmt: fmtPct, tone: (v) => (isNum(v) ? band(v, ON_TIME_BANDS) : null) },
  { key: 'late', head: 'Late', fmt: fmtInt, tone: toneIfPositive('warn') },
  { key: 'overdue', head: 'Overdue', fmt: fmtInt, tone: toneIfPositive('bad') },
  { key: 'pending', head: 'Pending', fmt: fmtInt },
  { key: 'avgDelayLabel', head: 'Avg delay', text: true },
  { key: 'signedPi', head: 'Signed PI', fmt: fmtInt, tone: toneIfPositive('warn') },
  { key: 'advance', head: 'Advance', fmt: fmtInt, tone: toneIfPositive('bad') },
  { key: 'balance', head: 'Balance', fmt: fmtInt, tone: toneIfPositive('bad') },
];

/* The score badge: a 0–100 number counting up, or the CRM's signed % and grade as sent. */
function paintScore(score, grade, p, animate) {
  const isPct = Boolean(p.scoreText);
  score.classList.toggle('is-pct', isPct);
  grade.hidden = !(isPct && p.grade);
  if (isPct) {
    score._num = null;
    score.dataset.band = p.scoreTone || '';
    grade.textContent = p.grade || '';
    return setText(score, p.scoreText);
  }
  score.dataset.band = isNum(p.score) ? band(p.score, SCORE_BANDS) : '';
  return setNumber(score, p.score, fmtInt, animate);
}

function buildRow() {
  const root = el('div');
  const rankCell = el('div', 'c');
  const m = medal();
  rankCell.appendChild(m);
  const nameCell = el('div', 'name-cell');
  const name = el('span', 'name');
  const fire = flame('row-flame');
  const tag = el('span', 'leader-tag', 'Top');
  const push = coach('row-coach');
  const move = el('span', 'move');
  nameCell.append(name, fire, tag, push, move);
  const scoreCell = el('div', 'c');
  const score = el('span', 'score');
  const grade = el('span', 'grade');
  grade.hidden = true;
  scoreCell.append(score, grade);
  const cells = COLS.map((col) => el('div', `r ${col.cls || ''}`));
  root.append(rankCell, nameCell, scoreCell, ...cells);
  return {
    el: root, move,
    update(p, animate) {
      setMedal(m, p.rank);
      root.classList.toggle('is-leader', p.rank === 1);
      root.classList.toggle('is-last', Boolean(p.isLast));
      tag.hidden = p.rank !== 1;
      fire.hidden = p.rank !== 1;
      push.hidden = !p.isLast;
      name.textContent = p.name || '—';
      if (paintScore(score, grade, p, animate) && animate) restartClass(scoreCell, 'flash');
      COLS.forEach((col, i) => {
        const v = p[col.key];
        const changed = col.text ? setText(cells[i], v) : setNumber(cells[i], v, col.fmt, animate);
        setTone(cells[i], v === null || v === undefined ? 'muted' : col.tone ? col.tone(v) : null);
        if (changed && animate) restartClass(cells[i], 'flash');
      });
    },
  };
}

function paintTile({ index, label, value, sub }, s, mis, animate) {
  const def = (mis ? STRIP_MIS : STRIP)[index];
  const shown = def.lead ? LEAD[mis ? MIS : WEIGHTED] : def;
  // The team's grade beside the score, as the CRM MIS page shows it ("−44.3% D").
  label.textContent = shown.grade && s.grade ? `${shown.label} · Grade ${s.grade}` : shown.label;
  if (shown.text) setText(value, shown.text(s));
  else setNumber(value, shown.value(s), shown.fmt, animate);
  const raw = shown.text ? shown.text(s) : shown.value(s);
  setTone(value, raw === null || raw === undefined ? 'muted' : shown.tone ? shown.tone(s) : null);
  sub.textContent = shown.sub ? shown.sub(s, mis) : '';
}

export function createCrmView() {
  const root = el('div', 'view');
  const strip = el('section', 'strip');
  const tiles = STRIP.map((def, i) => {
    const tile = el('div', 'tile');
    tile.style.setProperty('--i', i);
    const label = el('div', 'tile-label', def.label || LEAD[WEIGHTED].label);
    const value = el('div', 'tile-value');
    const sub = el('div', 'tile-sub');
    tile.append(label, value, sub);
    strip.appendChild(tile);
    return { index: i, label, value, sub };
  });
  const heads = [headCell('#', 'c'), headCell('Person'), headCell('Score ↓', 'c sorted'), ...COLS.map((c) => headCell(c.head, 'r'))];
  const list = createRowList({ headCells: heads, gridClass: 'crm-grid', rowClass: 'crm-row', keyOf: (p) => p.id || p.name, buildRow });
  const insights = createInsightsView();
  const empty = el('div', 'view-empty');
  root.append(strip, list.root, insights.root, empty);

  return {
    root, list,
    /** board = one period's CRM board, or null when that period has no data. */
    update(board, { animate, trackMoves, periodLabel }) {
      const hasRows = Boolean(board && (board.people || []).length);
      const mis = isMis(board);
      root.classList.toggle('is-empty', !hasRows);
      root.classList.toggle('is-mis', mis);
      empty.textContent = `No CRM data for ${periodLabel || 'this period'} yet`;
      const s = (board && board.summary) || {};
      tiles.forEach((tile) => paintTile(tile, s, mis, animate));
      // The last ranked person gets the push cartoon (only when there are more than two).
      const lastRank = Math.max(0, ...(hasRows ? board.people : []).map((p) => (isNum(p.rank) ? p.rank : 0)));
      const people = hasRows ? board.people.map((p) => ({ ...p, isLast: lastRank > 2 && p.rank === lastRank })) : [];
      list.update(people, animate, trackMoves);
      insights.update(hasRows ? board.insights : null);
    },
  };
}
