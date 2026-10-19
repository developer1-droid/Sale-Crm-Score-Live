/* Mouse/keyboard controls: fullscreen, theme, settings. The toolbar and the
   cursor hide after a few idle seconds so the TV stays clean. */
import { $, keyOf } from './dom.js';

const IDLE_MS = 3000;

export function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement);
}

export function toggleFullscreen() {
  const doc = document;
  const root = doc.documentElement;
  // Older TV Chromium only has the webkit-prefixed API (and no promise back).
  const on = isFullscreen();
  const fn = on
    ? doc.exitFullscreen || doc.webkitExitFullscreen || doc.webkitCancelFullScreen
    : root.requestFullscreen || root.webkitRequestFullscreen || root.webkitRequestFullScreen;
  if (typeof fn !== 'function') return Promise.resolve();
  let req;
  try { req = fn.call(on ? doc : root); } catch (e) { req = null; }
  return Promise.resolve(req).catch(() => { /* blocked (kiosk, iframe): nothing to do */ });
}

export function createControls({ onTheme, onSettings, onKey }) {
  let idleTimer = null;
  const body = document.body;

  function wake() {
    body.classList.add('is-awake');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (document.activeElement && document.activeElement.closest('.toolbar, .filterbar')) document.activeElement.blur();
      body.classList.remove('is-awake');
    }, IDLE_MS);
  }

  const syncFullscreen = () => {
    const on = isFullscreen();
    const btn = $('btnFullscreen');
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Exit full screen (F)' : 'Full screen (F)');
    btn.title = btn.getAttribute('aria-label');
  };

  $('btnFullscreen').addEventListener('click', toggleFullscreen);
  $('btnTheme').addEventListener('click', onTheme);
  $('btnSettings').addEventListener('click', onSettings);
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);
  // No PointerEvent before Chrome 55: listen for mouse and touch instead.
  const pointer = window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'];
  ['mousemove', ...pointer, 'wheel'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));

  document.addEventListener('keydown', (e) => {
    // A TV remote's key can arrive with the document itself as the target, which has no closest().
    const inField = e.target && typeof e.target.closest === 'function' && e.target.closest('input, select, textarea');
    if (e.ctrlKey || e.metaKey || e.altKey || inField) return;
    const key = keyOf(e);
    const k = key.toLowerCase();
    if (k === 'f') { toggleFullscreen(); return; }
    if (k === 't') { onTheme(); return; }
    if (k === 's') { onSettings(); return; }
    if (key === 'Tab') wake();
    onKey(e);
  });
  syncFullscreen();
}
