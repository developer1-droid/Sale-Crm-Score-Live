/* When the automatic voice plays: every chosen time on every active day (daily =
   every day, weekly = the chosen weekdays). Pure. Times are the office's IST clock
   whatever the screen's own time zone: an Android TV left on UTC shows the right
   time on the board (status.js formats in IST) but would otherwise speak 5½ hours late. */

/* A screen opened up to 10 minutes after a time still plays it; later, it waits for the next one. */
export const GRACE_MS = 10 * 60 * 1000;
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const IST_OFFSET_MS = 330 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');
/* The IST calendar day of an instant (IST has no daylight saving). */
const istDay = (d) => new Date(d.getTime() + IST_OFFSET_MS);
const dayKey = (d) => { const t = istDay(d); return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`; };

export const isActiveDay = (voice, day) => voice.frequency === 'daily' || voice.weekdays.includes(istDay(day).getUTCDay());

/** The instant `time` (HH:MM, IST) falls on, on the IST day of `day`. */
function slotAt(day, time) {
  const [h, m] = time.split(':').map(Number);
  const t = istDay(day);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), h, m, 0, 0) - IST_OFFSET_MS);
}

/** Key ('YYYY-MM-DD HH:MM') of the time to play at `now`, or null. `played` = keys this screen already spoke. */
export function dueSlot(voice, now, played = []) {
  if (!voice.enabled || !isActiveDay(voice, now)) return null;
  const time = voice.times.find((t) => {
    const age = now - slotAt(now, t);
    return age >= 0 && age < GRACE_MS && !played.includes(`${dayKey(now)} ${t}`);
  });
  return time ? `${dayKey(now)} ${time}` : null;
}

/** "Every day at 10:00, 16:30" / "Mon, Thu at 10:00" for the settings page. */
export function scheduleLabel(voice) {
  const days = voice.frequency === 'daily' ? 'Every day' : voice.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ');
  return `${days} at ${[...voice.times].sort().join(', ')} IST`;
}
