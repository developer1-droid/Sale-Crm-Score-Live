/* Voice announcement settings (settings.voice): lists, defaults, the fallback
   cleaning settingsModel.js applies to the rest of the settings, and the error
   list the server reports (lib/settings.js). Pure, so both sides share it. */

export const VOICE_MODES = ['slides', 'summary'];
export const VOICE_FREQUENCIES = ['daily', 'weekly'];
export const VOICE_LANGUAGES = ['hi', 'en'];
export const VOICE_STYLES = ['friendly', 'formal', 'energetic'];
export const VOICE_CHIMES = ['none', 'bell', 'ding', 'double'];
/* Who speaks: the server's online voice (same on every screen; TVs often have no working voice of their own),
   this screen's voice when it works (else the online one), or only this screen's voice. */
export const VOICE_ENGINES = ['server', 'auto', 'browser'];
/* Which screens speak on their own: every screen with the board open, or only those switched on (This screen speaks). */
export const VOICE_SCREENS = ['all', 'chosen'];
export const VOICE_SECTIONS = ['leaders', 'delays', 'bottom', 'team', 'payments'];
export const MAX_VOICE_TIMES = 8;
export const VOICE_LIMITS = {
  topCount: { min: 1, max: 5, integer: true },
  delayCount: { min: 1, max: 10, integer: true },
  rate: { min: 0.5, max: 2 },
  pitch: { min: 0.5, max: 2 },
  volume: { min: 0, max: 1 },
};
const MAX_VOICE_NAME = 200;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ENUMS = { mode: VOICE_MODES, frequency: VOICE_FREQUENCIES, language: VOICE_LANGUAGES, style: VOICE_STYLES, chime: VOICE_CHIMES, engine: VOICE_ENGINES, screens: VOICE_SCREENS };
const FLAGS = ['enabled', 'nonStop', 'sounds'];

export const VOICE_DEFAULTS = Object.freeze({
  enabled: false,
  screens: 'all',
  mode: 'slides',
  nonStop: false,
  // A fanfare before the top performers and a push before the last one (speech.js CUES).
  sounds: true,
  frequency: 'daily',
  weekdays: [1, 2, 3, 4, 5, 6],
  times: ['10:00'],
  sections: { leaders: true, delays: true, bottom: false, team: true, payments: true },
  topCount: 3,
  delayCount: 3,
  language: 'hi',
  style: 'friendly',
  engine: 'server',
  voiceName: '',
  rate: 1,
  pitch: 1,
  volume: 1,
  chime: 'bell',
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = (t) => typeof t === 'string' && TIME.test(t);
const isDay = (d) => Number.isInteger(d) && d >= 0 && d <= 6;
const inList = (v, list, fallback) => (list.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

function num(v, { min, max, integer }, fallback) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const n = Math.min(max, Math.max(min, v));
  return integer ? Math.round(n) : n;
}

/* Times keep the order they were entered in (a row does not jump while it is edited); repeats drop. */
function cleanList(value, isValid, fallback, limit) {
  if (!Array.isArray(value)) return [...fallback];
  const list = [...new Set(value.filter(isValid))].slice(0, limit);
  return list.length ? list : [...fallback];
}

/** Merge a full or partial voice object onto `base`; unknown keys drop, bad values keep `base`. */
export function sanitizeVoice(input, base = VOICE_DEFAULTS) {
  const src = isPlainObject(input) ? input : {};
  const sections = isPlainObject(src.sections) ? src.sections : {};
  const voice = {};
  FLAGS.forEach((key) => { voice[key] = bool(src[key], base[key]); });
  Object.entries(ENUMS).forEach(([key, list]) => { voice[key] = inList(src[key], list, base[key]); });
  Object.entries(VOICE_LIMITS).forEach(([key, limits]) => { voice[key] = num(src[key], limits, base[key]); });
  voice.weekdays = cleanList(src.weekdays ?? base.weekdays, isDay, base.weekdays, 7).sort((a, b) => a - b);
  voice.times = cleanList(src.times ?? base.times, isTime, base.times, MAX_VOICE_TIMES);
  voice.sections = Object.fromEntries(VOICE_SECTIONS.map((k) => [k, bool(sections[k], base.sections[k])]));
  voice.voiceName = typeof src.voiceName === 'string' ? src.voiceName.slice(0, MAX_VOICE_NAME) : base.voiceName;
  return voice;
}

/** What is wrong with a voice update, as the server reports it ([] = fine). */
export function voiceErrors(input) {
  if (!isPlainObject(input)) return ['voice must be an object'];
  const errors = [];
  const check = (key, isValid, message) => {
    if (input[key] !== undefined && !isValid(input[key])) errors.push(`voice.${key} ${message}`);
  };
  FLAGS.forEach((key) => check(key, (v) => typeof v === 'boolean', 'must be true or false'));
  Object.entries(ENUMS).forEach(([key, list]) => check(key, (v) => list.includes(v), `must be one of ${list.join(', ')}`));
  Object.entries(VOICE_LIMITS).forEach(([key, { min, max, integer }]) => check(
    key,
    (v) => typeof v === 'number' && v >= min && v <= max && (!integer || Number.isInteger(v)),
    `must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}`,
  ));
  check('times', (v) => Array.isArray(v) && v.length > 0 && v.length <= MAX_VOICE_TIMES && v.every(isTime), `must be 1 to ${MAX_VOICE_TIMES} times like 09:30`);
  check('weekdays', (v) => Array.isArray(v) && v.length > 0 && v.every(isDay), 'must list at least one day (0 = Sunday … 6 = Saturday)');
  check('sections', (v) => isPlainObject(v) && Object.entries(v).every(([k, on]) => VOICE_SECTIONS.includes(k) && typeof on === 'boolean'), 'must set known parts to true or false');
  check('voiceName', (v) => typeof v === 'string' && v.length <= MAX_VOICE_NAME, 'must be text');
  return errors;
}

export const saysSomething = (voice) => VOICE_SECTIONS.some((k) => voice.sections[k]);
