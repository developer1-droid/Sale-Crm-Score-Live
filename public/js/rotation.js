/* Which board is on screen, for how long, and how it hands over to the next.
   Order, dwell, single-board mode and transitions all come from settings. */
import { createTransitioner } from './transitions.js';
import { motionOff } from './motion.js';
import { restartClass } from './dom.js';
import { createRail } from './rail.js';

const ENTER_MS = 1800;
const ENTRANCE_STYLES = new Set(['fade', 'zoom', 'wipe']);

/**
 * views: [{ id, kind: 'board'|'spot', impl, rail, ok(), head() }]
 * getSettings(): current settings; onShow(view|null): header etc.
 */
export function createRotation({ stage, views, emptyRoot, wipe, railList, getSettings, onShow, startId, startPaused }) {
  const byId = new Map(views.map((v) => [v.id, v]));
  const transitioner = createTransitioner();
  const rail = createRail(railList);
  let currentId = null;
  let sequence = [];
  let paused = startPaused;
  let viewTimer = null;
  let pageTimer = null;
  /* While the voice reads the slides it sets the pace (voice/announcer.js): no timers then. */
  let voiceHold = false;

  views.forEach((v) => stage.appendChild(v.impl.root));
  stage.appendChild(emptyRoot);
  emptyRoot.classList.add('is-active');

  function computeSequence() {
    const s = getSettings();
    const okIds = views.filter((v) => v.ok()).map((v) => v.id);
    if (!s.rotate) return okIds.includes(s.singleBoard) ? [s.singleBoard] : okIds.slice(0, 1);
    const ordered = s.boards.filter((b) => b.enabled && okIds.includes(b.id)).map((b) => b.id);
    return ordered.length ? ordered : okIds.slice(0, 1);
  }

  function durationOf(v) {
    const s = getSettings();
    const dwellMs = ((s.boards.find((b) => b.id === v.id) || {}).dwellSec || 15) * 1000;
    if (v.kind !== 'board') return dwellMs;
    const pages = v.impl.list.pages();
    return pages > 1 ? Math.max(dwellMs, pages * s.pageDwellSec * 1000) : dwellMs;
  }

  const isHolding = () => paused || sequence.length < 2;

  function schedule(v) {
    clearTimeout(viewTimer);
    clearInterval(pageTimer);
    if (voiceHold) { rail.mark(v.id, null); return; }
    const ms = durationOf(v);
    const pages = v.kind === 'board' ? v.impl.list.pages() : 1;
    if (pages > 1 && !paused) {
      let p = 0;
      pageTimer = setInterval(() => { p = (p + 1) % pages; v.impl.list.setPage(p); }, ms / pages);
    }
    rail.mark(v.id, isHolding() ? null : ms);
    if (!isHolding()) viewTimer = setTimeout(() => step(1), ms);
  }

  function enter(v, style) {
    if (v.kind === 'spot') v.impl.replay();
    if (v.kind === 'board') {
      v.impl.list.setPage(0);
      if (!motionOff() && ENTRANCE_STYLES.has(style)) {
        restartClass(v.impl.root, 'is-entering');
        setTimeout(() => v.impl.root.classList.remove('is-entering'), ENTER_MS);
      }
    }
    schedule(v);
  }

  function go(id, { instant = false } = {}) {
    const next = byId.get(id) || null;
    const fromRoot = currentId ? byId.get(currentId).impl.root : emptyRoot;
    const toRoot = next ? next.impl.root : emptyRoot;
    const anim = getSettings().animation;
    const hadBoard = currentId !== null;
    currentId = next ? id : null;
    clearTimeout(viewTimer);
    clearInterval(pageTimer);
    if (next && anim.transition === 'wipe') {
      const h = next.head();
      wipe.querySelector('.wipe-kicker').textContent = [h.kicker, h.period].filter(Boolean).join(' · ');
      wipe.querySelector('.wipe-title').textContent = h.title;
    }
    const style = anim.transition;
    transitioner.run(fromRoot, toRoot, {
      style, speed: anim.speed, wipe,
      instant: instant || !hadBoard || motionOff(),
      onSwap: () => { onShow(next); if (next) enter(next, hadBoard ? style : 'fade'); },
    });
  }

  function step(dir) {
    if (!sequence.length) return;
    const idx = sequence.indexOf(currentId);
    const next = sequence[(idx + dir + sequence.length) % sequence.length];
    if (next === currentId) { schedule(byId.get(next)); return; }
    go(next);
  }

  /** Data or settings changed: rebuild the sequence, keep the current board if it still belongs. */
  function refresh({ reschedule = false } = {}) {
    const nextSequence = computeSequence();
    const changed = nextSequence.join() !== sequence.join();
    sequence = nextSequence;
    rail.render(sequence.map((id) => byId.get(id)));
    if (!sequence.length) { if (currentId !== null) go(null); return; }
    if (currentId === null || !sequence.includes(currentId)) {
      const first = currentId === null && sequence.includes(startId) ? startId : sequence[0];
      go(first);
      return;
    }
    const v = byId.get(currentId);
    onShow(v);
    if (changed || reschedule) schedule(v);
  }

  return {
    refresh,
    step,
    go: (id) => { if (sequence.includes(id) && id !== currentId) go(id); },
    current: () => currentId,
    isPaused: () => paused,
    togglePause() { paused = !paused; if (currentId) schedule(byId.get(currentId)); },
    relayout() { views.forEach((v) => v.impl.list && v.impl.list.relayout()); },
    /** The voice takes the timing (true) or hands it back (false): each board stays until its lines are said. */
    holdForVoice(on) {
      voiceHold = on;
      if (currentId) schedule(byId.get(currentId));
    },
    first: () => sequence[0] || null,
    /** The board step(1) would show. */
    peekNext() {
      if (!sequence.length) return null;
      return sequence[(sequence.indexOf(currentId) + 1) % sequence.length];
    },
    /** Next page (person) of the board on screen; false on its last page. */
    nextPage() {
      const v = currentId ? byId.get(currentId) : null;
      if (!v || v.kind !== 'board' || typeof v.impl.list.page !== 'function') return false;
      const next = v.impl.list.page() + 1;
      if (next >= v.impl.list.pages()) return false;
      v.impl.list.setPage(next);
      return true;
    },
    /** Show the board on screen again from its first page (its first card is read out again). */
    restartCurrent() { if (currentId) enter(byId.get(currentId), 'fade'); },
  };
}
