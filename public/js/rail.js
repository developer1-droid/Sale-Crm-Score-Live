/* Footer rail: one segment per board in rotation order, the current one filling over its dwell. */
import { el } from './dom.js';

export function createRail(list) {
  let sig = '';

  function render(views) {
    const nextSig = views.map((v) => v.id).join();
    if (nextSig === sig) return;
    sig = nextSig;
    list.replaceChildren(...views.map((v) => {
      const li = el('li', 'seg');
      li.dataset.kind = v.kind;
      li.dataset.id = v.id;
      const track = el('div', 'seg-track');
      track.appendChild(el('div', 'seg-fill'));
      li.append(el('div', 'seg-label', v.rail), track);
      return li;
    }));
  }

  /** ms = how long the current board stays; null = paused / single board. */
  function mark(currentId, ms) {
    const items = Array.from(list.children);
    const idx = items.findIndex((li) => li.dataset.id === currentId);
    items.forEach((li, i) => {
      li.classList.toggle('is-on', i === idx);
      li.classList.toggle('is-done', i < idx);
      const fill = li.firstElementChild.nextElementSibling.firstElementChild;
      fill.style.transition = 'none';
      fill.style.transform = i < idx ? 'scaleX(1)' : 'scaleX(0)';
      if (i !== idx) return;
      void fill.offsetWidth;
      if (ms === null) { fill.style.transform = 'scaleX(1)'; fill.style.opacity = '.35'; return; }
      fill.style.opacity = '';
      fill.style.transition = `transform ${ms}ms linear`;
      fill.style.transform = 'scaleX(1)';
    });
  }

  return { render, mark };
}
