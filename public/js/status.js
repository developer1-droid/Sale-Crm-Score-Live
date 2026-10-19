/* Masthead clock (IST) + the live / stale connection badge. */
import { $ } from './dom.js';

const IST = 'Asia/Kolkata';
const STALE_FACTOR = 3;
const LABELS = { demo: 'Demo', connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', offline: 'Offline', stale: 'Stale' };

/* TV builds with a small ICU throw on the time zone: compute IST (UTC+5:30) by hand, same strings. */
const IST_OFFSET_MS = 330 * 60000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// en-GB writes September as 'Sept' in current ICU.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');
const manualFmt = (fn) => ({ format: (d) => fn(new Date(d.getTime() + IST_OFFSET_MS)) });

let timeFmt;
let secFmt;
let dateFmt;
try {
  timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: IST });
  secFmt = new Intl.DateTimeFormat('en-GB', { second: '2-digit', timeZone: IST });
  dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: IST });
} catch (e) {
  timeFmt = manualFmt((d) => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`);
  secFmt = manualFmt((d) => two(d.getUTCSeconds()));
  dateFmt = manualFmt((d) => `${DAYS[d.getUTCDay()]} ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`);
}

function agoText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `Updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Updated ${m} min ago`;
  return `Updated ${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export function createStatus(initialState) {
  let conn = initialState;
  let updatedAt = null;
  let pollSeconds = 120;

  function paint() {
    const age = updatedAt ? Date.now() - updatedAt : null;
    const state = conn === 'live' && age !== null && age > pollSeconds * 1000 * STALE_FACTOR ? 'stale' : conn;
    $('conn').dataset.state = state;
    $('connLabel').textContent = LABELS[state] || state;
    $('ago').textContent = age === null ? '' : agoText(age);
  }

  function tick() {
    const now = new Date();
    $('clockTime').textContent = timeFmt.format(now);
    $('clockSec').textContent = `:${secFmt.format(now).padStart(2, '0')}`;
    $('clockDate').textContent = `${dateFmt.format(now)} · IST`;
    paint();
  }
  tick();
  setInterval(tick, 1000);

  return {
    setConn(state) { conn = state; paint(); },
    hasData: () => updatedAt !== null,
    setData(payload) {
      updatedAt = payload.updatedAt ? Date.parse(payload.updatedAt) : Date.now();
      pollSeconds = Number(payload.pollSeconds) || pollSeconds;
      paint();
    },
  };
}
