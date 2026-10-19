/* DOM + number helpers. Everything from the payload is written with textContent. */
import { motionOff } from './motion.js';

const COUNT_MS = 1100;

export const $ = (id) => document.getElementById(id);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
export const fmtPct = (v) => `${Math.round(v)}%`;
export const fmtDec = (v) => `${Math.round(v * 10) / 10}`;
export const dash = (v, fmt) => (isNum(v) ? fmt(v) : '—');
export const band = (v, b) => (v >= b.good ? 'good' : v >= b.warn ? 'warn' : 'bad');

/* KeyboardEvent.key is missing before Chrome 51 (old TVs): rebuild it from keyCode. */
const KEY_NAMES = { 9: 'Tab', 13: 'Enter', 27: 'Escape', 32: ' ', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' };
export function keyOf(e) {
  if (e.key && e.key !== 'Unidentified') return e.key;
  const code = e.keyCode || e.which || 0;
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code >= 96 && code <= 105) return String(code - 96);
  if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90)) return String.fromCharCode(code).toLowerCase();
  return '';
}

export const SCORE_BANDS = { good: 75, warn: 50 };
export const ON_TIME_BANDS = { good: 80, warn: 60 };
export const REWARD_CASH = 'cash';

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function restartClass(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** Set a number into a node, counting from the old value when animated. Returns true when it changed. */
export function setNumber(node, value, fmt, animate) {
  const from = node._num;
  node._num = isNum(value) ? value : null;
  if (node._raf) cancelAnimationFrame(node._raf);
  if (!isNum(value)) { node.textContent = '—'; return false; }
  if (!animate || !isNum(from) || from === value || motionOff()) {
    node.textContent = fmt(value);
    return isNum(from) && from !== value;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / COUNT_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = fmt(t === 1 ? value : from + (value - from) * eased);
    if (t < 1) node._raf = requestAnimationFrame(step);
  };
  node._raf = requestAnimationFrame(step);
  return true;
}

export function setText(node, value) {
  const next = value === null || value === undefined || value === '' ? '—' : String(value);
  const changed = node.textContent !== next;
  node.textContent = next;
  return changed;
}

export function setTone(node, tone) {
  node.classList.remove('tone-good', 'tone-warn', 'tone-bad', 'tone-muted');
  if (tone) node.classList.add(`tone-${tone}`);
}

export function medal() { return el('span', 'medal'); }
export function setMedal(node, rank) {
  node.dataset.rank = isNum(rank) ? String(rank) : '';
  node.textContent = isNum(rank) ? String(rank) : '—';
}

export function headCell(text, cls, weight) {
  const cell = el('div', cls || '', text);
  if (weight) cell.appendChild(el('span', 'w', weight));
  return cell;
}

export function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
export function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch (e) { /* storage blocked: the page still works, it just forgets */ }
}
