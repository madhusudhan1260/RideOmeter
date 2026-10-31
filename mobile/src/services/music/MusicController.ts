import TrackPlayer, { State } from 'react-native-track-player';
import type { MusicStatus } from '../../api/types';
import { useMusic } from '../../store/media';
import { useSettings } from '../../store/settings';
import { LocalLibrary } from './LocalLibrary';
import { Spotify, SpotifyFailure } from './Spotify';
import { correction, GroupPlayback, isNewer, targetPosition } from './syncMath';

/**
 * Applies the group playback state to *this* phone's player. UI-independent:
 * the Music screen only reads useMusic and calls the admin endpoints.
 */
class Controller {
  private ready = false;
  private loadedRef: string | null = null;
  private version: number | null = null;
  private current: GroupPlayback | null = null;
  private source: MusicStatus['source'] = 'LOCAL';
  private serverNow: () => number = Date.now;
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  async init() {
    if (this.ready) return;
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
      await TrackPlayer.setVolume(useSettings.getState().musicVolume);
      this.ready = true;
    } catch (e: any) {
      // "already initialized" after a JS reload is fine
      this.ready = String(e?.message ?? '').includes('already');
    }
  }

  setClock(serverNow: () => number) {
    this.serverNow = serverNow;
  }

  /** Feed every MUSIC_* status here (from REST, WS or the offline hub). */
  async apply(status: MusicStatus, clockReady: boolean) {
    if (!isNewer(status.version, this.version)) return;
    this.version = status.version;
    useMusic.getState().setStatus(status);
    this.source = status.source;

    const cur = status.current;
    if (!status.enabled || !cur) {
      await this.stopLocal();
      useMusic.getState().setSync({ kind: 'idle' });
      return;
    }
    if (!clockReady && status.state === 'PLAYING') useMusic.getState().setSync({ kind: 'clock_unsynced' });

    this.current = {
      state: status.state,
      trackRef: cur.ref,
      durationMs: cur.duration_ms,
      positionMs: status.position_ms,
      anchorAtServerMs: Date.parse(status.anchor_at),
      version: status.version,
    };
    if (status.source === 'SPOTIFY') await this.applySpotify(cur.ref);
    else await this.applyLocal(cur.ref, cur.title, cur.artist ?? undefined);
  }

  private async applyLocal(ref: string, title: string, artist?: string) {
    await this.init();
    const file = await LocalLibrary.byRef(ref);
    if (!file) {
      await this.stopLocal();
      this.loadedRef = null;
      useMusic.getState().setSync({ kind: 'missing_file' });
      return;
    }
    if (this.loadedRef !== ref) {
      await TrackPlayer.reset();
      await TrackPlayer.add({ id: ref, url: file.uri, title, artist, duration: file.durationMs / 1000 });
      this.loadedRef = ref;
    }
    await this.reconcileLocal();
    this.ensureDriftLoop();
  }

  private async reconcileLocal() {
    const p = this.current;
    if (!p || this.source !== 'LOCAL' || !this.loadedRef) return;
    if (this.startTimer) clearTimeout(this.startTimer);
    const now = this.serverNow();
    if (p.state !== 'PLAYING') {
      await TrackPlayer.pause();
      await TrackPlayer.seekTo(p.positionMs / 1000);
      useMusic.getState().setSync({ kind: 'synced', driftMs: 0 });
      return;
    }
    const { position } = await TrackPlayer.getProgress();
    const c = correction(p, position * 1000, now);
    if (c.action === 'wait') {
      await TrackPlayer.pause();
      await TrackPlayer.seekTo(p.positionMs / 1000);
      this.startTimer = setTimeout(() => this.reconcileLocal(), c.ms);
      return;
    }
    if (c.action === 'seek') {
      useMusic.getState().setSync({ kind: 'correcting' });
      await TrackPlayer.seekTo(c.toMs / 1000);
    }
    const st = (await TrackPlayer.getPlaybackState()).state;
    if (st !== State.Playing) await TrackPlayer.play();
    const drift = Math.round(targetPosition(p, this.serverNow()) - (await TrackPlayer.getProgress()).position * 1000);
    useMusic.getState().setSync({ kind: 'synced', driftMs: drift });
    useMusic.getState().setLocalPosition(position * 1000);
  }

  private async applySpotify(uri: string) {
    await this.stopLocal();
    const p = this.current!;
    try {
      if (p.state === 'PLAYING') {
        const wait = Math.max(0, p.anchorAtServerMs - this.serverNow());
        if (this.startTimer) clearTimeout(this.startTimer);
        this.startTimer = setTimeout(async () => {
          try {
            await Spotify.play(uri, targetPosition(p, this.serverNow()));
            useMusic.getState().setSync({ kind: 'synced', driftMs: 0 });
          } catch (e) {
            this.spotifyFailed(e);
          }
        }, wait);
      } else {
        await Spotify.pause();
        useMusic.getState().setSync({ kind: 'synced', driftMs: 0 });
      }
    } catch (e) {
      this.spotifyFailed(e);
    }
  }

  private spotifyFailed(e: unknown) {
    const reason = e instanceof SpotifyFailure ? e.message : 'Spotify playback failed';
    useMusic.getState().setSync({ kind: 'spotify_unavailable', reason });
  }

  private ensureDriftLoop() {
    if (this.driftTimer) return;
    this.driftTimer = setInterval(() => {
      if (this.current?.state === 'PLAYING') this.reconcileLocal().catch(() => undefined);
    }, 2000);
  }

  private async stopLocal() {
    if (this.driftTimer) clearInterval(this.driftTimer);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.driftTimer = null;
    if (this.ready && this.loadedRef) await TrackPlayer.pause().catch(() => undefined);
  }

  async leave() {
    await this.stopLocal();
    if (this.ready) await TrackPlayer.reset().catch(() => undefined);
    this.loadedRef = null;
    this.version = null;
    this.current = null;
    useMusic.setState({ status: null, sync: { kind: 'idle' } });
  }

  /** Authority switched (server ⇄ offline hub): version counters are not comparable. */
  resetAuthority() {
    this.version = null;
  }

  /** Offline (hub) authority: build the next status locally. */
  nextLocalStatus(prev: MusicStatus, action: 'PLAY' | 'PAUSE' | 'NEXT' | 'PREV', hubNow: number, leadMs = 1500): MusicStatus | null {
    const p: GroupPlayback = {
      state: prev.state,
      trackRef: prev.current?.ref ?? null,
      durationMs: prev.current?.duration_ms ?? 0,
      positionMs: prev.position_ms,
      anchorAtServerMs: Date.parse(prev.anchor_at),
      version: prev.version,
    };
    let idx = prev.queue_index;
    let pos = targetPosition(p, hubNow);
    let state = prev.state;
    let anchor = hubNow;
    if (action === 'PLAY') {
      state = 'PLAYING';
      anchor = hubNow + leadMs;
    } else if (action === 'PAUSE') {
      state = 'PAUSED';
    } else {
      idx = action === 'NEXT' ? idx + 1 : pos > 3000 ? idx : idx - 1;
      if (idx < 0 || idx >= prev.queue.length) return null;
      pos = 0;
      if (state === 'PLAYING') anchor = hubNow + leadMs;
    }
    return {
      ...prev,
      state,
      queue_index: idx,
      current: prev.queue[idx] ?? null,
      position_ms: Math.round(pos),
      anchor_at: new Date(anchor).toISOString(),
      server_time: new Date(hubNow).toISOString(),
      version: prev.version + 1,
    };
  }
}

export const MusicController = new Controller();
