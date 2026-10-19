/* Settings shape (contract v3) + the same validation the server applies,
   so mock mode stores exactly what the server would. */
import { VOICE_DEFAULTS, sanitizeVoice } from './voice/voiceModel.js';

export const BOARD_IDS = ['crm', 'crm-people', 'crm-leader', 'sales', 'sales-leader', 'sales-previous'];
export const BOARD_LABELS = {
  'crm': 'CRM Executive leaderboard',
  'crm-people': 'CRM · each person: score and delay',
  'crm-leader': 'CRM leader spotlight',
  'sales': 'Sales Coordinators leaderboard',
  'sales-leader': 'Sales leader spotlight',
  'sales-previous': 'Sales · last month final',
};
/* The CRM MIS page's periods (engine/crmMis.js); Custom = the From–To dates below. */
export const CRM_PERIODS = [
  { key: 'this-week', chip: 'This week' }, { key: 'last-week', chip: 'Last week' },
  { key: 'this-month', chip: 'This month' }, { key: 'last-month', chip: 'Last month' }, { key: 'custom', chip: 'Custom' },
];
/* The TV's earlier CRM periods, read as the nearest MIS period (as lib/settings.js does). */
const LEGACY_CRM_PERIOD = { today: 'this-week', weekly: 'this-week', monthly: 'this-month', quarterly: 'this-month', halfyearly: 'this-month', yearly: 'this-month' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const SALES_PERIODS = [{ key: 'today', chip: 'Today' }, { key: 'week', chip: 'This week' }, { key: 'month', chip: 'This month' }];
export const THEMES = ['dark', 'light', 'auto'];
export const TRANSITIONS = ['slide', 'fade', 'zoom', 'flip', 'wipe'];
export const LIMITS = { dwell: [3, 300], speed: [0.5, 2], rows: [0, 50], pageDwell: [3, 300] };

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  theme: 'dark',
  crmPeriod: 'this-week',
  crmCustom: { from: '', to: '' },
  salesPeriod: 'month',
  rotate: true,
  singleBoard: 'crm',
  boards: [
    { id: 'crm', enabled: true, dwellSec: 20 },
    { id: 'crm-people', enabled: true, dwellSec: 60 },
    { id: 'crm-leader', enabled: true, dwellSec: 8 },
    { id: 'sales', enabled: true, dwellSec: 20 },
    { id: 'sales-leader', enabled: true, dwellSec: 8 },
    { id: 'sales-previous', enabled: true, dwellSec: 15 },
  ],
  animation: { enabled: true, transition: 'slide', speed: 1 },
  rowsPerPage: 0,
  pageDwellSec: 8,
  showFilterBar: true,
  showTicker: true,
  voice: VOICE_DEFAULTS,
});

const inList = (v, list, fallback) => (list.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
function num(v, [lo, hi], fallback, round = true) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return fallback;
  const c = Math.min(hi, Math.max(lo, n));
  return round ? Math.round(c) : c;
}

/* A board list saved before a board existed gets it in its default place. */
function withNewBoards(list) {
  const ids = list.map((b) => b && b.id);
  if (ids.some((id) => !BOARD_IDS.includes(id))) return list;
  const out = list.slice();
  BOARD_IDS.forEach((id, i) => {
    if (ids.includes(id)) return;
    const before = BOARD_IDS.slice(0, i).reverse().find((prev) => out.some((b) => b.id === prev));
    out.splice(before ? out.findIndex((b) => b.id === before) + 1 : 0, 0, { ...DEFAULT_SETTINGS.boards.find((b) => b.id === id) });
  });
  return out;
}

function cleanCustom(input, base) {
  const src = input && typeof input === 'object' ? input : base;
  const from = String((src && src.from) || '');
  const to = String((src && src.to) || '');
  if (!from && !to) return { from: '', to: '' };
  return DAY.test(from) && DAY.test(to) && from <= to ? { from, to } : { ...base };
}

function cleanBoards(input, base) {
  if (!Array.isArray(input)) return base.map((b) => ({ ...b }));
  input = withNewBoards(input);
  base = withNewBoards(base);
  const ids = input.map((b) => b && b.id);
  const isPermutation = ids.length === BOARD_IDS.length && BOARD_IDS.every((id) => ids.includes(id));
  if (!isPermutation) return base.map((b) => ({ ...b }));
  return input.map((b) => {
    const prev = base.find((x) => x.id === b.id) || DEFAULT_SETTINGS.boards.find((x) => x.id === b.id);
    return { id: b.id, enabled: bool(b.enabled, prev.enabled), dwellSec: num(b.dwellSec, LIMITS.dwell, prev.dwellSec) };
  });
}

/** Merge a full or partial settings object onto `base`; unknown keys are dropped. */
export function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const src = input && typeof input === 'object' ? input : {};
  const anim = { ...base.animation, ...(src.animation && typeof src.animation === 'object' ? src.animation : {}) };
  return {
    version: 1,
    theme: inList(src.theme, THEMES, base.theme),
    crmPeriod: inList(LEGACY_CRM_PERIOD[src.crmPeriod] || src.crmPeriod, CRM_PERIODS.map((p) => p.key), LEGACY_CRM_PERIOD[base.crmPeriod] || base.crmPeriod),
    crmCustom: cleanCustom(src.crmCustom, base.crmCustom || DEFAULT_SETTINGS.crmCustom),
    salesPeriod: inList(src.salesPeriod, SALES_PERIODS.map((p) => p.key), base.salesPeriod),
    rotate: bool(src.rotate, base.rotate),
    singleBoard: inList(src.singleBoard, BOARD_IDS, base.singleBoard),
    boards: cleanBoards(src.boards === undefined ? base.boards : src.boards, base.boards),
    animation: {
      enabled: bool(anim.enabled, base.animation.enabled),
      transition: inList(anim.transition, TRANSITIONS, base.animation.transition),
      speed: num(anim.speed, LIMITS.speed, base.animation.speed, false),
    },
    rowsPerPage: num(src.rowsPerPage, LIMITS.rows, base.rowsPerPage),
    pageDwellSec: num(src.pageDwellSec, LIMITS.pageDwell, base.pageDwellSec),
    showFilterBar: bool(src.showFilterBar, base.showFilterBar),
    showTicker: bool(src.showTicker, base.showTicker),
    voice: sanitizeVoice(src.voice, base.voice),
  };
}
