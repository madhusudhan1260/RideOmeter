/**
 * Group playback math, independent of any player.
 *
 * The authority (server online, hub offline) publishes:
 *   state, position_ms at anchor_at (server clock), version.
 * Each phone computes where it should be and corrects drift.
 */

export type GroupPlayback = {
  state: 'PLAYING' | 'PAUSED' | 'STOPPED';
  trackRef: string | null;
  durationMs: number;
  positionMs: number;
  anchorAtServerMs: number;
  version: number;
};

export const DRIFT_TOLERANCE_MS = 250;

export function targetPosition(p: GroupPlayback, serverNowMs: number): number {
  if (p.state !== 'PLAYING') return p.positionMs;
  const pos = p.positionMs + (serverNowMs - p.anchorAtServerMs);
  if (pos < p.positionMs) return p.positionMs; // scheduled start still in the future
  return p.durationMs > 0 ? Math.min(pos, p.durationMs) : pos;
}

/** ms to wait before starting playback (positive when the anchor is in the future). */
export function startDelay(p: GroupPlayback, serverNowMs: number): number {
  return p.state === 'PLAYING' ? Math.max(0, p.anchorAtServerMs - serverNowMs) : 0;
}

export type Correction = { action: 'none' } | { action: 'seek'; toMs: number } | { action: 'wait'; ms: number };

export function correction(p: GroupPlayback, localPositionMs: number, serverNowMs: number): Correction {
  const wait = startDelay(p, serverNowMs);
  if (wait > 0) return { action: 'wait', ms: wait };
  const target = targetPosition(p, serverNowMs);
  return Math.abs(target - localPositionMs) > DRIFT_TOLERANCE_MS ? { action: 'seek', toMs: target } : { action: 'none' };
}

/** Accept only newer versions — drops reordered or duplicated commands. */
export function isNewer(incoming: number, current: number | null): boolean {
  return current == null || incoming > current;
}
