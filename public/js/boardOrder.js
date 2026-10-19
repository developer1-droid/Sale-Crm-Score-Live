/* Settings page: the board order list. Drag-and-drop to reorder, ↑/↓ as the
   keyboard / touch fallback, plus per-board enable + dwell seconds. */
import { el } from "./dom.js";
import { BOARD_LABELS, LIMITS } from "./settingsModel.js";

const move = (list, from, to) => {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

function arrowButton(label, text, disabled, onClick) {
  const b = el("button", "icon-btn", text);
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

export function createBoardOrder(list, { onChange }) {
  let boards = [];
  let dragFrom = null;
  let focusAfter = null;

  function commit(next, focusId) {
    focusAfter = focusId || null;
    onChange(next);
  }

  function row(b, i) {
    const li = el("li", "board-row");
    li.draggable = true;
    li.dataset.id = b.id;
    li.classList.toggle("is-off", !b.enabled);

    const handle = el("span", "drag", "⋮⋮");
    handle.setAttribute("aria-hidden", "true");
    const pos = el("span", "pos", String(i + 1));

    const toggle = el("label", "board-name");
    const check = el("input");
    check.type = "checkbox";
    check.checked = b.enabled;
    check.addEventListener("change", () =>
      commit(
        boards.map((x) =>
          x.id === b.id ? { ...x, enabled: check.checked } : x,
        ),
      ),
    );
    toggle.append(check, el("span", "", BOARD_LABELS[b.id]));

    const dwell = el("label", "dwell");
    const input = el("input", "num");
    input.type = "number";
    [input.min, input.max] = LIMITS.dwell.map(String);
    input.value = String(b.dwellSec);
    input.setAttribute("aria-label", `${BOARD_LABELS[b.id]} seconds on screen`);
    input.addEventListener("change", () => {
      const v = Math.round(
        Math.min(
          LIMITS.dwell[1],
          Math.max(LIMITS.dwell[0], Number(input.value) || b.dwellSec),
        ),
      );
      commit(boards.map((x) => (x.id === b.id ? { ...x, dwellSec: v } : x)));
    });
    dwell.append(input, el("span", "unit", "sec"));

    const up = arrowButton(`Move ${BOARD_LABELS[b.id]} up`, "↑", i === 0, () =>
      commit(move(boards, i, i - 1), `up-${b.id}`),
    );
    const down = arrowButton(
      `Move ${BOARD_LABELS[b.id]} down`,
      "↓",
      i === boards.length - 1,
      () => commit(move(boards, i, i + 1), `down-${b.id}`),
    );
    up.dataset.focus = `up-${b.id}`;
    down.dataset.focus = `down-${b.id}`;
    const arrows = el("span", "arrows");
    arrows.append(up, down);

    li.append(handle, pos, toggle, dwell, arrows);
    return li;
  }

  function indexOfRow(target) {
    const li = target.closest(".board-row");
    return li ? Array.from(list.children).indexOf(li) : -1;
  }

  list.addEventListener("dragstart", (e) => {
    if (e.target.closest("input, button")) {
      e.preventDefault();
      return;
    }
    dragFrom = indexOfRow(e.target);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragFrom));
    e.target.closest(".board-row").classList.add("is-dragging");
  });
  list.addEventListener("dragover", (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    const over = indexOfRow(e.target);
    Array.from(list.children).forEach((li, i) =>
      li.classList.toggle("is-drop", i === over && over !== dragFrom),
    );
  });
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    const to = indexOfRow(e.target);
    const from = dragFrom;
    dragFrom = null;
    if (from < 0 || to < 0 || from === to) {
      render(boards);
      return;
    }
    commit(move(boards, from, to));
  });
  list.addEventListener("dragend", () => {
    dragFrom = null;
    render(boards);
  });

  function render(next) {
    boards = next;
    list.replaceChildren(...boards.map(row));
    if (!focusAfter) return;
    const target = list.querySelector(`[data-focus="${focusAfter}"]`);
    const fallback =
      target && target.disabled
        ? target.parentElement.querySelector("button:not([disabled])")
        : target;
    if (fallback) fallback.focus();
    focusAfter = null;
  }

  return { render };
}
