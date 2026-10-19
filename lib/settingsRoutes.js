// GET/PUT /api/settings. PUT is guarded by SETTINGS_PIN (header x-settings-pin) when one is set.
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { createPinGuard } from './pinGuard.js';

const JSON_LIMIT = '16kb';

/** Constant-time PIN check; no PIN configured = anyone on the network may save. */
function isPinValid(pin, given) {
  if (!pin) return true;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(pin);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Settings as sent to screens: the stored values plus whether a save needs the PIN. */
export const withMeta = (settings, pin = process.env.SETTINGS_PIN) => ({ ...settings, pinRequired: Boolean(pin) });

export function settingsRouter({ store, pin = '', onSaved }) {
  const router = express.Router();
  const guard = createPinGuard();

  router.get('/api/settings', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(withMeta(store.get(), pin));
  });

  router.put('/api/settings', express.json({ limit: JSON_LIMIT }), async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON' });
    if (pin) {
      const waitSec = guard.retryAfterSec(req.ip);
      if (waitSec) return res.status(429).set('Retry-After', String(waitSec)).json({ error: 'Too many wrong PINs, try again later' });
      if (!isPinValid(pin, req.get('x-settings-pin'))) {
        guard.fail(req.ip);
        return res.status(401).json({ error: 'Wrong or missing settings PIN' });
      }
      guard.succeed(req.ip);
    }
    try {
      const { settings, errors } = await store.update(req.body);
      if (errors.length) return res.status(400).json({ error: 'Invalid settings', errors });
      onSaved(settings);
      res.json(withMeta(settings, pin));
    } catch (err) {
      console.error(`[score-live] saving settings failed: ${err.message}`);
      res.status(500).json({ error: 'Could not save settings' });
    }
  });

  /* express.json errors (bad JSON, body too large) answer as JSON, not an HTML page. */
  router.use((err, _req, res, next) => {
    if (!err?.status || err.status >= 500) return next(err);
    res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Settings body too large' : 'Body must be valid JSON' });
  });

  return router;
}
