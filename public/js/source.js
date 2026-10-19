/* Where the scores come from: the Score Live server (fetch + socket.io) or mock.json. */
import { mutateMock, padMock } from './mockDrift.js';

const MOCK_TICK_MS = 12000;
/* Without the socket (blocked by the TV's browser or the network), the board still refreshes over plain HTTP. */
const FALLBACK_POLL_MS = 30 * 1000;
const STALE_MS = 3 * 60 * 1000;

/** handlers: { onScores, onSettings, onConn } */
export function startLive({ onScores, onSettings, onConn }) {
  let isConnected = false;
  let lastScoresAt = 0;
  const receive = (json) => {
    lastScoresAt = Date.now();
    onScores(json);
  };
  const fetchScores = () => {
    // cache: 'no-store' is ignored before Chrome 64, so old TVs also get a cache-busting query.
    fetch(`/api/scores?_=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        // A drawing error must reach window.onerror (on-screen box + server log), not vanish in this promise.
        try { receive(json); } catch (err) { setTimeout(() => { throw err; }); }
      })
      .catch(() => { /* server unreachable: the socket or the next try delivers the board */ });
  };
  fetchScores();
  setInterval(() => {
    if (!isConnected || Date.now() - lastScoresAt > STALE_MS) fetchScores();
  }, FALLBACK_POLL_MS);
  const script = document.createElement('script');
  script.src = '/socket.io/socket.io.js';
  script.onload = () => {
    const socket = window.io({ reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000 });
    const setConnected = (state) => { isConnected = state === 'live'; onConn(state); };
    socket.on('connect', () => setConnected('live'));
    socket.on('disconnect', () => setConnected('reconnecting'));
    socket.on('connect_error', () => setConnected('reconnecting'));
    socket.io.on('reconnect_failed', () => setConnected('offline'));
    socket.on('scores', receive);
    socket.on('settings', onSettings);
  };
  script.onerror = () => onConn('offline');
  document.head.appendChild(script);
}

export function startMock({ onScores, onConn, padRows, still }) {
  let latest = null;
  fetch(`mock.json?_=${Date.now()}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((json) => {
      json.updatedAt = new Date().toISOString();
      latest = padMock(json, padRows);
      onScores(latest);
      if (still) return;
      setInterval(() => { latest = mutateMock(latest); onScores(latest); }, MOCK_TICK_MS);
    })
    .catch((err) => { console.error('[score-live] mock.json failed', err); onConn('offline'); });
}
