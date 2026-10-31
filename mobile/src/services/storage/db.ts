import { open, type DB } from '@op-engineering/op-sqlite';
import type { RideEvent } from '../events/types';
import type { OutboxStore } from '../sync/OfflineQueue';

let _db: DB | null = null;

export function db(): DB {
  if (_db) return _db;
  _db = open({ name: 'ridewave.sqlite' });
  _db.executeSync(`CREATE TABLE IF NOT EXISTS outbox (
    event_id TEXT PRIMARY KEY, ride_id TEXT NOT NULL, ts TEXT NOT NULL, body TEXT NOT NULL)`);
  _db.executeSync(`CREATE TABLE IF NOT EXISTS ride_log (
    event_id TEXT PRIMARY KEY, ride_id TEXT NOT NULL, type TEXT NOT NULL, ts TEXT NOT NULL,
    transport TEXT NOT NULL, body TEXT NOT NULL)`);
  _db.executeSync('CREATE INDEX IF NOT EXISTS ix_ride_log_ride ON ride_log (ride_id, ts)');
  _db.executeSync(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  _db.executeSync(`CREATE TABLE IF NOT EXISTS local_tracks (
    ref TEXT PRIMARY KEY, uri TEXT NOT NULL, title TEXT NOT NULL, artist TEXT, album TEXT,
    duration_ms INTEGER NOT NULL, added_at INTEGER NOT NULL)`);
  _db.executeSync(`CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, refs TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  return _db;
}

export const sqliteOutbox: OutboxStore = {
  async put(e) {
    await db().execute('INSERT OR IGNORE INTO outbox (event_id, ride_id, ts, body) VALUES (?, ?, ?, ?)', [
      e.event_id,
      e.ride_id,
      e.timestamp,
      JSON.stringify(e),
    ]);
  },
  async list(limit) {
    const r = await db().execute('SELECT body FROM outbox ORDER BY ts LIMIT ?', [limit]);
    return r.rows.map(row => JSON.parse(String(row.body)) as RideEvent);
  },
  async remove(ids) {
    if (!ids.length) return;
    await db().execute(`DELETE FROM outbox WHERE event_id IN (${ids.map(() => '?').join(',')})`, ids);
  },
  async count() {
    const r = await db().execute('SELECT COUNT(*) AS n FROM outbox');
    return Number(r.rows[0]?.n ?? 0);
  },
};

/** Local ride history — what this phone saw, from either transport. */
export async function logEvent(e: RideEvent) {
  await db().execute(
    'INSERT OR IGNORE INTO ride_log (event_id, ride_id, type, ts, transport, body) VALUES (?, ?, ?, ?, ?, ?)',
    [e.event_id, e.ride_id, e.event_type, e.timestamp, e.transport, JSON.stringify(e.payload)],
  );
}

export async function rideLog(rideId: string, limit = 200) {
  const r = await db().execute(
    'SELECT event_id, type, ts, transport, body FROM ride_log WHERE ride_id = ? ORDER BY ts DESC LIMIT ?',
    [rideId, limit],
  );
  return r.rows.map(row => ({
    event_id: String(row.event_id),
    type: String(row.type),
    ts: String(row.ts),
    transport: String(row.transport),
    payload: JSON.parse(String(row.body)),
  }));
}

export const kv = {
  get(k: string): string | null {
    const r = db().executeSync('SELECT v FROM kv WHERE k = ?', [k]);
    return r.rows.length ? String(r.rows[0].v) : null;
  },
  set(k: string, v: string) {
    db().executeSync('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, v]);
  },
  remove(k: string) {
    db().executeSync('DELETE FROM kv WHERE k = ?', [k]);
  },
};
