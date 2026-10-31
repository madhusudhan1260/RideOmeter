import { authorize, refresh } from 'react-native-app-auth';
import * as Keychain from 'react-native-keychain';
import { kv } from '../storage/db';

/**
 * Spotify via the official Web API with OAuth PKCE (no client secret on the phone).
 * Each rider authorises their own account and their own Spotify app plays the audio;
 * RideOmeter only tells it which track and position. Never relays Spotify audio.
 *
 * Requirements surfaced in the UI rather than hidden:
 *  - Spotify Premium for on-demand playback control (Web API returns 403 otherwise)
 *  - the Spotify app installed and recently active on this phone (404 NO_ACTIVE_DEVICE otherwise)
 *  - while the Spotify app is in "development mode", each rider must be allow-listed in the dashboard
 */

const SERVICE = 'ridewave.spotify';
const REDIRECT = 'com.ridewave.app:/spotify-callback';

export type SpotifyError = 'NOT_CONFIGURED' | 'NOT_AUTHORISED' | 'PREMIUM_REQUIRED' | 'NO_ACTIVE_DEVICE' | 'NETWORK' | 'UNKNOWN';

export class SpotifyFailure extends Error {
  constructor(public code: SpotifyError, msg: string) {
    super(msg);
  }
}

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };

const clientId = () => kv.get('spotify_client_id') ?? '';

const config = () => ({
  clientId: clientId(),
  redirectUrl: REDIRECT,
  scopes: ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private'],
  usePKCE: true,
  serviceConfiguration: {
    authorizationEndpoint: 'https://accounts.spotify.com/authorize',
    tokenEndpoint: 'https://accounts.spotify.com/api/token',
  },
});

async function save(t: Tokens) {
  await Keychain.setGenericPassword('spotify', JSON.stringify(t), { service: SERVICE });
}

async function load(): Promise<Tokens | null> {
  const c = await Keychain.getGenericPassword({ service: SERVICE });
  return c ? (JSON.parse(c.password) as Tokens) : null;
}

async function token(): Promise<string> {
  const t = await load();
  if (!t) throw new SpotifyFailure('NOT_AUTHORISED', 'Connect Spotify in Profile → Music');
  if (t.expiresAt - Date.now() > 60_000) return t.accessToken;
  const r = await refresh(config(), { refreshToken: t.refreshToken });
  const next = { accessToken: r.accessToken, refreshToken: r.refreshToken ?? t.refreshToken, expiresAt: Date.parse(r.accessTokenExpirationDate) };
  await save(next);
  return next.accessToken;
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`https://api.spotify.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e instanceof SpotifyFailure) throw e;
    throw new SpotifyFailure('NETWORK', 'Spotify needs mobile internet');
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (res.ok) return json;
  const reason = json?.error?.reason;
  if (res.status === 403 || reason === 'PREMIUM_REQUIRED') throw new SpotifyFailure('PREMIUM_REQUIRED', 'Spotify Premium is required for group playback');
  if (res.status === 404 || reason === 'NO_ACTIVE_DEVICE') throw new SpotifyFailure('NO_ACTIVE_DEVICE', 'Open the Spotify app on this phone once, then retry');
  if (res.status === 401) throw new SpotifyFailure('NOT_AUTHORISED', 'Reconnect Spotify');
  throw new SpotifyFailure('UNKNOWN', json?.error?.message ?? `Spotify error ${res.status}`);
}

export const Spotify = {
  configured: () => clientId().length > 0,
  setClientId: (id: string) => kv.set('spotify_client_id', id.trim()),

  async connect(): Promise<void> {
    if (!this.configured()) throw new SpotifyFailure('NOT_CONFIGURED', 'Add your Spotify app Client ID in Settings first');
    const r = await authorize(config());
    await save({ accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: Date.parse(r.accessTokenExpirationDate) });
  },

  async disconnect() {
    await Keychain.resetGenericPassword({ service: SERVICE });
  },

  async isConnected() {
    return (await load()) != null;
  },

  async profile(): Promise<{ display_name: string; product: 'premium' | 'free' | string }> {
    return call('GET', '/me');
  },

  async play(uri: string, positionMs: number) {
    await call('PUT', '/me/player/play', { uris: [uri], position_ms: Math.max(0, Math.round(positionMs)) });
  },

  async pause() {
    await call('PUT', '/me/player/pause').catch(e => {
      if (!(e instanceof SpotifyFailure && e.code === 'NO_ACTIVE_DEVICE')) throw e;
    });
  },

  async seek(positionMs: number) {
    await call('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(positionMs))}`);
  },

  async volume(pct: number) {
    await call('PUT', `/me/player/volume?volume_percent=${Math.round(Math.min(100, Math.max(0, pct)))}`).catch(() => undefined);
  },

  async state(): Promise<{ uri: string | null; progressMs: number; playing: boolean } | null> {
    const s = await call('GET', '/me/player');
    return s ? { uri: s.item?.uri ?? null, progressMs: s.progress_ms ?? 0, playing: !!s.is_playing } : null;
  },

  async searchTracks(q: string) {
    const r = await call('GET', `/search?type=track&limit=20&q=${encodeURIComponent(q)}`);
    return (r?.tracks?.items ?? []).map((t: any) => ({
      source: 'SPOTIFY' as const,
      ref: t.uri as string,
      title: t.name as string,
      artist: (t.artists ?? []).map((a: any) => a.name).join(', '),
      album: t.album?.name ?? null,
      artwork_url: t.album?.images?.[0]?.url ?? null,
      duration_ms: t.duration_ms as number,
    }));
  },
};
