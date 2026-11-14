// Rest timer, tracked as an absolute end timestamp (ms since epoch) kept in
// sessionStorage. Remaining time is always computed as end - now, never by
// counting ticks, so a backgrounded tab (iOS suspends background JS) self-corrects
// on return instead of showing a stale, paused value.

const TIMER_KEY = 'vtaper-rest-timer-end';

export function computeRemainingMs(endTimestampMs, nowMs = Date.now()) {
  return Math.max(0, endTimestampMs - nowMs);
}

export function startRestTimer(durationMs) {
  const endTimestampMs = Date.now() + durationMs;
  sessionStorage.setItem(TIMER_KEY, String(endTimestampMs));
  return endTimestampMs;
}

export function getActiveRestTimer() {
  const raw = sessionStorage.getItem(TIMER_KEY);
  if (raw === null) return null;
  const end = Number(raw);
  return Number.isFinite(end) ? end : null;
}

export function clearRestTimer() {
  sessionStorage.removeItem(TIMER_KEY);
}

export function adjustRestTimer(deltaMs) {
  const current = getActiveRestTimer();
  if (current === null) return null;
  // Never move the end before "now", so remaining time cannot go negative.
  const adjusted = Math.max(Date.now(), current + deltaMs);
  sessionStorage.setItem(TIMER_KEY, String(adjusted));
  return adjusted;
}
