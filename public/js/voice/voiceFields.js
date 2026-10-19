/* Settings page · Voice: edits settings.voice (shared by every screen), this
   screen's own on/off, and a Test that plays the draft with the last board this
   browser showed. */
import { $, el } from '../dom.js';
import {
  MAX_VOICE_TIMES, VOICE_CHIMES, VOICE_ENGINES, VOICE_SCREENS, VOICE_FREQUENCIES, VOICE_LANGUAGES, VOICE_LIMITS, VOICE_MODES, VOICE_SECTIONS, VOICE_STYLES,
} from './voiceModel.js';
import { WEEKDAY_NAMES, scheduleLabel } from './schedule.js';
import { isScreenOn, lastScores, setScreenOn } from './local.js';
import { summaryLines } from './script.js';
import { browserVoices, forgetBrowserFailed, speakLines, stopSpeaking, voiceReport } from './speech.js';

const LABELS = {
  mode: { slides: 'Follow the slides', summary: 'One summary' },
  modeHint: {
    slides: 'Each board is read out as it comes on screen, in the slide order, so the voice always matches the screen.',
    summary: 'One short update with CRM and Sales together.',
  },
  frequency: { daily: 'Every day', weekly: 'Chosen days' },
  sections: {
    leaders: 'Top performers', delays: 'Delays: who is late and by how much', bottom: 'Lowest score',
    team: 'Team totals', payments: 'Advance / balance due',
  },
  language: { hi: 'Hindi', en: 'English' },
  style: { friendly: 'Friendly', formal: 'Formal', energetic: 'Josh' },
  chime: { none: 'None', bell: 'Bell', ding: 'Ding', double: 'Double beep' },
  screens: { all: 'Every screen', chosen: 'Only screens switched on' },
  engine: { server: 'Online voice (server)', auto: 'Auto', browser: 'This screen’s voice' },
  engineHint: {
    server: 'Recommended for TVs: the server PC makes the voice (needs its internet), so every screen sounds the same.',
    auto: 'This screen’s own voice when it has a working one for the language, else the online voice.',
    browser: 'This screen’s own voice; the online voice only steps in when it stays silent.',
  },
};
/* name of each radio group → the voice field it sets */
const RADIOS = { voiceScreens: 'screens', voiceMode: 'mode', voiceFrequency: 'frequency', voiceLanguage: 'language', voiceStyle: 'style', voiceChime: 'chime', voiceEngine: 'engine' };
const RANGES = { voiceVolume: 'volume', voiceRate: 'rate', voicePitch: 'pitch' };
const COUNTS = { voiceTopCount: 'topCount', voiceDelayCount: 'delayCount' };
const TEST_NOTE = 'Plays the settings above, even before Save.';
const FREE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const percent = (v) => `${Math.round(v * 100)}%`;
const times = (v) => `${v.toFixed(1)}×`;
const FORMATS = { volume: percent, rate: times, pitch: times };

function seg(host, name, values, labels) {
  host.replaceChildren(...values.map((value) => {
    const label = el('label');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    label.append(input, el('span', '', labels[value]));
    return label;
  }));
}

function option(value, text) {
  const node = el('option', '', text);
  node.value = value;
  return node;
}

function fillCounts(select, { min, max }) {
  select.replaceChildren(...Array.from({ length: max - min + 1 }, (_, i) => option(String(min + i), String(min + i))));
}

function timeRow(index) {
  const row = el('li', 'time-row');
  const input = el('input');
  input.type = 'time';
  input.required = true;
  input.dataset.timeIndex = String(index);
  input.setAttribute('aria-label', `Time ${index + 1}`);
  const remove = el('button', 'icon-btn', '×');
  remove.type = 'button';
  remove.dataset.removeTime = String(index);
  remove.setAttribute('aria-label', `Remove time ${index + 1}`);
  row.append(input, remove);
  return row;
}

const setRadio = (name, value) => document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === value; });
function freeTime(taken) {
  const used = new Set(taken);
  return FREE_HOURS.map((h) => `${String(h).padStart(2, '0')}:00`).find((t) => !used.has(t));
}

/** onChange(voice): the edited voice object · getPeriods(): { crm, sales } the draft opens boards on. */
export function createVoiceFields({ onChange, getPeriods }) {
  let voice = null;

  seg($('voiceMode'), 'voiceMode', VOICE_MODES, LABELS.mode);
  seg($('voiceFrequency'), 'voiceFrequency', VOICE_FREQUENCIES, LABELS.frequency);
  seg($('voiceLanguage'), 'voiceLanguage', VOICE_LANGUAGES, LABELS.language);
  seg($('voiceStyle'), 'voiceStyle', VOICE_STYLES, LABELS.style);
  seg($('voiceChime'), 'voiceChime', VOICE_CHIMES, LABELS.chime);
  seg($('voiceEngine'), 'voiceEngine', VOICE_ENGINES, LABELS.engine);
  seg($('voiceScreens'), 'voiceScreens', VOICE_SCREENS, LABELS.screens);
  $('voiceDays').replaceChildren(...WEEKDAY_NAMES.map((name, day) => {
    const btn = el('button', 'day', name);
    btn.type = 'button';
    btn.dataset.day = String(day);
    return btn;
  }));
  $('voiceSections').replaceChildren(...VOICE_SECTIONS.map((key) => {
    const label = el('label', 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.dataset.section = key;
    label.append(input, el('span', '', LABELS.sections[key]));
    return label;
  }));
  fillCounts($('voiceTopCount'), VOICE_LIMITS.topCount);
  fillCounts($('voiceDelayCount'), VOICE_LIMITS.delayCount);

  const change = (partial) => onChange({ ...voice, ...partial });

  function renderTimes() {
    const list = $('voiceTimes');
    if (list.children.length !== voice.times.length) list.replaceChildren(...voice.times.map((_, i) => timeRow(i)));
    [...list.children].forEach((row, i) => {
      const input = row.querySelector('input');
      if (input.value !== voice.times[i]) input.value = voice.times[i];
      row.querySelector('button').disabled = voice.times.length === 1;
    });
    $('voiceTimesCount').textContent = `· ${voice.times.length} a day`;
    $('voiceAddTime').disabled = voice.times.length >= MAX_VOICE_TIMES;
  }

  function renderVoices() {
    const forLanguage = browserVoices().filter((v) => (v.lang || '').toLowerCase().startsWith(voice.language));
    const names = forLanguage.map((v) => v.name);
    const options = [option('', `Best ${LABELS.language[voice.language]} voice on each screen`), ...names.map((n) => option(n, n))];
    if (voice.voiceName && !names.includes(voice.voiceName)) options.push(option(voice.voiceName, `${voice.voiceName} (not on this screen)`));
    $('voiceName').replaceChildren(...options);
    $('voiceName').value = voice.voiceName;
    $('voiceNameHint').textContent = forLanguage.length
      ? 'Voices differ between browsers; a screen without the chosen one uses its best match.'
      : `This browser has no ${LABELS.language[voice.language]} voice, so it will use its default one.`;
  }

  function render(next) {
    voice = next;
    const isNonStop = voice.mode === 'slides' && voice.nonStop;
    $('voiceScreen').checked = isScreenOn();
    $('voiceScreenWrap').hidden = voice.screens !== 'chosen';
    $('voiceEnabled').checked = voice.enabled;
    $('voiceEnabledHint').textContent = !voice.enabled
      ? 'Off: a board only speaks when someone presses V'
      : `${isNonStop ? 'Non-stop, with every slide' : scheduleLabel(voice)}. Only the board page speaks: go back to it and keep it open, this settings page stays silent.`;
    Object.entries(RADIOS).forEach(([name, key]) => setRadio(name, voice[key]));
    $('voiceModeHint').textContent = LABELS.modeHint[voice.mode];
    $('voiceEngineHint').textContent = LABELS.engineHint[voice.engine];
    $('voiceNameWrap').hidden = voice.engine === 'server';
    $('voiceNonStopWrap').hidden = voice.mode !== 'slides';
    $('voiceNonStop').checked = voice.nonStop;
    $('voiceSounds').checked = voice.sounds;
    $('voiceDaysWrap').hidden = isNonStop;
    $('voiceTimesWrap').hidden = isNonStop;
    $('voiceDays').hidden = voice.frequency !== 'weekly';
    const days = new Set(voice.weekdays);
    $('voiceDays').querySelectorAll('.day').forEach((btn) => btn.setAttribute('aria-pressed', String(days.has(Number(btn.dataset.day)))));
    renderTimes();
    $('voiceSections').querySelectorAll('input').forEach((input) => { input.checked = voice.sections[input.dataset.section]; });
    Object.entries(COUNTS).forEach(([id, key]) => { $(id).value = String(voice[key]); });
    renderVoices();
    Object.entries(RANGES).forEach(([id, key]) => {
      $(id).value = String(voice[key]);
      $(`${id}Out`).textContent = FORMATS[key](voice[key]);
    });
  }

  function setTesting(isTesting) {
    $('voiceTest').disabled = isTesting;
    $('voiceStop').disabled = !isTesting;
  }

  async function test() {
    setTesting(true);
    $('voiceTestNote').textContent = TEST_NOTE;
    voiceReport(voice).then((report) => {
      $('voiceTestNote').textContent = report;
      // The server logs it too: a TV has no console to read.
      fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: report }) }).catch(() => {});
    });
    // A Test is the way to give this screen's own voice another chance after it once stayed silent.
    if (voice.engine !== 'server') forgetBrowserFailed(voice.language);
    try {
      await speakLines(summaryLines(lastScores(), getPeriods(), voice), voice);
    } catch (err) {
      $('voiceTestNote').textContent = err.message;
      fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voiceError: err.message }) }).catch(() => {});
    } finally {
      setTesting(false);
    }
  }

  function handleChange(t) {
    if (t.id === 'voiceScreen') return setScreenOn(t.checked);
    if (t.id === 'voiceEnabled' || t.id === 'voiceNonStop') return change({ [t.id === 'voiceEnabled' ? 'enabled' : 'nonStop']: t.checked });
    if (t.id === 'voiceSounds') return change({ sounds: t.checked });
    if (t.type === 'radio' && RADIOS[t.name]) {
      const key = RADIOS[t.name];
      return change(key === 'language' ? { language: t.value, voiceName: '' } : { [key]: t.value });
    }
    if (t.dataset.section) return change({ sections: { ...voice.sections, [t.dataset.section]: t.checked } });
    if (t.dataset.timeIndex !== undefined) {
      const at = Number(t.dataset.timeIndex);
      return change({ times: voice.times.map((time, i) => (i === at ? t.value : time)) });
    }
    if (COUNTS[t.id]) return change({ [COUNTS[t.id]]: Number(t.value) });
    if (RANGES[t.id]) return change({ [RANGES[t.id]]: Number(t.value) });
    if (t.id === 'voiceName') change({ voiceName: t.value });
    return undefined;
  }

  function handleClick(btn) {
    if (btn.dataset.day) {
      const day = Number(btn.dataset.day);
      const weekdays = voice.weekdays.includes(day) ? voice.weekdays.filter((d) => d !== day) : [...voice.weekdays, day];
      if (weekdays.length) change({ weekdays });
      return;
    }
    if (btn.dataset.removeTime) {
      change({ times: voice.times.filter((_, i) => i !== Number(btn.dataset.removeTime)) });
      return;
    }
    if (btn.id === 'voiceAddTime') change({ times: [...voice.times, freeTime(voice.times)] });
    else if (btn.id === 'voiceTest') test();
    else if (btn.id === 'voiceStop') { stopSpeaking(); setTesting(false); }
  }

  const host = $('voiceFields');
  // The page's own form handler serves the other groups; voice events stop here.
  host.addEventListener('change', (e) => { e.stopPropagation(); handleChange(e.target); });
  host.addEventListener('input', (e) => {
    const key = RANGES[e.target.id];
    if (key) $(`${e.target.id}Out`).textContent = FORMATS[key](Number(e.target.value));
  });
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && host.contains(btn)) handleClick(btn);
  });
  const synth = window.speechSynthesis;
  const onVoices = () => { if (voice) renderVoices(); };
  // Older TV builds expose speechSynthesis without EventTarget methods.
  if (synth && typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', onVoices);
  else if (synth) synth.onvoiceschanged = onVoices;

  return { render };
}
