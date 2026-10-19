/* Where settings live: the server (shared by every TV) or, in demo mode, this browser. */
import { sanitizeSettings, DEFAULT_SETTINGS } from './settingsModel.js';
import { storageGet, storageSet } from './dom.js';

const MOCK_KEY = 'scorelive.mock-settings';
const CACHE_KEY = 'scorelive.settings';
const PIN_KEY = 'scorelive.pin';

export class PinError extends Error {
  constructor(message) {
    super(message);
    // Keeps `instanceof PinError` working in the ES5 build for old TV browsers.
    Object.setPrototypeOf(this, PinError.prototype);
  }
}

function readJson(key) {
  try { return JSON.parse(storageGet(key) || 'null'); } catch (e) { return null; }
}

export function createSettingsStore({ mock }) {
  const key = mock ? MOCK_KEY : CACHE_KEY;
  let pinRequired = false;

  /** Last known settings, synchronously (first paint before the server answers). */
  const cached = () => sanitizeSettings(readJson(key) || DEFAULT_SETTINGS);
  const remember = (s) => { storageSet(key, JSON.stringify(s)); return s; };

  async function load() {
    if (mock) return cached();
    const res = await fetch(`/api/settings?_=${Date.now()}`, { cache: 'no-store' }); // query: old TVs ignore no-store
    if (!res.ok) throw new Error(`GET /api/settings ${res.status}`);
    const body = await res.json();
    pinRequired = body.pinRequired === true;
    return remember(sanitizeSettings(body));
  }

  async function save(partial, pin) {
    if (mock) return remember(sanitizeSettings(partial, cached()));
    const usePin = pin ?? sessionPin();
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(usePin ? { 'x-settings-pin': usePin } : {}) },
      body: JSON.stringify(partial),
    });
    if (res.status === 401) throw new PinError('PIN required');
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
    if (usePin) { try { sessionStorage.setItem(PIN_KEY, usePin); } catch (e) { /* not remembered */ } }
    return remember(sanitizeSettings(await res.json()));
  }

  /** Demo mode: another tab saved settings in this browser. */
  function onExternalChange(fn) {
    window.addEventListener('storage', (e) => { if (e.key === key && e.newValue) fn(cached()); });
  }

  return { cached, load, save, onExternalChange, remember, pinRequired: () => pinRequired };
}

function sessionPin() {
  try { return sessionStorage.getItem(PIN_KEY); } catch (e) { return null; }
}
