/* What this browser keeps for the voice: whether THIS screen speaks (the
   schedule is shared, but each TV or laptop decides, and it starts off), and
   the last board, so the settings page can test with real names. */
import { storageGet, storageSet } from '../dom.js';

const SCREEN_KEY = 'scorelive.voice.thisScreen';
const LAST_SCORES_KEY = 'scorelive.last-scores';

export const isScreenOn = () => storageGet(SCREEN_KEY) === 'on';
export const setScreenOn = (on) => storageSet(SCREEN_KEY, on ? 'on' : 'off');

export const rememberScores = (payload) => storageSet(LAST_SCORES_KEY, JSON.stringify(payload));
export function lastScores() {
  try { return JSON.parse(storageGet(LAST_SCORES_KEY) || 'null'); } catch (e) { return null; }
}
