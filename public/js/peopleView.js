/* CRM Executive walkthrough: one card per person, in rank order, after the leaderboard —
   their score and grade, what fell due (on time / late / not done), what is still pending,
   how late they run, the step they miss most and the reason they write most (the CRM MIS
   page's table and drawer, one person at a time). The rotation pages through the people
   (list.pages / list.setPage, like a long leaderboard), and onPerson(board, index) lets the
   voice read each card as it comes up. */
import { el, isNum, fmtInt, fmtPct, restartClass, medal, setMedal } from './dom.js';
import { coach, flame } from './mascot.js';

const PERCENT = 100;
const SEGMENTS = [['onTime', 'on'], ['late', 'late'], ['overdue', 'open']];
const FACTS = [
  { key: 'steps', label: 'Due', fmt: fmtInt },
  { key: 'onTime', label: 'On time', fmt: fmtInt, tone: 'good' },
  { key: 'late', label: 'Late', fmt: fmtInt, tone: 'warn' },
  { key: 'overdue', label: 'Not done', fmt: fmtInt, tone: 'bad' },
  { key: 'pending', label: 'Pending', fmt: fmtInt },
  { key: 'avgDelayLabel', label: 'Avg delay', text: true, tone: 'warn' },
];

/** The ranked people of a board, best first (the benched have no card). */
export const rankedPeopleOf = (board) => ((board && board.people) || [])
  .filter((p) => isNum(p.rank)).sort((a, b) => a.rank - b.rank);

function factBox(def) {
  const box = el('div', 'pc-fact');
  const value = el('div', 'pc-fact-value');
  box.append(el('div', 'pc-fact-label', def.label), value);
  return { def, box, value };
}

export function createPeopleView({ onPerson } = {}) {
  const root = el('div', 'view people-view');
  const card = el('section', 'person-card');

  const main = el('div', 'pc-main');
  const head = el('div', 'pc-head');
  const rank = medal();
  const place = el('span', 'pc-place');
  const ribbon = el('span', 'pc-ribbon');
  head.append(rank, place, ribbon);
  const nameRow = el('div', 'pc-name-row');
  const name = el('div', 'pc-name');
  const fire = flame('pc-flame');
  const push = coach('pc-coach', 'Push!');
  nameRow.append(name, fire, push);
  const bar = el('div', 'pc-bar');
  const legend = el('div', 'pc-legend');
  const facts = FACTS.map(factBox);
  const factRow = el('div', 'pc-facts');
  factRow.append(...facts.map((f) => f.box));
  const notes = el('div', 'pc-notes');
  const worst = el('div', 'pc-note');
  const reason = el('div', 'pc-note');
  notes.append(worst, reason);
  main.append(head, nameRow, bar, legend, factRow, notes);

  const side = el('div', 'pc-side');
  const scoreLabel = el('div', 'pc-score-label', 'Score');
  const score = el('div', 'pc-score');
  const grade = el('div', 'pc-grade');
  const scoreNote = el('div', 'pc-score-note');
  const progress = el('div', 'pc-progress');
  side.append(scoreLabel, score, grade, scoreNote, progress);

  card.append(main, side);
  const empty = el('div', 'view-empty', 'No CRM data for this period yet');
  root.append(card, empty);

  let board = null;
  let people = [];
  let page = 0;

  function paintBar(p) {
    const due = (p.onTime || 0) + (p.late || 0) + (p.overdue || 0);
    bar.replaceChildren(...SEGMENTS.map(([key, cls]) => {
      const seg = el('i', `pc-seg ${cls}`);
      seg.style.width = `${due > 0 ? ((p[key] || 0) / due) * PERCENT : 0}%`;
      return seg;
    }));
    legend.replaceChildren(
      el('span', 'pc-key on', `${fmtInt(p.onTime || 0)} on time`),
      el('span', 'pc-key late', `${fmtInt(p.late || 0)} late`),
      el('span', 'pc-key open', `${fmtInt(p.overdue || 0)} not done`),
    );
  }

  function paint(index) {
    const p = people[index];
    if (!p) return;
    const isTop = p.rank === 1;
    const isRunnerUp = p.rank === 2;
    const isLast = people.length > 2 && index === people.length - 1;
    card.classList.toggle('is-top', isTop);
    card.classList.toggle('is-runner-up', isRunnerUp);
    card.classList.toggle('is-last', isLast);
    setMedal(rank, p.rank);
    place.textContent = isTop ? 'No. 1 · on fire' : isLast ? `No. ${p.rank} · last` : `No. ${p.rank} of ${people.length}`;
    ribbon.textContent = isTop ? 'Top performer' : isRunnerUp ? 'Runner-up' : isLast ? 'Needs a push' : '';
    ribbon.hidden = !ribbon.textContent;
    name.textContent = p.name || '—';
    fire.hidden = !isTop;
    push.hidden = !isLast;
    paintBar(p);
    facts.forEach(({ def, value }) => {
      const v = p[def.key];
      const has = def.text ? Boolean(v) : isNum(v);
      value.textContent = has ? (def.text ? v : def.fmt(v)) : '—';
      value.className = `pc-fact-value${has && def.tone && (def.text || v > 0) ? ` tone-${def.tone}` : ''}`;
    });
    worst.textContent = p.worstStep
      ? `Misses most: ${p.worstStep.code}${p.worstStep.label && p.worstStep.label !== p.worstStep.code ? ` ${p.worstStep.label}` : ''} · ${p.worstStep.missed} of ${p.worstStep.planned} missed`
      : 'Nothing missed this period';
    worst.dataset.tone = p.worstStep ? 'bad' : 'good';
    reason.textContent = p.topReason ? `Delay reason given most: ${p.topReason.reason === 'No reason given' ? 'no reason given' : `“${p.topReason.reason}”`}` : '';
    reason.hidden = !p.topReason;
    score.textContent = p.scoreText || (isNum(p.score) ? fmtInt(p.score) : '—');
    score.dataset.band = p.scoreTone || '';
    grade.textContent = p.grade ? `Grade ${p.grade}` : '';
    grade.dataset.band = p.scoreTone || '';
    grade.hidden = !p.grade;
    scoreNote.textContent = [isNum(p.onTimePct) ? `${fmtPct(p.onTimePct)} on time` : '', p.scoreText ? '0% is best' : ''].filter(Boolean).join(' · ');
    progress.replaceChildren(...people.map((_, i) => el('span', `pc-dot${i === index ? ' is-on' : ''}`)));
  }

  function show(index, { voice }) {
    page = Math.max(0, Math.min(index, people.length - 1));
    paint(page);
    restartClass(card, 'is-in');
    if (voice && onPerson) onPerson(board, page);
  }

  return {
    root,
    list: {
      pages: () => Math.max(1, people.length),
      page: () => page,
      setPage(p) {
        // The rotation wraps to 0 as it leaves the board: that is no new card to read out.
        const isWrap = p === 0 && page === people.length - 1 && people.length > 1;
        show(p, { voice: !isWrap });
      },
      setRowsPerPage() {},
      relayout() {},
    },
    /** board = one period's CRM board, or null. A data refresh repaints the card on screen, silently. */
    update(nextBoard) {
      board = nextBoard;
      people = rankedPeopleOf(board);
      root.classList.toggle('is-empty', !people.length);
      if (people.length) paint(Math.min(page, people.length - 1));
    },
  };
}
