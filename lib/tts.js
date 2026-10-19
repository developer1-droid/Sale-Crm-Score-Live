// GET /api/tts?text=..&lang=hi|en&rate=1&pitch=1 -> MP3, for screens that speak with the
// server's voice (the default: a TV's own text-to-speech is often missing or silent). Made with
// Microsoft Edge's free online neural voices; when Edge refuses (it rate-limits and moves its
// endpoint now and then), Google Translate's voice says the same line. Needs internet on the server.
import express from 'express';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const VOICES = { hi: 'hi-IN-SwaraNeural', en: 'en-IN-NeerjaNeural' };
const MAX_CHARS = 600;
const CACHE_SIZE = 300;
const EDGE_TIMEOUT_MS = 15000;
/* Edge answers 429 (and the odd 5xx or timeout) now and then; one more try usually works. */
const EDGE_RETRY_MS = 700;
const GOOGLE_URL = 'https://translate.google.com/translate_tts';
const GOOGLE_MAX_CHARS = 180;
const GOOGLE_TIMEOUT_MS = 10000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/* Slider value 0.5-2 (1 = normal) -> SSML relative percentage, e.g. 1.2 -> "+20%". */
const percent = (v) => {
  const n = Math.round((Math.min(2, Math.max(0.5, Number(v) || 1)) - 1) * 100);
  return `${n >= 0 ? '+' : ''}${n}%`;
};
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function edgeOnce(text, lang, rate, pitch) {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(VOICES[lang], OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate, pitch });
    return await new Promise((resolve, reject) => {
      const chunks = [];
      const timer = setTimeout(() => reject(new Error('Edge voice timed out')), EDGE_TIMEOUT_MS);
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  } finally {
    tts.close();
  }
}

/** Edge's voice, tried twice. */
export async function edgeVoice(text, lang, rate, pitch, { synth = edgeOnce, retryMs = EDGE_RETRY_MS } = {}) {
  try {
    return await synth(text, lang, rate, pitch);
  } catch (err) {
    await wait(retryMs);
    return synth(text, lang, rate, pitch);
  }
}

/** Google reads at most ~200 characters a request: cut at a sentence end, else a comma, else a space. */
export function splitForGoogle(text, max = GOOGLE_MAX_CHARS) {
  const parts = [];
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    const cut = [/[।.!?](?=\s)/g, /[,;:](?=\s)/g, /\s/g].reduce((found, re) => {
      if (found > 0) return found;
      let last = -1;
      let m;
      while ((m = re.exec(head)) !== null) last = m.index + 1;
      return last;
    }, -1);
    const at = cut > 0 ? cut : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Google Translate's voice: one MP3 per piece, joined (MP3 frames play back to back). */
export async function googleVoice(text, lang, { fetchFn = fetch } = {}) {
  const buffers = [];
  for (const piece of splitForGoogle(text)) {
    const url = `${GOOGLE_URL}?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(piece)}`;
    const res = await fetchFn(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Google voice HTTP ${res.status}`);
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(buffers);
}

/** Which voice answered last, and the last failure: shown on GET /health so a silent TV can be explained. */
const status = { lastOk: null, lastError: null };
export const ttsStatus = () => ({ ...status });

/** MP3 for a line: Edge, else Google. Throws only when both fail. */
export async function synthesize(text, lang, rate, pitch, deps = {}) {
  const errors = [];
  if (process.env.SCORE_LIVE_TTS_EDGE !== 'off') {
    try {
      const mp3 = await (deps.edge || edgeVoice)(text, lang, rate, pitch);
      if (mp3.length) return { mp3, provider: 'edge' };
      errors.push('edge: empty audio');
    } catch (err) {
      errors.push(`edge: ${err.message}`);
    }
  }
  try {
    const mp3 = await (deps.google || googleVoice)(text, lang);
    if (mp3.length) return { mp3, provider: 'google', errors };
    errors.push('google: empty audio');
  } catch (err) {
    errors.push(`google: ${err.message}`);
  }
  throw new Error(errors.join(' | '));
}

export function ttsRouter(deps = {}) {
  const router = express.Router();
  /* Board lines repeat all day (same names, same scores): keep recent ones. */
  const cache = new Map();

  router.get('/api/tts', async (req, res) => {
    const text = String(req.query.text || '').trim().slice(0, MAX_CHARS);
    const lang = VOICES[req.query.lang] ? req.query.lang : 'hi';
    if (!text) return res.status(400).json({ error: 'text required' });
    const rate = percent(req.query.rate);
    const pitch = percent(req.query.pitch);
    const key = `${lang}|${rate}|${pitch}|${text}`;
    try {
      let hit = cache.get(key);
      if (!hit) {
        const made = await synthesize(text, lang, rate, pitch, deps);
        if (made.errors?.length) console.error(`[score-live] Edge voice failed, used Google: ${made.errors.join(' | ')}`);
        hit = { mp3: made.mp3, provider: made.provider };
        cache.set(key, hit);
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
        status.lastOk = { provider: made.provider, at: new Date().toISOString() };
      }
      res.type('audio/mpeg').set({ 'Cache-Control': 'public, max-age=86400', 'X-TTS-Provider': hit.provider }).send(hit.mp3);
    } catch (err) {
      status.lastError = { message: err.message, at: new Date().toISOString() };
      console.error('[score-live] TTS failed:', err.message);
      res.status(502).json({ error: 'TTS failed' });
    }
  });
  return router;
}
