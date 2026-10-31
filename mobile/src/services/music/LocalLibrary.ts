import { AudioRouting, LocalTrack } from '../../native/RideWaveAudio';
import { db } from '../storage/db';
import { newEventId } from '../../utils/id';

export type LibraryTrack = { ref: string; uri: string; title: string; artist: string | null; album: string | null; durationMs: number };
export type Playlist = { id: string; name: string; refs: string[]; updatedAt: number };

/**
 * Music files the rider legally has on the phone (MediaStore). Each is identified
 * by a content fingerprint so the group can check everyone has the same file.
 */
export const LocalLibrary = {
  /** Files on the device that are not yet in the library. */
  async scanDevice(): Promise<LocalTrack[]> {
    const all = await AudioRouting.listLocalTracks();
    const known = new Set((await this.all()).map(t => t.uri));
    return all.filter(t => !known.has(t.uri));
  },

  async add(t: LocalTrack): Promise<LibraryTrack> {
    const ref = await AudioRouting.fingerprint(t.uri);
    await db().execute(
      `INSERT INTO local_tracks (ref, uri, title, artist, album, duration_ms, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ref) DO UPDATE SET uri = excluded.uri`,
      [ref, t.uri, t.title, t.artist, t.album, t.durationMs, Date.now()],
    );
    return { ref, uri: t.uri, title: t.title, artist: t.artist, album: t.album, durationMs: t.durationMs };
  },

  async all(): Promise<LibraryTrack[]> {
    const r = await db().execute('SELECT * FROM local_tracks ORDER BY title COLLATE NOCASE');
    return r.rows.map(row => ({
      ref: String(row.ref),
      uri: String(row.uri),
      title: String(row.title),
      artist: row.artist == null ? null : String(row.artist),
      album: row.album == null ? null : String(row.album),
      durationMs: Number(row.duration_ms),
    }));
  },

  async byRef(ref: string): Promise<LibraryTrack | null> {
    const r = await db().execute('SELECT * FROM local_tracks WHERE ref = ?', [ref]);
    const row = r.rows[0];
    return row
      ? { ref, uri: String(row.uri), title: String(row.title), artist: row.artist ? String(row.artist) : null, album: row.album ? String(row.album) : null, durationMs: Number(row.duration_ms) }
      : null;
  },

  async remove(ref: string) {
    await db().execute('DELETE FROM local_tracks WHERE ref = ?', [ref]);
  },

  async playlists(): Promise<Playlist[]> {
    const r = await db().execute('SELECT * FROM playlists ORDER BY updated_at DESC');
    return r.rows.map(row => ({ id: String(row.id), name: String(row.name), refs: JSON.parse(String(row.refs)), updatedAt: Number(row.updated_at) }));
  },

  async savePlaylist(name: string, refs: string[], id = newEventId()): Promise<Playlist> {
    const p = { id, name, refs, updatedAt: Date.now() };
    await db().execute(
      `INSERT INTO playlists (id, name, refs, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, refs = excluded.refs, updated_at = excluded.updated_at`,
      [p.id, p.name, JSON.stringify(refs), p.updatedAt],
    );
    return p;
  },

  async deletePlaylist(id: string) {
    await db().execute('DELETE FROM playlists WHERE id = ?', [id]);
  },
};
