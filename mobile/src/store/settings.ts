import { create } from 'zustand';
import { kv } from '../services/storage/db';

export type Settings = {
  onboarded: boolean;
  nightMode: boolean;
  /** Seconds between GPS shares while riding. Longer = less battery. */
  locationIntervalSec: 5 | 10 | 30 | 60;
  nearbyEnabled: boolean;
  /** Fall back to the phone speaker if the helmet drops. Off by default — loud surprises on a bike are unsafe. */
  speakerFallback: boolean;
  ttsEnabled: boolean;
  /** Music volume while voice/announcements play, 0..1. */
  duckLevel: number;
  musicVolume: number;
  notifyStops: boolean;
  notifyRiders: boolean;
};

const DEFAULTS: Settings = {
  onboarded: false,
  nightMode: false,
  locationIntervalSec: 10,
  nearbyEnabled: true,
  speakerFallback: false,
  ttsEnabled: true,
  duckLevel: 0.2,
  musicVolume: 0.8,
  notifyStops: true,
  notifyRiders: true,
};

function load(): Settings {
  try {
    const raw = kv.get('settings');
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

type Store = Settings & { set: (patch: Partial<Settings>) => void };

export const useSettings = create<Store>((set, get) => ({
  ...load(),
  set: patch => {
    set(patch);
    const { set: _s, ...values } = { ...get(), ...patch };
    try {
      kv.set('settings', JSON.stringify(values));
    } catch {
      // storage unavailable: keep in memory for this session
    }
  },
}));
