/* The TV's voice. At each scheduled time (and with the V key) it either reads the
   slides or speaks one summary. Reading the slides, the voice sets the pace: the
   rotation goes back to its first board and holds each board — and each person of
   the one-by-one board — until its lines have been said, rings the bell, moves on,
   and hands the timing back after one full cycle (non-stop: never). With no voice
   playing the boards keep their own timing. A scheduled time plays once per screen,
   even where the browser cannot keep what it played. */
import { storageGet, storageSet } from '../dom.js';
import { VOICE_DEFAULTS } from './voiceModel.js';
import { dueSlot } from './schedule.js';
import { boardLines, introLine, outroLine, personLines, summaryLines } from './script.js';
import { SpeechBlockedError, ringBell, speakLines } from './speech.js';
import { isScreenOn } from './local.js';

const TICK_MS = 20 * 1000;
const PLAYED_KEY = 'scorelive.voice.played';
const MAX_PLAYED = 60;
/* A narration hands the timing back after this long whatever happens (a voice that hangs, a cycle that never closes). */
const MAX_NARRATION_MS = 15 * 60 * 1000;
const PEOPLE_BOARD = 'crm-people';

/* Times already played: kept in memory for this page too, since a TV browser may not keep localStorage. */
const playedHere = new Set();
function readPlayed() {
  let stored = [];
  try { stored = JSON.parse(storageGet(PLAYED_KEY) || '[]'); } catch (e) { stored = []; }
  return [...new Set([...(Array.isArray(stored) ? stored : []), ...playedHere])];
}
function markPlayed(key) {
  playedHere.add(key);
  storageSet(PLAYED_KEY, JSON.stringify(readPlayed().slice(-MAX_PLAYED)));
}
function unmarkPlayed(key) {
  playedHere.delete(key);
  storageSet(PLAYED_KEY, JSON.stringify(readPlayed().filter((k) => k !== key)));
}

/** getData(): latest payload · getPeriods(): { crm, sales } keys on screen · onBlockedChange(): sound got blocked/unblocked. */
export function createAnnouncer({ getData, getPeriods, onBlockedChange }) {
  let voice = VOICE_DEFAULTS;
  let boardId = null;
  let rotation = null; // rotation.js: holdForVoice, first, current, go, step, peekNext, nextPage
  let narration = null; // { key, endless, startedAt, firstId, turn, hasIntro, guard } while the slides are read
  let isBlocked = false;
  let isSummaryBusy = false;

  function setBlocked(next) {
    if (next === isBlocked) return;
    isBlocked = next;
    onBlockedChange();
  }

  /** 'done' once said (or failed for good), 'superseded' when something newer took over, 'blocked' when the browser stopped sound. */
  async function say(lines, settings = voice) {
    if (!lines.length) return 'done';
    try {
      const isFinished = await speakLines(lines, settings);
      setBlocked(false);
      return isFinished ? 'done' : 'superseded';
    } catch (err) {
      if (err instanceof SpeechBlockedError) {
        setBlocked(true);
        return 'blocked';
      }
      // A line that failed for good: move on rather than hold the slides.
      console.error('[score-live] voice:', err);
      return 'done';
    }
  }

  /* This screen speaks on its own: every screen does, unless the settings keep it to the chosen ones. */
  const speaksHere = () => voice.screens !== 'chosen' || isScreenOn();
  const linesFor = (id) => boardLines(id, getData(), getPeriods(), voice);
  const isNonStop = () => voice.enabled && voice.mode === 'slides' && voice.nonStop;

  function endNarration(isComplete) {
    const n = narration;
    if (!n) return;
    narration = null;
    clearTimeout(n.guard);
    if (rotation) rotation.holdForVoice(false);
    if (!isComplete && n.key) unmarkPlayed(n.key);
  }

  /** Read the slides from the first board; key = the scheduled time it plays (null for V / non-stop). */
  function beginNarration(key, { endless = false } = {}) {
    if (!rotation || !getData()) return false;
    const first = rotation.first();
    if (!first) return false;
    endNarration(true);
    narration = { key, endless, startedAt: Date.now(), firstId: first, turn: 0, hasIntro: false, guard: null };
    narration.guard = setTimeout(() => endNarration(true), MAX_NARRATION_MS);
    // Marked at the start, so a slow or interrupted reading can never start again; a blocked one is unmarked.
    if (key) markPlayed(key);
    rotation.holdForVoice(true);
    if (rotation.current() !== first) rotation.go(first); // boardShown(first) reads it once it is on screen
    else if (first === PEOPLE_BOARD) rotation.restartCurrent(); // its first card comes up again and is read
    else readSlide(first);
    return true;
  }

  /* One turn of the narration: the bell rang between slides already, so only the opening gets the tone and the greeting. */
  async function narrate(lines) {
    const n = narration;
    const isOpening = !n.hasIntro;
    n.hasIntro = true;
    n.turn += 1;
    const turn = n.turn;
    const result = await say(isOpening ? [introLine(voice), ...lines] : lines, isOpening ? voice : { ...voice, chime: 'none' });
    return { result, isCurrent: narration === n && n.turn === turn };
  }

  async function readSlide(id) {
    // The one-by-one board is read per person as each card comes up (personShown).
    if (!narration || id === PEOPLE_BOARD) return;
    const { result, isCurrent } = await narrate(linesFor(id));
    if (!isCurrent) return;
    if (result === 'blocked') { endNarration(false); return; }
    await nextSlide({ bell: true });
  }

  /* Bell, then the next slide (it is read once it is on screen); after a full cycle the closing words. */
  async function nextSlide({ bell }) {
    const n = narration;
    if (bell) await ringBell(voice);
    if (narration !== n || !rotation) return;
    const next = rotation.peekNext();
    if (!n.endless && (!next || next === n.firstId || Date.now() - n.startedAt > MAX_NARRATION_MS)) {
      const { isCurrent } = await narrate([outroLine(voice)]);
      if (isCurrent) endNarration(true);
      return;
    }
    if (next === rotation.current()) readSlide(next); // a rotation of one board
    else rotation.step(1);
  }

  async function tick() {
    if (narration || isSummaryBusy || !speaksHere() || !getData()) return;
    if (isNonStop()) { beginNarration(null, { endless: true }); return; }
    if (!voice.enabled) return;
    const key = dueSlot(voice, new Date(), readPlayed());
    if (!key) return;
    if (voice.mode === 'slides') { beginNarration(key); return; }
    isSummaryBusy = true;
    markPlayed(key);
    try {
      if (await say(summaryLines(getData(), getPeriods(), voice)) === 'blocked') unmarkPlayed(key);
    } finally {
      isSummaryBusy = false;
    }
  }

  setInterval(tick, TICK_MS);
  // A click or key press is what the browser waits for: retry a blocked time at once.
  const pointer = window.PointerEvent ? ['pointerdown'] : ['mousedown', 'touchstart'];
  [...pointer, 'keydown'].forEach((type) => window.addEventListener(type, () => { if (isBlocked) tick(); }));

  return {
    setVoice(next) {
      voice = next || VOICE_DEFAULTS;
      // Non-stop switched off, or this screen no longer speaks: the boards get their own timing back.
      if (narration && narration.endless && (!isNonStop() || !speaksHere())) endNarration(true);
    },
    /** rotation.js, which the voice paces while it reads the slides. */
    setRotation(next) { rotation = next; },
    /** The rotation showed a board (or null). A refresh of the same board says nothing. */
    boardShown(id) {
      if (id === boardId) return;
      boardId = id;
      if (id && narration) readSlide(id);
    },
    /** The one-by-one board brought up a person's card: read it, bell, next person (or the next board after the last). */
    async personShown(board, index) {
      if (!narration || boardId !== PEOPLE_BOARD || !board) return;
      const { result, isCurrent } = await narrate(personLines(board, index, voice));
      if (!isCurrent) return;
      if (result === 'blocked') { endNarration(false); return; }
      const n = narration;
      await ringBell(voice);
      if (narration !== n) return;
      if (!rotation.nextPage()) await nextSlide({ bell: false });
    },
    /** V key: read out now in the chosen mode, whatever the schedule says. */
    speakNow() {
      if (voice.mode === 'slides') beginNarration(null);
      else say(summaryLines(getData(), getPeriods(), voice));
    },
    isBlocked: () => isBlocked,
    /** Voice on, but this screen is not one that speaks (rail hint). */
    isSilentHere: () => voice.enabled && !speaksHere(),
  };
}
