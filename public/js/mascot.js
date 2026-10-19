/* The board's cartoon friends, as inline SVG (no image files, sharp on any TV):
   - the announcer, who slides in with a mic whenever the voice speaks and shows what it says;
   - a flame for whoever is on top;
   - a little coach holding up a "push" sign for the last one.
   Their markup is fixed (nothing from the payload goes into it); the motion is CSS on
   transform/opacity only (styles.css "Cartoons"), and stops with data-motion="off". */
import { el } from './dom.js';

const ANNOUNCER_SVG = `
<svg viewBox="0 0 120 150" aria-hidden="true" focusable="false">
  <ellipse class="m-shadow" cx="60" cy="144" rx="34" ry="5"/>
  <path class="m-body" d="M24 146c0-26 16-40 36-40s36 14 36 40z"/>
  <path class="m-collar" d="M48 108l12 12 12-12z"/>
  <g class="m-head">
    <circle class="m-face" cx="60" cy="62" r="34"/>
    <path class="m-hair" d="M27 58c0-24 15-38 33-38s33 14 33 38c-6-10-17-16-33-16s-27 6-33 16z"/>
    <path class="m-band" d="M24 64a36 36 0 0 1 72 0" fill="none"/>
    <rect class="m-cup" x="18" y="56" width="10" height="20" rx="5"/>
    <rect class="m-cup" x="92" y="56" width="10" height="20" rx="5"/>
    <circle class="m-cheek" cx="42" cy="74" r="5"/>
    <circle class="m-cheek" cx="78" cy="74" r="5"/>
    <g class="m-eyes"><circle cx="48" cy="62" r="4.5"/><circle cx="72" cy="62" r="4.5"/></g>
    <ellipse class="m-mouth" cx="60" cy="82" rx="8" ry="5"/>
  </g>
  <g class="m-mic">
    <rect class="m-handle" x="84" y="92" width="7" height="26" rx="3.5" transform="rotate(-25 87 105)"/>
    <circle class="m-mic-head" cx="80" cy="88" r="8"/>
    <circle class="m-hand" cx="90" cy="108" r="7"/>
  </g>
</svg>`;

const FLAME_SVG = `
<svg viewBox="0 0 40 56" aria-hidden="true" focusable="false">
  <path class="f-outer" d="M20 2c4 10 16 16 16 31 0 12-8 21-16 21S4 45 4 33c0-8 5-12 7-18 2 5 5 7 6 8 0-8 1-15 3-21z"/>
  <path class="f-inner" d="M20 22c3 6 9 9 9 17 0 7-4 12-9 12s-9-5-9-12c0-4 2-6 4-9 1 3 3 4 4 5 0-5 0-9 1-13z"/>
  <ellipse class="f-core" cx="20" cy="44" rx="4" ry="6"/>
</svg>`;

const COACH_SVG = `
<svg viewBox="0 0 90 110" aria-hidden="true" focusable="false">
  <ellipse class="m-shadow" cx="45" cy="106" rx="24" ry="4"/>
  <g class="c-sign">
    <rect class="c-stick" x="64" y="10" width="4" height="58" rx="2"/>
    <rect class="c-board" x="46" y="4" width="40" height="26" rx="5"/>
    <path class="c-arrow" d="M66 9l9 10h-6v8h-6v-8h-6z"/>
  </g>
  <path class="m-body c-body" d="M18 106c0-20 12-31 27-31s27 11 27 31z"/>
  <g class="m-head">
    <circle class="m-face" cx="42" cy="50" r="24"/>
    <path class="m-hair" d="M19 46c0-16 10-26 23-26s23 10 23 26c-4-7-12-11-23-11s-19 4-23 11z"/>
    <path class="c-sweat" d="M64 40c3 4 4 6 4 8a4 4 0 0 1-8 0c0-2 1-4 4-8z"/>
    <g class="m-eyes"><circle cx="34" cy="50" r="3.2"/><circle cx="50" cy="50" r="3.2"/></g>
    <path class="c-mouth" d="M34 62q8 6 16 0" fill="none"/>
  </g>
  <circle class="m-hand" cx="66" cy="70" r="5.5"/>
</svg>`;

function svgIcon(markup, cls) {
  const host = el('span', cls);
  host.innerHTML = markup; // fixed markup above, never data
  return host;
}

/** A flickering flame (the top performer). */
export const flame = (cls = '') => svgIcon(FLAME_SVG, `flame ${cls}`.trim());

/** The little coach with a "push" sign (the last one), with a short word bubble. */
export function coach(cls = '', words = '') {
  const host = el('span', `coach ${cls}`.trim());
  host.appendChild(svgIcon(COACH_SVG, 'coach-figure'));
  if (words) host.appendChild(el('span', 'coach-bubble', words));
  return host;
}

/**
 * The announcer: hidden until the voice starts, slides in from the side with the mic, shows the
 * line being said, talks while it plays, and leaves when the voice stops.
 * handle(event) takes speech.js onSpeech events.
 */
export function createAnnouncerHost(parent) {
  const root = el('div', 'announcer');
  root.setAttribute('aria-hidden', 'true');
  const figure = svgIcon(ANNOUNCER_SVG, 'announcer-figure');
  const bubble = el('div', 'announcer-bubble');
  const tag = el('div', 'announcer-tag', 'Score Live');
  const text = el('div', 'announcer-text');
  bubble.append(tag, text);
  root.append(bubble, figure);
  parent.appendChild(root);
  let leaveTimer = null;

  const show = () => {
    clearTimeout(leaveTimer);
    root.classList.add('is-on');
  };
  return {
    handle(event) {
      if (!event) return;
      if (event.type === 'start') {
        show();
        text.textContent = '…';
        root.classList.add('is-talking');
      } else if (event.type === 'line') {
        show();
        text.textContent = event.text;
        root.classList.add('is-talking');
      } else if (event.type === 'cue') {
        show();
        root.classList.toggle('is-cheer', event.cue === 'congrats');
      } else if (event.type === 'end') {
        root.classList.remove('is-talking', 'is-cheer');
        clearTimeout(leaveTimer);
        // Linger: the last words stay readable, and between two slides the announcer does not flicker away.
        leaveTimer = setTimeout(() => root.classList.remove('is-on'), 4500);
      }
    },
  };
}
