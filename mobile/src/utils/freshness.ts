export type Freshness = 'LIVE' | 'STALE' | 'UNAVAILABLE';

export const LIVE_WINDOW_MS = 60_000;

/**
 * Freshness is derived from the age of the fix, never from "we have a value".
 * A coordinate older than the live window is shown as last-known, not live.
 */
export function freshnessOf(recordedAtMs: number | null | undefined, nowMs: number, liveWindowMs = LIVE_WINDOW_MS): Freshness {
  if (recordedAtMs == null || !Number.isFinite(recordedAtMs)) return 'UNAVAILABLE';
  return nowMs - recordedAtMs <= liveWindowMs ? 'LIVE' : 'STALE';
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}
