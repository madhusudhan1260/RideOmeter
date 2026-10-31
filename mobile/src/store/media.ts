import { create } from 'zustand';
import type { MusicStatus } from '../api/types';
import type { AudioDevice } from '../native/RideWaveAudio';

export type SyncState =
  | { kind: 'idle' }
  | { kind: 'synced'; driftMs: number }
  | { kind: 'correcting' }
  | { kind: 'missing_file' }
  | { kind: 'spotify_unavailable'; reason: string }
  | { kind: 'clock_unsynced' };

type MusicStore = {
  status: MusicStatus | null;
  sync: SyncState;
  localPositionMs: number;
  setStatus: (s: MusicStatus) => void;
  setSync: (s: SyncState) => void;
  setLocalPosition: (ms: number) => void;
};

export const useMusic = create<MusicStore>(set => ({
  status: null,
  sync: { kind: 'idle' },
  localPositionMs: 0,
  setStatus: status => set({ status }),
  setSync: sync => set({ sync }),
  setLocalPosition: localPositionMs => set({ localPositionMs }),
}));

export type MicMode = 'PTT' | 'OPEN';

type IntercomStore = {
  joined: boolean;
  mode: MicMode;
  transmitting: boolean;
  muted: boolean;
  canPublish: boolean;
  speaking: Record<string, boolean>;
  network: 'online' | 'offline' | 'none';
  error: string | null;
  patch: (p: Partial<Omit<IntercomStore, 'patch' | 'setSpeaking'>>) => void;
  setSpeaking: (ids: string[]) => void;
};

export const useIntercom = create<IntercomStore>(set => ({
  joined: false,
  mode: 'PTT',
  transmitting: false,
  muted: false,
  canPublish: true,
  speaking: {},
  network: 'none',
  error: null,
  patch: p => set(p),
  setSpeaking: ids => set({ speaking: Object.fromEntries(ids.map(i => [i, true])) }),
}));

export type TestResult = { ok: boolean; at: number; detail: string } | null;

type AudioStore = {
  devices: AudioDevice[];
  route: AudioDevice | null;
  helmetConnected: boolean;
  micTest: TestResult;
  speakerTest: TestResult;
  lastHelmetName: string | null;
  patch: (p: Partial<Omit<AudioStore, 'patch'>>) => void;
};

export const useAudio = create<AudioStore>(set => ({
  devices: [],
  route: null,
  helmetConnected: false,
  micTest: null,
  speakerTest: null,
  lastHelmetName: null,
  patch: p => set(p),
}));
