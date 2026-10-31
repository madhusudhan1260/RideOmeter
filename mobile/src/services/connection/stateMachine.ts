/**
 * Pure connection state machine (no I/O), so it can be unit tested.
 *
 *   ONLINE ─▶ INTERNET_LOST ─▶ DISCOVERING_NEARBY ─▶ LOCAL_CONNECTION_ESTABLISHED ─▶ OFFLINE_MODE
 *   OFFLINE_MODE ─▶ INTERNET_RESTORED ─▶ SYNCING ─▶ ONLINE
 *
 * "Internet" means the backend is reachable and the ride socket is open — not just
 * that the OS reports a network. Local peer links are tracked independently and
 * are never torn down by an internet transition.
 */

export type ConnState =
  | 'IDLE'
  | 'CONNECTING'
  | 'ONLINE'
  | 'INTERNET_LOST'
  | 'DISCOVERING_NEARBY'
  | 'LOCAL_CONNECTION_ESTABLISHED'
  | 'OFFLINE_MODE'
  | 'INTERNET_RESTORED'
  | 'SYNCING';

export type ConnInput =
  | { type: 'RIDE_JOINED'; nearbyEnabled: boolean }
  | { type: 'RIDE_LEFT' }
  | { type: 'BACKEND_UP' }
  | { type: 'BACKEND_DOWN' }
  | { type: 'PEERS_CHANGED'; count: number }
  | { type: 'SYNC_DONE' }
  | { type: 'SYNC_FAILED' };

export interface ConnSnapshot {
  state: ConnState;
  backend: boolean;
  peers: number;
  nearbyEnabled: boolean;
  /** Outbox must flush before claiming ONLINE. */
  pendingSync: boolean;
}

export const initialSnapshot: ConnSnapshot = {
  state: 'IDLE',
  backend: false,
  peers: 0,
  nearbyEnabled: false,
  pendingSync: false,
};

export function reduce(s: ConnSnapshot, input: ConnInput): ConnSnapshot {
  switch (input.type) {
    case 'RIDE_JOINED':
      return { ...s, nearbyEnabled: input.nearbyEnabled, state: s.backend ? 'ONLINE' : 'CONNECTING' };
    case 'RIDE_LEFT':
      return { ...initialSnapshot, backend: s.backend };
    case 'BACKEND_UP': {
      const next = { ...s, backend: true };
      if (s.state === 'IDLE') return next;
      if (s.state === 'CONNECTING' || s.state === 'ONLINE') return { ...next, state: 'ONLINE' };
      // Coming back from any offline state: sync first.
      return { ...next, state: 'INTERNET_RESTORED', pendingSync: true };
    }
    case 'BACKEND_DOWN': {
      const next = { ...s, backend: false };
      if (s.state === 'IDLE') return next;
      if (s.state === 'ONLINE' || s.state === 'SYNCING' || s.state === 'INTERNET_RESTORED') {
        return { ...next, state: 'INTERNET_LOST' };
      }
      if (s.state === 'CONNECTING') return { ...next, state: s.nearbyEnabled ? 'DISCOVERING_NEARBY' : 'INTERNET_LOST' };
      return next;
    }
    case 'PEERS_CHANGED': {
      const next = { ...s, peers: input.count };
      if (s.backend || s.state === 'IDLE') return next;
      if (input.count > 0 && (s.state === 'DISCOVERING_NEARBY' || s.state === 'INTERNET_LOST')) {
        return { ...next, state: 'LOCAL_CONNECTION_ESTABLISHED' };
      }
      if (input.count === 0 && (s.state === 'OFFLINE_MODE' || s.state === 'LOCAL_CONNECTION_ESTABLISHED')) {
        return { ...next, state: s.nearbyEnabled ? 'DISCOVERING_NEARBY' : 'INTERNET_LOST' };
      }
      return next;
    }
    case 'SYNC_DONE':
      return s.backend ? { ...s, pendingSync: false, state: 'ONLINE' } : s;
    case 'SYNC_FAILED':
      return s.backend ? { ...s, state: 'INTERNET_RESTORED' } : s;
  }
}

/** Automatic follow-on transitions (time-free). Apply until fixed point. */
export function settle(s: ConnSnapshot): ConnSnapshot {
  let cur = s;
  for (let i = 0; i < 5; i++) {
    let next = cur;
    if (cur.state === 'INTERNET_LOST' && cur.nearbyEnabled) {
      next = { ...cur, state: cur.peers > 0 ? 'LOCAL_CONNECTION_ESTABLISHED' : 'DISCOVERING_NEARBY' };
    } else if (cur.state === 'LOCAL_CONNECTION_ESTABLISHED') {
      next = { ...cur, state: 'OFFLINE_MODE' };
    } else if (cur.state === 'INTERNET_RESTORED') {
      next = { ...cur, state: 'SYNCING' };
    }
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

export function describe(s: ConnSnapshot): { label: string; tone: 'live' | 'warn' | 'danger' | 'dim' } {
  switch (s.state) {
    case 'ONLINE':
      return { label: s.peers ? `Online · ${s.peers} nearby` : 'Online', tone: 'live' };
    case 'CONNECTING':
      return { label: 'Connecting…', tone: 'warn' };
    case 'INTERNET_LOST':
      return { label: 'No internet', tone: 'danger' };
    case 'DISCOVERING_NEARBY':
      return { label: 'Searching nearby riders', tone: 'warn' };
    case 'LOCAL_CONNECTION_ESTABLISHED':
    case 'OFFLINE_MODE':
      return { label: `Offline mesh · ${s.peers} rider${s.peers === 1 ? '' : 's'}`, tone: 'warn' };
    case 'INTERNET_RESTORED':
    case 'SYNCING':
      return { label: 'Syncing…', tone: 'warn' };
    default:
      return { label: s.backend ? 'Online' : 'Offline', tone: s.backend ? 'live' : 'dim' };
  }
}
