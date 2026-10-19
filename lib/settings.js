// TV settings shared by every screen: defaults, validation and an atomic JSON
// file store (data/settings.json). normalize() is pure; the store does the I/O.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CRM_DEFAULT_PERIOD, CRM_PERIOD_KEYS, crmPeriodOrDefault } from '../engine/crmMis.js';
import { SALES_PERIOD_KEYS } from '../engine/salesReport.js';
import { VOICE_DEFAULTS, sanitizeVoice, saysSomething, voiceErrors } from '../public/js/voice/voiceModel.js';

export const BOARD_IDS = ['crm', 'crm-people', 'crm-leader', 'sales', 'sales-leader', 'sales-previous'];
export const THEMES = ['dark', 'light', 'auto'];
export const TRANSITIONS = ['slide', 'fade', 'zoom', 'flip', 'wipe'];
const DWELL = { min: 3, max: 300 };
const SPEED = { min: 0.5, max: 2 };
const ROWS = { min: 0, max: 50 };

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  theme: 'dark',
  crmPeriod: CRM_DEFAULT_PERIOD,
  // The CRM MIS page's From–To dates for the "Custom" period ('' while not chosen).
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

const ENUMS = { theme: THEMES, crmPeriod: CRM_PERIOD_KEYS, salesPeriod: SALES_PERIOD_KEYS, singleBoard: BOARD_IDS };
const FLAGS = ['rotate', 'showFilterBar', 'showTicker'];

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clampNumber = (v, { min, max }, round) => {
  const n = round ? Math.round(v) : Math.round(v * 100) / 100;
  return Math.min(max, Math.max(min, n));
};

function readNumber(value, limits, name, errors, round = true) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${name} must be a number`);
    return undefined;
  }
  return clampNumber(value, limits, round);
}

/* A board list saved before a board existed gets it in its default place, so its own order and times survive. */
function withNewBoards(value) {
  if (!Array.isArray(value)) return value;
  const ids = value.map((b) => (isObject(b) ? b.id : undefined));
  if (ids.some((id) => !BOARD_IDS.includes(id))) return value;
  const out = [...value];
  BOARD_IDS.forEach((id, i) => {
    if (ids.includes(id)) return;
    const before = BOARD_IDS.slice(0, i).reverse().find((prev) => out.some((b) => b.id === prev));
    const at = before ? out.findIndex((b) => b.id === before) + 1 : 0;
    out.splice(at, 0, { ...DEFAULT_SETTINGS.boards.find((b) => b.id === id) });
  });
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v) => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
function readCustom(value, errors) {
  if (!isObject(value)) return errors.push('crmCustom must be { from, to }'), undefined;
  const from = String(value.from ?? '');
  const to = String(value.to ?? '');
  if (!from && !to) return { from: '', to: '' };
  if (!isDay(from) || !isDay(to)) return errors.push('crmCustom.from and crmCustom.to must be dates like 2026-10-01'), undefined;
  if (from > to) return errors.push('crmCustom.from must not be after crmCustom.to'), undefined;
  return { from, to };
}

function readBoards(value, current, errors) {
  if (!Array.isArray(value)) return errors.push('boards must be an array'), undefined;
  const ids = value.map((b) => (isObject(b) ? b.id : undefined));
  const isPermutation = ids.length === BOARD_IDS.length && BOARD_IDS.every((id) => ids.includes(id));
  if (!isPermutation) return errors.push(`boards must list each of ${BOARD_IDS.join(', ')} exactly once`), undefined;
  return value.map((b) => {
    const base = current.find((c) => c.id === b.id);
    const enabled = b.enabled === undefined ? base.enabled : b.enabled;
    if (typeof enabled !== 'boolean') errors.push(`boards.${b.id}.enabled must be true or false`);
    const dwellSec = b.dwellSec === undefined ? base.dwellSec : readNumber(b.dwellSec, DWELL, `boards.${b.id}.dwellSec`, errors);
    return { id: b.id, enabled: enabled === true, dwellSec: dwellSec ?? base.dwellSec };
  });
}

function readAnimation(value, current, errors) {
  if (!isObject(value)) return errors.push('animation must be an object'), undefined;
  const next = { ...current };
  if (value.enabled !== undefined) {
    if (typeof value.enabled === 'boolean') next.enabled = value.enabled;
    else errors.push('animation.enabled must be true or false');
  }
  if (value.transition !== undefined) {
    if (TRANSITIONS.includes(value.transition)) next.transition = value.transition;
    else errors.push(`animation.transition must be one of ${TRANSITIONS.join(', ')}`);
  }
  if (value.speed !== undefined) next.speed = readNumber(value.speed, SPEED, 'animation.speed', errors, false) ?? next.speed;
  return next;
}

/**
 * Merge a full or partial update onto `base`. Unknown keys are dropped, numbers
 * clamped; an invalid enum / flag / board list is reported and that field keeps
 * its base value.
 * @returns {{ settings: object, errors: string[] }}
 */
export function normalize(input, base = DEFAULT_SETTINGS) {
  const settings = clone(base);
  const errors = [];
  if (!isObject(input)) return { settings, errors: ['settings must be a JSON object'] };
  // Settings saved before: the TV's earlier CRM periods read as the nearest MIS period, and a board added since joins in.
  settings.crmPeriod = crmPeriodOrDefault(settings.crmPeriod);
  if (!isObject(settings.crmCustom)) settings.crmCustom = { ...DEFAULT_SETTINGS.crmCustom };
  settings.boards = withNewBoards(settings.boards);
  input = { ...input };
  if (input.crmPeriod !== undefined && !CRM_PERIOD_KEYS.includes(input.crmPeriod)) input.crmPeriod = crmPeriodOrDefault(input.crmPeriod);
  if (input.boards !== undefined) input.boards = withNewBoards(input.boards);

  Object.entries(ENUMS).forEach(([key, allowed]) => {
    if (input[key] === undefined) return;
    if (allowed.includes(input[key])) settings[key] = input[key];
    else errors.push(`${key} must be one of ${allowed.join(', ')}`);
  });
  if (input.crmCustom !== undefined) settings.crmCustom = readCustom(input.crmCustom, errors) ?? settings.crmCustom;
  FLAGS.forEach((key) => {
    if (input[key] === undefined) return;
    if (typeof input[key] === 'boolean') settings[key] = input[key];
    else errors.push(`${key} must be true or false`);
  });
  if (input.boards !== undefined) settings.boards = readBoards(input.boards, settings.boards, errors) ?? settings.boards;
  if (!settings.boards.some((b) => b.enabled)) errors.push('at least one board must be enabled');
  if (input.animation !== undefined) settings.animation = readAnimation(input.animation, settings.animation, errors) ?? settings.animation;
  if (input.rowsPerPage !== undefined) settings.rowsPerPage = readNumber(input.rowsPerPage, ROWS, 'rowsPerPage', errors) ?? settings.rowsPerPage;
  if (input.pageDwellSec !== undefined) settings.pageDwellSec = readNumber(input.pageDwellSec, DWELL, 'pageDwellSec', errors) ?? settings.pageDwellSec;
  settings.voice = sanitizeVoice(settings.voice); // settings saved before the voice existed have none
  if (input.voice !== undefined) {
    const voiceProblems = voiceErrors(input.voice);
    if (voiceProblems.length) errors.push(...voiceProblems);
    else settings.voice = sanitizeVoice(input.voice, settings.voice);
  }
  if (!saysSomething(settings.voice)) errors.push('voice must say at least one thing');
  settings.version = DEFAULT_SETTINGS.version;
  return { settings, errors };
}

/* Windows: Defender or an editor holding settings.json briefly makes rename fail. */
const RENAME_RETRIES = 5;
const RENAME_BACKOFF_MS = 50;
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

async function renameWithRetry(tmp, file) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fs.rename(tmp, file);
    } catch (err) {
      if (!RETRYABLE.has(err.code) || attempt >= RENAME_RETRIES) {
        await fs.unlink(tmp).catch(() => {});
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_BACKOFF_MS * attempt));
    }
  }
}

/** File-backed store. A missing file is created with the defaults; an unreadable one falls back to them. */
export function createSettingsStore(file) {
  let current = clone(DEFAULT_SETTINGS);
  let queue = Promise.resolve();

  async function persist(settings) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await renameWithRetry(tmp, file);
  }

  return {
    async load() {
      try {
        current = normalize(JSON.parse(await fs.readFile(file, 'utf8'))).settings;
      } catch (err) {
        current = clone(DEFAULT_SETTINGS);
        // A broken file is left for a human to look at; the next save replaces it.
        if (err.code === 'ENOENT') await persist(current);
        else console.error(`[score-live] settings file unreadable, using defaults: ${err.message}`);
      }
      return clone(current);
    },
    get: () => clone(current),
    /** Saves only when there are no errors. Updates run one at a time, each on the previous result. */
    update(input) {
      const run = queue.then(async () => {
        const result = normalize(input, current);
        if (result.errors.length) return result;
        await persist(result.settings);
        current = result.settings;
        return { settings: clone(current), errors: [] };
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
