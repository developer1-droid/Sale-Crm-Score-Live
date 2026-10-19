/* A board table whose rows are keyed: rows slide to new ranks (FLIP), numbers
   count, rank-movement chips flash. Pages when there are more rows than fit
   (auto-fit) or than settings.rowsPerPage. */
import { el, isNum, restartClass } from './dom.js';
import { motionOff } from './motion.js';

const FLIP_MS = 900;
const MAX_ROW_STRETCH = 1.4;
const MOVE_CHIP_MS = 15000;

export function createRowList({ headCells, gridClass, rowClass, keyOf, buildRow }) {
  const root = el('section', 'board');
  const head = el('div', `board-head ${gridClass}`);
  headCells.forEach((h) => head.appendChild(h));
  const windowEl = el('div', 'rows-window');
  const rowsEl = el('div', 'rows');
  const foot = el('div', 'board-foot');
  const footText = el('span');
  const dots = el('div', 'pager-dots');
  foot.append(footText, dots);
  foot.hidden = true;
  windowEl.appendChild(rowsEl);
  root.append(head, windowEl, foot);

  const rows = new Map();
  const lastRank = new Map();
  let count = 0;
  let page = 0;
  let fixedPerPage = 0;

  function moveChip(row, id, rank) {
    const prev = lastRank.get(id);
    lastRank.set(id, rank);
    if (!isNum(prev) || !isNum(rank) || prev === rank) return;
    const up = rank < prev;
    row.move.dataset.dir = up ? 'up' : 'down';
    row.move.textContent = `${up ? '▲' : '▼'} ${Math.abs(prev - rank)}`;
    row.move.classList.add('is-shown');
    clearTimeout(row.moveTimer);
    row.moveTimer = setTimeout(() => row.move.classList.remove('is-shown'), MOVE_CHIP_MS);
    restartClass(row.el, 'flash');
  }

  /** `trackMoves` = false when the list changed for a non-live reason (period switch). */
  function update(items, animate, trackMoves = true) {
    const first = new Map();
    // No element.animate on very old TV browsers: rows just jump to their new place.
    const doFlip = animate && !motionOff() && typeof Element.prototype.animate === 'function';
    if (doFlip) rows.forEach((r) => first.set(r, r.el.getBoundingClientRect().top));
    const seen = new Set();
    const ordered = items.map((item) => {
      const id = keyOf(item);
      seen.add(id);
      let row = rows.get(id);
      if (!row) { row = buildRow(); row.el.className = `row ${gridClass} ${rowClass}`; rows.set(id, row); }
      row.update(item, animate);
      if (trackMoves) moveChip(row, id, item.rank); else lastRank.set(id, item.rank);
      return row;
    });
    rows.forEach((row, id) => { if (!seen.has(id)) { row.el.remove(); rows.delete(id); lastRank.delete(id); } });
    ordered.forEach((row, i) => {
      row.el.style.setProperty('--i', i);
      if (rowsEl.children[i] !== row.el) rowsEl.insertBefore(row.el, rowsEl.children[i] || null);
    });
    count = ordered.length;
    if (doFlip) {
      ordered.forEach((row) => {
        const top = first.get(row);
        if (top === undefined) return;
        const dy = top - row.el.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        row.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'cubic-bezier(.7,0,.2,1)' });
      });
    }
    layoutPage();
  }

  /* Base row height comes from CSS. Few rows stretch (capped) to fill the panel;
     many rows stretch slightly so each page shows whole rows only. */
  function geometry() {
    const any = rowsEl.firstElementChild;
    rowsEl.style.removeProperty('--row-fill');
    const baseH = any ? any.getBoundingClientRect().height : 0;
    const winH = windowEl.clientHeight;
    if (!baseH || !count || !winH) return { rowH: 0, perPage: Math.max(1, count), pages: 1 };
    const autoFit = Math.max(1, Math.floor((winH + 1) / baseH));
    const perPage = Math.min(count, fixedPerPage || autoFit);
    const fits = perPage >= count;
    foot.hidden = fits;
    const rowH = fits ? Math.min(winH / count, baseH * MAX_ROW_STRETCH) : winH / perPage;
    rowsEl.style.setProperty('--row-fill', `${rowH}px`);
    return { rowH, perPage, pages: Math.max(1, Math.ceil(count / perPage)) };
  }

  function layoutPage() {
    const { rowH, perPage, pages } = geometry();
    page = Math.min(page, pages - 1);
    const startIdx = Math.min(page * perPage, Math.max(0, count - perPage));
    rowsEl.style.transform = `translateY(${-startIdx * rowH}px)`;
    if (pages > 1) {
      const endIdx = Math.min(count, startIdx + perPage);
      footText.textContent = `Showing ${startIdx + 1}–${endIdx} of ${count}`;
      dots.replaceChildren(...Array.from({ length: pages }, (_, i) => el('span', `pager-dot${i === page ? ' is-on' : ''}`)));
    }
  }

  return {
    root,
    update,
    pages: () => geometry().pages,
    setPage(p) { page = p; layoutPage(); },
    setRowsPerPage(n) { fixedPerPage = n > 0 ? n : 0; layoutPage(); },
    relayout: layoutPage,
  };
}
