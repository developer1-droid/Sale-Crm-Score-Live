/* Theme = ?theme= > this screen's T-key override > the shared default from settings.
   The override only lasts until the shared default changes; then it is dropped, so
   an old T-key choice cannot come back when the shared default returns to the value
   it once overrode. */
import { storageGet, storageSet } from './dom.js';
import { THEMES } from './settingsModel.js';

const OVERRIDE_KEY = 'scorelive.theme-override';
const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

export const resolveTheme = (mode) => (mode === 'auto' ? (lightQuery.matches ? 'light' : 'dark') : mode === 'light' ? 'light' : 'dark');
export const applyResolved = (mode) => document.documentElement.setAttribute('data-theme', resolveTheme(mode));

function readOverride() {
  try { return JSON.parse(storageGet(OVERRIDE_KEY) || 'null'); } catch (e) { return null; }
}

export function createTheme({ urlTheme, shared }) {
  let sharedMode = shared;
  let override = readOverride();
  const fromUrl = THEMES.includes(urlTheme) ? urlTheme : null;
  const dropOverride = () => {
    override = null;
    storageSet(OVERRIDE_KEY, null);
  };
  if (override && override.over !== sharedMode) dropOverride();

  const mode = () => fromUrl || (override ? override.mode : sharedMode);
  const apply = () => applyResolved(mode());

  lightQuery.addEventListener('change', apply);
  apply();

  return {
    setShared(next) {
      if (next !== sharedMode) dropOverride();
      sharedMode = next;
      apply();
    },
    toggle() {
      const next = resolveTheme(mode()) === 'dark' ? 'light' : 'dark';
      override = { mode: next, over: sharedMode };
      storageSet(OVERRIDE_KEY, JSON.stringify(override));
      apply();
    },
    resolved: () => resolveTheme(mode()),
  };
}
