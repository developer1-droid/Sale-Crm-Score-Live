/* Board-to-board transitions. Each style animates the outgoing and incoming
   view with the Web Animations API; durations scale with animation.speed.
   `instant` (animation off / reduced motion) just swaps. */
const BASE_MS = { slide: 800, fade: 650, zoom: 750, flip: 900, wipe: 1500 };
const EASE = 'cubic-bezier(.7,0,.2,1)';
const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
const EASE_IN = 'cubic-bezier(.6,0,.8,.2)';

export const transitionMs = (style, speed) => Math.round((BASE_MS[style] || BASE_MS.slide) / (speed || 1));

/* Old TV Chromium: no element.animate before 36, no Animation.finished before 84. */
const canAnimate = () => typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const finished = (a, ms) => a.finished || new Promise((resolve) => {
  a.onfinish = resolve;
  a.oncancel = resolve;
  setTimeout(resolve, ms + 100);
});
const stop = (a) => {
  try {
    if (typeof a.finish === 'function') { a.finish(); return; }
  } catch (e) { /* finish() throws on an infinite or unplayable animation: cancel below */ }
  if (typeof a.cancel === 'function') a.cancel();
};

const STYLES = {
  slide: (from, to, ms) => [
    from.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-104%)' }], { duration: ms, easing: EASE }),
    to.animate([{ transform: 'translateX(104%)' }, { transform: 'translateX(0)' }], { duration: ms, easing: EASE }),
  ],
  fade: (from, to, ms) => [
    from.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.6, easing: 'ease', fill: 'forwards' }),
    to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms * 0.7, delay: ms * 0.3, easing: 'ease', fill: 'backwards' }),
  ],
  zoom: (from, to, ms) => [
    from.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.06)', opacity: 0 }], { duration: ms * 0.55, easing: EASE_IN, fill: 'forwards' }),
    to.animate([{ transform: 'scale(.92)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: ms * 0.6, delay: ms * 0.4, easing: EASE_OUT, fill: 'backwards' }),
  ],
  flip: (from, to, ms) => [
    from.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-90deg)' }], { duration: ms / 2, easing: EASE_IN, fill: 'forwards' }),
    to.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0deg)' }], { duration: ms / 2, delay: ms / 2, easing: EASE_OUT, fill: 'backwards' }),
  ],
};

/* Branded wipe: navy panel sweeps in with the next board's title, then out. */
function wipeAnimations(wipe, ms) {
  const panel = wipe.querySelector('.wipe-panel');
  const edge = wipe.querySelector('.wipe-edge');
  const label = wipe.querySelector('.wipe-label');
  const opts = { duration: ms, easing: EASE };
  const across = `translateX(${wipe.clientWidth}px)`;
  const home = `translateX(${-2 * edge.offsetWidth}px)`;
  return [
    panel.animate([{ transform: 'translateX(-101%)' }, { transform: 'translateX(0)', offset: 0.38 }, { transform: 'translateX(0)', offset: 0.62 }, { transform: 'translateX(101%)' }], opts),
    edge.animate([{ transform: home, opacity: 1 }, { transform: across, offset: 0.38, opacity: 1 },
      { transform: home, offset: 0.62, opacity: 0 }, { transform: home, offset: 0.63, opacity: 1 }, { transform: across, opacity: 1 }], opts),
    label.animate([{ opacity: 0, transform: 'translateX(-3%)' }, { opacity: 0, offset: 0.25, transform: 'translateX(-3%)' }, { opacity: 1, offset: 0.42, transform: 'none' },
      { opacity: 1, offset: 0.58, transform: 'none' }, { opacity: 0, offset: 0.75, transform: 'translateX(3%)' }, { opacity: 0, transform: 'translateX(3%)' }], opts),
  ];
}

/**
 * Swap `from` → `to` (elements with class .view). Resolves when done.
 * opts: { style, speed, instant, wipe (overlay element), onSwap (runs when `to` becomes the board) }
 */
export function createTransitioner() {
  let running = null;

  function finishRunning() {
    if (!running) return;
    const r = running;
    running = null;
    r.anims.forEach(stop);
    r.done();
  }

  function swapNow(from, to, onSwap) {
    if (from && from !== to) from.classList.remove('is-active', 'is-leaving');
    if (to) to.classList.add('is-active');
    if (onSwap) onSwap();
  }

  function run(from, to, { style = 'slide', speed = 1, instant = false, wipe = null, onSwap = null } = {}) {
    finishRunning();
    if (instant || !from || !to || from === to || !canAnimate()) { swapNow(from, to, onSwap); return Promise.resolve(); }
    const ms = transitionMs(style, speed);
    return new Promise((resolve) => {
      let anims;
      let swapTimer = null;
      const cleanup = () => {
        clearTimeout(swapTimer);
        anims.forEach((a) => { if (typeof a.cancel === 'function') a.cancel(); });
        if (wipe) wipe.classList.remove('is-running');
        from.classList.remove('is-active', 'is-leaving');
        resolve();
      };
      if (style === 'wipe' && wipe) {
        wipe.classList.add('is-running');
        anims = wipeAnimations(wipe, ms);
        swapTimer = setTimeout(() => swapNow(from, to, onSwap), ms / 2);
        running = { anims, done: () => { clearTimeout(swapTimer); if (!to.classList.contains('is-active')) swapNow(from, to, onSwap); cleanup(); } };
      } else {
        from.classList.add('is-leaving');
        to.classList.add('is-active');
        if (onSwap) onSwap();
        anims = (STYLES[style] || STYLES.slide)(from, to, ms);
        running = { anims, done: cleanup };
      }
      const mine = running;
      Promise.all(anims.map((a) => finished(a, ms))).then(() => {
        if (running !== mine) return;
        running = null;
        mine.done();
      }, () => { /* cancelled by a newer transition */ });
    });
  }

  return { run, finish: finishRunning };
}
