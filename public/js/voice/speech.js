/* Speaks the lines after an optional alert tone played with Web Audio (so no sound files ship).
   Two voices: the server's online voice (GET /api/tts, the default — the same voice on every
   screen) and the browser's own (speechSynthesis). TVs often list a voice that never makes a
   sound, so a browser voice that does not start in time hands the rest of the lines to the
   server's, and this screen remembers to skip it; a server voice that fails hands them back. */
import { storageGet, storageSet } from '../dom.js';
import { VOICE_ENGINES } from './voiceModel.js';

const CHIME_NOTES = {
  bell: [{ freq: 880, start: 0, length: 0.9 }, { freq: 1760, start: 0, length: 0.5, level: 0.25 }],
  ding: [{ freq: 1318.5, start: 0, length: 0.45 }],
  double: [{ freq: 784, start: 0, length: 0.2 }, { freq: 1046.5, start: 0.24, length: 0.3 }],
};
const PEAK = 0.4;
const ATTACK_S = 0.015;
const SILENCE = 0.0001;
const AFTER_CHIME_MS = 150;
/* Without a click Chrome can leave resume() pending forever; never let the tone hold up the voice. */
const RESUME_WAIT_MS = 300;
const LANG_TAGS = { hi: 'hi-IN', en: 'en-IN' };
/* Some voices never fire `end`; move on after roughly the time the line needs. */
const MIN_LINE_MS = 8000;
const MS_PER_CHAR = 140;
/* A browser voice that has not started by then is taken as silent (TVs list voices they cannot play). */
const START_WAIT_MS = 3000;
const SILENT_ERRORS = ['synthesis-failed', 'synthesis-unavailable', 'language-unavailable', 'voice-unavailable', 'audio-hardware', 'audio-busy', 'network'];
const BROWSER_FAILED_KEY = 'scorelive.voice.browserFailed.';
const FORGET_FAILURE_MS = 7 * 24 * 60 * 60 * 1000;
const SERVER_LINE_GUARD_MS = 60000;
const REPORT_EVERY_MS = 60 * 1000;

export class SpeechBlockedError extends Error {
  constructor() {
    super('The browser blocked sound until someone clicks on this screen once.');
    this.name = 'SpeechBlockedError';
    // Keeps `instanceof SpeechBlockedError` working in the ES5 build for old TV browsers.
    Object.setPrototypeOf(this, SpeechBlockedError.prototype);
  }
}

/* The browser voice did not make a sound (no start in time, or a synthesis error). */
class VoiceSilentError extends Error {
  constructor(reason) {
    super(`browser voice silent (${reason})`);
    this.name = 'VoiceSilentError';
    Object.setPrototypeOf(this, VoiceSilentError.prototype);
  }
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/* ---------- who is listening: the board shows its announcer while the voice plays ---------- */
const listeners = [];
/** listener({ type: 'start' | 'line' | 'cue' | 'end', text?, cue? }); returns an unsubscribe function. */
export function onSpeech(listener) {
  listeners.push(listener);
  return () => { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); };
}
function emit(event) {
  listeners.slice().forEach((listener) => {
    try { listener(event); } catch (e) { /* a broken listener must not stop the voice */ }
  });
}

/* A line is text to say, or a sound cue ({ cue: 'congrats' | 'push' }) played between the lines. */
const isCue = (item) => Boolean(item) && typeof item === 'object' && typeof item.cue === 'string';
const textsOf = (items) => items.filter((item) => typeof item === 'string');

/* ---------- what went wrong, sent to the server's console (a TV has none), at most once a minute per kind ---------- */
const lastReport = {};
export function reportVoice(event, detail) {
  const now = Date.now();
  if (lastReport[event] && now - lastReport[event] < REPORT_EVERY_MS) return;
  lastReport[event] = now;
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'voice', event, detail: String(detail || '').slice(0, 300) }),
    }).catch(() => {});
  } catch (e) { /* no fetch: nothing to report with */ }
}

/* ---------- one Web Audio context for the tone and the server voice, unlocked by the first touch ---------- */
let sharedCtx = null;
function audioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    try { sharedCtx = new AudioCtx(); } catch (e) { sharedCtx = null; }
  }
  return sharedCtx;
}

/** The context, running; null when there is none or the browser keeps it suspended. */
async function runningContext() {
  const ctx = audioContext();
  if (!ctx) return null;
  // Old TV builds have no state / resume() (treat as running).
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') await Promise.race([ctx.resume(), wait(RESUME_WAIT_MS)]);
  return ctx.state === undefined || ctx.state === 'running' ? ctx : null;
}

function unlockAudio() {
  const ctx = sharedCtx || (window.AudioContext || window.webkitAudioContext ? audioContext() : null);
  if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => {});
}
(window.PointerEvent ? ['pointerdown', 'keydown'] : ['mousedown', 'touchstart', 'keydown'])
  .forEach((type) => window.addEventListener(type, unlockAudio, true));

async function playChime(kind, volume) {
  const notes = CHIME_NOTES[kind];
  if (!notes || volume <= 0) return;
  const ctx = await runningContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  notes.forEach(({ freq, start, length, level = 1 }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(SILENCE, t0 + start);
    gain.gain.exponentialRampToValueAtTime(PEAK * level * volume, t0 + start + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(SILENCE, t0 + start + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + length);
  });
  await wait(Math.max(...notes.map((n) => n.start + n.length)) * 1000 + AFTER_CHIME_MS);
}

/* Short tunes made with Web Audio, so no sound files ship: a fanfare for the top and the
   runner-up, a drum roll and a rising swoosh to push the last one up. */
const CUES = {
  congrats: [
    { freq: 523.3, start: 0, length: 0.16, type: 'triangle' },
    { freq: 659.3, start: 0.14, length: 0.16, type: 'triangle' },
    { freq: 784, start: 0.28, length: 0.16, type: 'triangle' },
    { freq: 1046.5, start: 0.42, length: 0.55, type: 'triangle' },
    { freq: 1318.5, start: 0.42, length: 0.55, type: 'sine', level: 0.35 },
  ],
  push: [
    { freq: 110, start: 0, length: 0.14, type: 'sine', level: 1.2 },
    { freq: 110, start: 0.18, length: 0.14, type: 'sine', level: 1.2 },
    { freq: 110, start: 0.36, length: 0.14, type: 'sine', level: 1.2 },
    { freq: 220, sweepTo: 880, start: 0.5, length: 0.45, type: 'sawtooth', level: 0.3 },
  ],
};

/** A cue's notes on the shared context; quiet when there is no sound. */
async function playCue(kind, volume) {
  const notes = CUES[kind];
  if (!notes || volume <= 0) return;
  const ctx = await runningContext();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  notes.forEach(({ freq, sweepTo, start, length, type, level = 1 }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0 + start);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + start + length);
    gain.gain.setValueAtTime(SILENCE, t0 + start);
    gain.gain.exponentialRampToValueAtTime(Math.min(1, PEAK * level * volume), t0 + start + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(SILENCE, t0 + start + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + length);
  });
  await wait(Math.max(...notes.map((n) => n.start + n.length)) * 1000 + AFTER_CHIME_MS);
}

/** The alert tone on its own: the bell between slides while the voice reads them. */
export const ringBell = (settings) => playChime(settings.chime, settings.volume).catch(() => {});

/* ---------- the browser's own voices ---------- */
export const browserVoices = () => (window.speechSynthesis ? window.speechSynthesis.getVoices() : []);

const VOICES_WAIT_MS = 1500;
/* Android loads its voice list late: getVoices() is [] until voiceschanged fires. */
function loadVoices() {
  const now = browserVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const speech = window.speechSynthesis;
    const done = () => { clearTimeout(timer); resolve(browserVoices()); };
    const timer = setTimeout(done, VOICES_WAIT_MS);
    if (speech.addEventListener) speech.addEventListener('voiceschanged', done, { once: true });
    else speech.onvoiceschanged = done;
  });
}

/** The saved voice when this browser has it, else the first voice for the language. */
export function pickVoice(voices, { voiceName, language }) {
  return voices.find((v) => v.name === voiceName)
    || voices.find((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(language))
    || null;
}

const failedKey = (language) => BROWSER_FAILED_KEY + language;
function browserVoiceFailed(language) {
  const at = Number(storageGet(failedKey(language)));
  return Boolean(at) && Date.now() - at < FORGET_FAILURE_MS;
}
const rememberBrowserFailed = (language) => storageSet(failedKey(language), String(Date.now()));
export const forgetBrowserFailed = (language) => storageSet(failedKey(language), null);

/** One line on what this screen will use, for the settings page Test and the server log. */
export async function voiceReport(settings) {
  const voices = window.speechSynthesis ? await loadVoices() : [];
  const voice = pickVoice(voices, settings);
  const engine = settings.engine || 'server';
  const browserLine = voice ? `${voice.name} (${voice.lang})` : `no ${LANG_TAGS[settings.language]} voice in this browser`;
  if (engine === 'server') return `Online voice from the server (needs internet on the server PC). This browser: ${browserLine}.`;
  if (!voice) return `${browserLine}: using the online voice from the server instead.`;
  if (engine === 'auto' && browserVoiceFailed(settings.language)) return `${browserLine} did not make a sound earlier on this screen: using the online voice. A Test that speaks with it clears this.`;
  return `Voice: ${browserLine}; if it stays silent the online voice takes over. ${voices.length} voices available.`;
}

function sayLine(text, voice, settings) {
  return new Promise((resolve, reject) => {
    const speech = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang || LANG_TAGS[settings.language];
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    let started = false;
    const startGuard = setTimeout(() => {
      if (started) return;
      speech.cancel();
      reject(new VoiceSilentError('did not start'));
    }, START_WAIT_MS);
    const endGuard = setTimeout(resolve, Math.max(MIN_LINE_MS, text.length * MS_PER_CHAR));
    utterance.onstart = () => { started = true; clearTimeout(startGuard); };
    utterance.onend = () => { clearTimeout(startGuard); clearTimeout(endGuard); resolve(); };
    utterance.onerror = (event) => {
      clearTimeout(startGuard);
      clearTimeout(endGuard);
      if (event.error === 'interrupted' || event.error === 'canceled') resolve();
      else if (event.error === 'not-allowed') reject(new SpeechBlockedError());
      else if (SILENT_ERRORS.includes(event.error)) reject(new VoiceSilentError(event.error));
      else reject(new Error(`voice failed (${event.error})`));
    };
    speech.speak(utterance);
  });
}

/* ---------- the server's online voice: MP3 from /api/tts, played with Web Audio, else an <audio> element ---------- */
let serverAudio = null; // { source } or { element } while a server line plays

const lineUrl = (text, settings) => `/api/tts?text=${encodeURIComponent(text)}&lang=${settings.language}&rate=${settings.rate}&pitch=${settings.pitch}`;

function fetchLine(text, settings) {
  return fetch(lineUrl(text, settings)).then((r) => {
    if (!r.ok) throw new Error(`server voice failed (${r.status})`);
    return r.arrayBuffer();
  });
}

/* Callback form: old TV builds have no promise-returning decodeAudioData. */
const decode = (ctx, buf) => new Promise((resolve, reject) => { ctx.decodeAudioData(buf, resolve, reject); });

function playBuffer(ctx, audio, volume) {
  return new Promise((resolve) => {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = audio;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    const guard = setTimeout(resolve, audio.duration * 1000 + 1000);
    source.onended = () => { clearTimeout(guard); resolve(); };
    serverAudio = { source };
    source.start(0);
  });
}

/* For browsers whose Web Audio cannot decode the MP3 (or has no Web Audio at all). */
function playElement(url, volume) {
  return new Promise((resolve, reject) => {
    const element = new Audio(url);
    element.volume = volume;
    serverAudio = { element };
    const guard = setTimeout(resolve, SERVER_LINE_GUARD_MS);
    element.onended = () => { clearTimeout(guard); resolve(); };
    element.onerror = () => { clearTimeout(guard); reject(new Error('server voice could not play')); };
    const playing = element.play();
    if (playing && typeof playing.catch === 'function') {
      playing.catch((err) => {
        clearTimeout(guard);
        reject(err && err.name === 'NotAllowedError' ? new SpeechBlockedError() : err);
      });
    }
  });
}

/** Plays the items in order — a download (already started) per line, a cue in between — and quits
    between items when something newer took over. A failure carries `lineIndex`, the first item not played. */
async function playServerItems(items, downloads, settings, id) {
  const ctx = await runningContext();
  for (let i = 0; i < items.length; i += 1) {
    if (id !== current) return;
    const item = items[i];
    if (isCue(item)) {
      emit({ type: 'cue', cue: item.cue });
      await playCue(item.cue, settings.volume);
      continue;
    }
    try {
      const buf = await downloads[i];
      if (id !== current) return;
      let audio = null;
      if (ctx) {
        try { audio = await decode(ctx, buf); } catch (e) { audio = null; }
      }
      if (id !== current) return;
      emit({ type: 'line', text: item });
      if (audio) await playBuffer(ctx, audio, settings.volume);
      else await playElement(lineUrl(item, settings), settings.volume);
    } catch (err) {
      if (err && typeof err === 'object') err.lineIndex = i;
      throw err;
    }
  }
}

/** Browser voice for the items (cues between them); a voice that stays silent throws VoiceSilentError with `lineIndex`. */
async function sayBrowserItems(items, voice, settings, id) {
  for (let i = 0; i < items.length; i += 1) {
    if (id !== current) return;
    const item = items[i];
    if (isCue(item)) {
      emit({ type: 'cue', cue: item.cue });
      await playCue(item.cue, settings.volume);
      continue;
    }
    emit({ type: 'line', text: item });
    try {
      await sayLine(item, voice, settings);
    } catch (err) {
      if (err && typeof err === 'object') err.lineIndex = i;
      throw err;
    }
  }
}

function startDownloads(items, settings) {
  const downloads = items.map((item) => (typeof item === 'string' ? fetchLine(item, settings) : null));
  downloads.forEach((d) => { if (d) d.catch(() => {}); });
  return downloads;
}

/* Each call gets a number; a newer call (or stop) makes the older one quit between lines. */
let current = 0;

/** This browser's voice for the language, or null (no speechSynthesis, or no voice for it). */
async function browserVoiceFor(settings) {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') return null;
  return pickVoice(await loadVoices(), settings);
}

/** Server voice for the items; when it cannot (no internet on the server…) the browser voice says the rest. */
async function serverThenBrowser(items, downloads, settings, id) {
  try {
    await playServerItems(items, downloads, settings, id);
  } catch (err) {
    reportVoice('server-voice-failed', err && err.message);
    if (err instanceof SpeechBlockedError) throw err;
    const voice = await browserVoiceFor(settings);
    if (!voice) throw err;
    await sayBrowserItems(items.slice(err.lineIndex || 0), voice, settings, id);
  }
}

async function speakItems(items, settings, id) {
  const engine = VOICE_ENGINES.includes(settings.engine) ? settings.engine : 'server';
  // The online voice needs no browser voice list (TVs fill it late), only a fallback does.
  const voice = engine === 'server' ? null : await browserVoiceFor(settings);
  const useBrowser = Boolean(voice) && (engine === 'browser' || !browserVoiceFailed(settings.language));
  // The server voice downloads while the tone plays, so the voice follows the bell at once.
  const downloads = useBrowser ? null : startDownloads(items, settings);
  await playChime(settings.chime, settings.volume).catch(() => { /* tone blocked or unsupported: the voice still tries */ });
  if (!useBrowser) {
    await serverThenBrowser(items, downloads, settings, id);
    return;
  }
  try {
    await sayBrowserItems(items, voice, settings, id);
  } catch (err) {
    if (!(err instanceof VoiceSilentError)) throw err;
    // This screen lists a voice that makes no sound: the server's voice says the rest, and next time all of it.
    if (engine === 'auto') rememberBrowserFailed(settings.language);
    reportVoice('browser-voice-silent', `${voice.name} (${voice.lang}): ${err.message}`);
    const rest = items.slice(err.lineIndex || 0);
    await playServerItems(rest, startDownloads(rest, settings), settings, id);
  }
}

/** Alert tone, then the lines in order (text, or { cue } sounds between them). Resolves false when
    something newer took over. settings.engine: 'server' (default) · 'auto' · 'browser'. */
export async function speakLines(lines, settings) {
  const speech = window.speechSynthesis;
  current += 1;
  const id = current;
  if (speech) {
    // Android Chrome drops a speak() that follows cancel() on an idle queue, and can sit "paused".
    if (speech.speaking || speech.pending) speech.cancel();
    if (typeof speech.resume === 'function') speech.resume();
  }
  stopServerAudio();
  const items = settings.sounds === false ? textsOf(lines) : lines.filter((item) => typeof item === 'string' || isCue(item));
  emit({ type: 'start' });
  try {
    await speakItems(items, settings, id);
  } finally {
    // A newer call has its own start; only the last one says the voice has stopped.
    if (id === current) emit({ type: 'end' });
  }
  return id === current;
}

function stopServerAudio() {
  if (!serverAudio) return;
  try {
    if (serverAudio.source) serverAudio.source.stop(0);
    if (serverAudio.element) serverAudio.element.pause();
  } catch (e) { /* already ended */ }
  serverAudio = null;
}

export function stopSpeaking() {
  current += 1;
  stopServerAudio();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  emit({ type: 'end' });
}
