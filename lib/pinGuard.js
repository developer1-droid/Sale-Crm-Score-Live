// Per-IP lockout for wrong settings PINs: after MAX_FAILURES within WINDOW_MS the
// caller must wait out the window before the PIN is compared again.

const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1000;

export function createPinGuard({ maxFailures = MAX_FAILURES, windowMs = WINDOW_MS, now = Date.now } = {}) {
  const failures = new Map(); // ip -> { count, firstAt }

  const current = (ip) => {
    const entry = failures.get(ip);
    if (entry && now() - entry.firstAt >= windowMs) failures.delete(ip);
    return failures.get(ip);
  };

  return {
    /** Seconds the caller must wait, or 0 when it may try. */
    retryAfterSec(ip) {
      const entry = current(ip);
      if (!entry || entry.count < maxFailures) return 0;
      return Math.max(1, Math.ceil((entry.firstAt + windowMs - now()) / 1000));
    },
    fail(ip) {
      const entry = current(ip);
      if (entry) entry.count += 1;
      else failures.set(ip, { count: 1, firstAt: now() });
    },
    succeed(ip) {
      failures.delete(ip);
    },
  };
}
