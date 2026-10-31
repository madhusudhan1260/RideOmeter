import { AnnouncementQueue } from '../src/services/announce/priorityQueue';
import { ClockSync } from '../src/services/clock/ClockSync';
import { describe as describeConn, initialSnapshot, reduce, settle, ConnSnapshot, ConnInput } from '../src/services/connection/stateMachine';
import { EventBus } from '../src/services/events/EventBus';
import type { RideEvent } from '../src/services/events/types';
import { correction, GroupPlayback, isNewer, startDelay, targetPosition } from '../src/services/music/syncMath';
import { MemoryOutboxStore, OfflineQueue } from '../src/services/sync/OfflineQueue';
import { freshnessOf } from '../src/utils/freshness';
import { decodePolyline, formatDistance, haversine } from '../src/utils/geo';
import { parseJoinCode } from '../src/utils/joinCode';

const run = (s: ConnSnapshot, ...inputs: ConnInput[]) => inputs.reduce((acc, i) => settle(reduce(acc, i)), s);

const ev = (over: Partial<RideEvent> = {}): RideEvent => ({
  event_id: Math.random().toString(36).slice(2),
  event_type: 'STOP_REQUESTED',
  ride_id: 'r1',
  sender_id: 'u1',
  timestamp: new Date().toISOString(),
  payload: {},
  delivery_status: 'SENDING',
  transport: 'ws',
  ...over,
});

describe('connection state machine', () => {
  it('goes online when the ride socket opens', () => {
    expect(run(initialSnapshot, { type: 'RIDE_JOINED', nearbyEnabled: true }, { type: 'BACKEND_UP' }).state).toBe('ONLINE');
  });

  it('internet loss → discovering → local link → offline mode', () => {
    let s = run(initialSnapshot, { type: 'RIDE_JOINED', nearbyEnabled: true }, { type: 'BACKEND_UP' }, { type: 'BACKEND_DOWN' });
    expect(s.state).toBe('DISCOVERING_NEARBY');
    s = run(s, { type: 'PEERS_CHANGED', count: 2 });
    expect(s.state).toBe('OFFLINE_MODE');
    expect(describeConn(s).label).toContain('2 riders');
  });

  it('without nearby it stays INTERNET_LOST instead of pretending a mesh exists', () => {
    const s = run(initialSnapshot, { type: 'RIDE_JOINED', nearbyEnabled: false }, { type: 'BACKEND_UP' }, { type: 'BACKEND_DOWN' });
    expect(s.state).toBe('INTERNET_LOST');
    expect(run(s, { type: 'PEERS_CHANGED', count: 0 }).state).toBe('INTERNET_LOST');
  });

  it('internet restored → syncing → online only after sync, keeping peers', () => {
    let s = run(initialSnapshot, { type: 'RIDE_JOINED', nearbyEnabled: true }, { type: 'BACKEND_UP' }, { type: 'BACKEND_DOWN' }, { type: 'PEERS_CHANGED', count: 3 });
    s = run(s, { type: 'BACKEND_UP' });
    expect(s.state).toBe('SYNCING');
    expect(s.peers).toBe(3); // local links untouched
    expect(run(s, { type: 'SYNC_FAILED' }).state).toBe('SYNCING'); // retries, never claims online
    s = run(s, { type: 'SYNC_DONE' });
    expect(s.state).toBe('ONLINE');
    expect(s.peers).toBe(3);
  });

  it('losing all peers offline falls back to discovery', () => {
    let s = run(initialSnapshot, { type: 'RIDE_JOINED', nearbyEnabled: true }, { type: 'BACKEND_DOWN' }, { type: 'PEERS_CHANGED', count: 1 });
    expect(s.state).toBe('OFFLINE_MODE');
    s = run(s, { type: 'PEERS_CHANGED', count: 0 });
    expect(s.state).toBe('DISCOVERING_NEARBY');
  });
});

describe('event bus', () => {
  it('dispatches each event_id once across transports', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('STOP_REQUESTED', e => seen.push(e.transport));
    const e = ev();
    expect(bus.emit(e)).toBe(true);
    expect(bus.emit({ ...e, transport: 'nearby' })).toBe(false);
    expect(seen).toEqual(['ws']);
  });

  it('drops admin-only events from non-admins arriving over the mesh', () => {
    const bus = new EventBus(id => id === 'admin');
    const got: string[] = [];
    bus.on('MUSIC_PLAY', e => got.push(e.sender_id!));
    bus.emit(ev({ event_type: 'MUSIC_PLAY', sender_id: 'member', transport: 'nearby' }));
    bus.emit(ev({ event_type: 'MUSIC_PLAY', sender_id: 'admin', transport: 'nearby' }));
    expect(got).toEqual(['admin']);
  });

  it('forgets ids after the TTL', () => {
    let t = 0;
    const bus = new EventBus(() => true, 1000, () => t);
    const e = ev();
    bus.emit(e);
    t = 5000;
    expect(bus.emit(e)).toBe(true);
  });
});

describe('clock sync', () => {
  it('estimates offset from low-RTT samples', () => {
    const c = new ClockSync();
    const trueOffset = 2500;
    // [t0, rtt]
    for (const [t0, rtt] of [[1000, 40], [2000, 400], [3000, 30], [4000, 35], [5000, 900]]) {
      const ts = t0 + rtt / 2 + trueOffset;
      c.addSample(t0, ts, t0 + rtt);
    }
    expect(c.ready).toBe(true);
    expect(Math.abs(c.offset - trueOffset)).toBeLessThan(5);
    expect(c.uncertainty).toBe(15);
  });

  it('rejects impossible samples', () => {
    const c = new ClockSync();
    expect(c.addSample(1000, 5000, 900)).toBeNull();
    expect(c.addSample(1000, 5000, 9000)).toBeNull();
  });
});

describe('music sync math', () => {
  const base: GroupPlayback = { state: 'PLAYING', trackRef: 'a', durationMs: 200_000, positionMs: 10_000, anchorAtServerMs: 100_000, version: 3 };

  it('computes target position and clamps to duration', () => {
    expect(targetPosition(base, 105_000)).toBe(15_000);
    expect(targetPosition({ ...base, durationMs: 12_000 }, 105_000)).toBe(12_000);
    expect(targetPosition({ ...base, state: 'PAUSED' }, 999_999)).toBe(10_000);
  });

  it('waits for a future anchor, seeks beyond tolerance, ignores small drift', () => {
    expect(startDelay(base, 99_000)).toBe(1000);
    expect(correction(base, 0, 99_000)).toEqual({ action: 'wait', ms: 1000 });
    expect(correction(base, 14_900, 105_000)).toEqual({ action: 'none' });
    expect(correction(base, 13_000, 105_000)).toEqual({ action: 'seek', toMs: 15_000 });
  });

  it('only accepts newer versions', () => {
    expect(isNewer(4, 3)).toBe(true);
    expect(isNewer(3, 3)).toBe(false);
    expect(isNewer(1, null)).toBe(true);
  });
});

describe('announcement queue', () => {
  it('orders by priority then age and drops stale items', () => {
    const q = new AnnouncementQueue();
    q.push({ id: '1', text: 'rider joined', priority: 'LOW', createdAt: 0, ttlMs: 60_000 });
    q.push({ id: '2', text: 'petrol', priority: 'HIGH', createdAt: 1, ttlMs: 60_000 });
    q.push({ id: '3', text: 'SOS', priority: 'EMERGENCY', createdAt: 2, ttlMs: 60_000 });
    q.push({ id: '4', text: 'old', priority: 'HIGH', createdAt: -100_000, ttlMs: 1000 });
    expect(q.next(10)?.text).toBe('SOS');
    expect(q.next(10)?.text).toBe('petrol');
    expect(q.next(10)?.text).toBe('rider joined');
    expect(q.next(10)).toBeUndefined();
  });

  it('only emergencies pre-empt', () => {
    expect(AnnouncementQueue.preempts('EMERGENCY', 'HIGH')).toBe(true);
    expect(AnnouncementQueue.preempts('HIGH', 'LOW')).toBe(false);
    expect(AnnouncementQueue.preempts('EMERGENCY', 'EMERGENCY')).toBe(false);
  });
});

describe('offline queue', () => {
  it('keeps events on network failure and removes them once answered', async () => {
    const store = new MemoryOutboxStore();
    const q = new OfflineQueue(store);
    const a = ev({ event_type: 'STOP_REQUESTED' });
    const b = ev({ event_type: 'EMERGENCY_CREATED' });
    expect(await q.enqueue(a)).toBe(true);
    expect(await q.enqueue(b)).toBe(true);
    expect(await q.enqueue(ev({ event_type: 'MUSIC_PLAY' }))).toBe(false); // not syncable

    const failed = await q.flush(async () => {
      throw new Error('offline');
    });
    expect(failed.failed).toBe(true);
    expect(await q.pending()).toBe(2);

    const ok = await q.flush(async evs =>
      evs.map(e => ({ event_id: e.event_id, result: e === evs[0] ? ('ACCEPTED' as const) : ('REJECTED' as const), reason: 'nope' })),
    );
    expect(ok.accepted).toBe(1);
    expect(ok.rejected).toHaveLength(1);
    expect(await q.pending()).toBe(0);
  });

  it('concurrent flushes share one upload', async () => {
    const q = new OfflineQueue(new MemoryOutboxStore());
    await q.enqueue(ev());
    let calls = 0;
    const up = async (evs: RideEvent[]) => {
      calls++;
      return evs.map(e => ({ event_id: e.event_id, result: 'ACCEPTED' as const }));
    };
    await Promise.all([q.flush(up), q.flush(up)]);
    expect(calls).toBe(1);
  });
});

describe('location freshness', () => {
  it('never reports stale coordinates as live', () => {
    expect(freshnessOf(1000, 1000 + 59_000)).toBe('LIVE');
    expect(freshnessOf(1000, 1000 + 61_000)).toBe('STALE');
    expect(freshnessOf(null, 1000)).toBe('UNAVAILABLE');
    expect(freshnessOf(NaN, 1000)).toBe('UNAVAILABLE');
  });
});

describe('geo', () => {
  it('haversine and formatting', () => {
    const d = haversine({ lat: 12.9716, lng: 77.5946 }, { lat: 13.3702, lng: 77.6835 });
    expect(d).toBeGreaterThan(44_000);
    expect(d).toBeLessThan(46_000);
    expect(formatDistance(340)).toBe('340 m');
    expect(formatDistance(4520)).toBe('4.5 km');
  });

  it('decodes encoded polylines', () => {
    // Reference example from the polyline algorithm spec.
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ lat: 38.5, lng: -120.2 });
    expect(pts[2]).toEqual({ lat: 43.252, lng: -126.453 });
  });
});

describe('join codes', () => {
  it('accepts codes, deep links and invite URLs', () => {
    expect(parseJoinCode('K7MXQ2PA')).toBe('K7MXQ2PA');
    expect(parseJoinCode('ridewave://join/K7MXQ2PA')).toBe('K7MXQ2PA');
    expect(parseJoinCode('http://192.168.1.10:8030/j/abcDEF123_-x')).toBe('abcDEF123_-x');
    expect(parseJoinCode('not a code!')).toBeNull();
  });
});
