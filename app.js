import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { createCrmClient } from './lib/crmClient.js';
import { createPoller } from './lib/poller.js';
import { createSettingsStore } from './lib/settings.js';
import { settingsRouter, withMeta } from './lib/settingsRoutes.js';
import { buildLegacy, LEGACY_ENTRIES } from './lib/legacyBuild.js';
import { ttsRouter, ttsStatus } from './lib/tts.js';

const DEFAULT_POLL_SECONDS = 120;
const MIN_POLL_SECONDS = 30;
const DEFAULT_PORT = 4000;
const REQUIRED_ENV = ['CRM_BASE_URL', 'FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID', 'CRM_EMAIL', 'CRM_PASSWORD'];

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[score-live] Missing in .env: ${missing.join(', ')} (see .env.example)`);
  process.exit(1);
}

const pollSeconds = Math.max(MIN_POLL_SECONDS, Number(process.env.POLL_SECONDS) || DEFAULT_POLL_SECONDS);
const port = Number(process.env.PORT) || DEFAULT_PORT;
const here = path.dirname(fileURLToPath(import.meta.url));
const settings = createSettingsStore(path.join(here, 'data', 'settings.json'));
await settings.load();

const client = createCrmClient({
  baseUrl: process.env.CRM_BASE_URL.replace(/\/+$/, ''),
  apiKey: process.env.FIREBASE_API_KEY,
  projectId: process.env.FIREBASE_PROJECT_ID,
  email: process.env.CRM_EMAIL,
  password: process.env.CRM_PASSWORD,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const poller = createPoller({
  client,
  pollSeconds,
  onScores: payload => io.emit('scores', payload),
  // The CRM MIS page's From–To dates for the CRM board's "Custom" period.
  getCustom: () => settings.get().crmCustom,
});
const customKey = () => JSON.stringify(settings.get().crmCustom || null);
let lastCustom = customKey();

// The pages load these ES5 bundles so old smart-TV browsers can run them too.
// If the build fails, fall back to the ES modules (fine on any current browser).
const publicDir = path.join(here, 'public');
let legacy = {};
try {
  legacy = await buildLegacy(publicDir);
} catch (err) {
  console.error('[score-live] Old-TV build failed, serving modern JS only:', err.message);
}
for (const [url, entry] of Object.entries(LEGACY_ENTRIES)) {
  const fallback = `(function(){var s=document.createElement('script');s.type='module';s.src=${JSON.stringify(entry)};document.body.appendChild(s);})();`;
  app.get(url, (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-cache').send(legacy[url] || fallback);
  });
}

app.use(express.static(publicDir));
app.use(ttsRouter());

app.use(settingsRouter({
  store: settings,
  pin: process.env.SETTINGS_PIN || '',
  onSaved: saved => {
    io.emit('settings', withMeta(saved));
    // New custom dates: redraw the CRM board now instead of at the next poll.
    if (customKey() !== lastCustom) {
      lastCustom = customKey();
      poller.recompute();
    }
  },
}));

// Screens report what they can't show (e.g. no voice on a TV) here, since a TV has no console.
app.post('/api/client-log', express.json({ limit: '2kb' }), (req, res) => {
  console.error(`[score-live] Screen ${req.ip}: ${JSON.stringify(req.body).slice(0, 500)}`);
  res.status(204).end();
});

app.get('/api/scores', (_req, res) => {
  const latest = poller.latest();
  if (!latest) return res.status(503).json({ error: 'First load still in progress' });
  res.set('Cache-Control', 'no-store').json(latest);
});

app.get('/health', (_req, res) => {
  const latest = poller.latest();
  res.json({ ok: Boolean(latest), updatedAt: latest?.updatedAt ?? null, status: latest?.status ?? null, tts: ttsStatus() });
});

// A screen that connects (or reconnects after a network drop) gets the
// settings and the current boards immediately instead of waiting for the next poll.
const seenBrowsers = new Set();
io.on('connection', socket => {
  // Log each new screen's browser once, so an old TV that misbehaves can be identified.
  const ua = socket.handshake.headers['user-agent'] || 'unknown';
  if (!seenBrowsers.has(ua)) {
    seenBrowsers.add(ua);
    console.error(`[score-live] Screen connected from ${socket.handshake.address}: ${ua}`);
  }
  socket.emit('settings', withMeta(settings.get()));
  const latest = poller.latest();
  if (latest) socket.emit('scores', latest);
});

server.on('error', err => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`[score-live] Port ${port} is already in use: Score Live (or another app) is already running.`);
  console.error(`[score-live] Open http://localhost:${port}, or close the other window first (or set PORT in .env).`);
  process.exit(1);
});

server.listen(port, () => {
  console.error(`[score-live] TV page: http://localhost:${port}  (polling CRM every ${pollSeconds}s)`);
  poller.start();
});

function shutdown() {
  poller.stop();
  io.close();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
