import { create } from 'zustand';
import type { Emergency, Participant, Ride, RiderLocation, Stop, VoiceMode } from '../api/types';
import type { DeliveryStatus } from '../services/events/types';

/** A request this phone sent, with honest delivery tracking. */
export type Outgoing = {
  eventId: string;
  kind: 'STOP' | 'EMERGENCY';
  label: string;
  createdAt: number;
  status: DeliveryStatus;
  /** user ids confirmed received (via DELIVERY_ACK on either transport). */
  deliveredTo: string[];
  recipients: number;
  via: ('ws' | 'nearby' | 'outbox')[];
  serverId?: string;
  error?: string;
};

export type Live = { lat: number; lng: number; recordedAt: number; accuracy?: number | null; speed?: number | null; heading?: number | null; battery?: number | null; via: 'ws' | 'nearby' | 'rest' };

type Store = {
  ride: Ride | null;
  participants: Record<string, Participant>;
  online: Record<string, boolean>;
  helmet: Record<string, boolean>;
  positions: Record<string, Live>;
  sharingOff: Record<string, boolean>;
  stops: Record<string, Stop>;
  emergencies: Record<string, Emergency>;
  outgoing: Record<string, Outgoing>;
  banner: { id: string; title: string; body: string; tone: 'danger' | 'accent' | 'info'; at: number } | null;

  setRide: (r: Ride | null) => void;
  setVoiceMode: (m: VoiceMode) => void;
  setOnline: (userId: string, on: boolean) => void;
  setPresence: (ids: string[]) => void;
  setPosition: (userId: string, p: Live) => void;
  seedPositions: (rows: RiderLocation[]) => void;
  upsertStop: (s: Stop) => void;
  setStops: (s: Stop[]) => void;
  upsertEmergency: (e: Emergency) => void;
  setEmergencies: (e: Emergency[]) => void;
  track: (o: Outgoing) => void;
  updateOutgoing: (eventId: string, patch: Partial<Outgoing> | ((o: Outgoing) => Partial<Outgoing>)) => void;
  showBanner: (b: Store['banner']) => void;
  reset: () => void;
};

const empty = {
  ride: null,
  participants: {},
  online: {},
  helmet: {},
  positions: {},
  sharingOff: {},
  stops: {},
  emergencies: {},
  outgoing: {},
  banner: null,
};

export const useRide = create<Store>((set, get) => ({
  ...empty,
  setRide: ride => {
    const participants: Record<string, Participant> = {};
    const online: Record<string, boolean> = { ...get().online };
    ride?.participants?.forEach(p => {
      participants[p.user_id] = p;
      if (!(p.user_id in online)) online[p.user_id] = p.online;
    });
    set({ ride, participants, online });
  },
  setVoiceMode: m => {
    const r = get().ride;
    if (r) set({ ride: { ...r, voice_mode: m } });
  },
  setOnline: (userId, on) => set({ online: { ...get().online, [userId]: on } }),
  setPresence: ids => set({ online: Object.fromEntries(ids.map(i => [i, true])) }),
  setPosition: (userId, p) => {
    const cur = get().positions[userId];
    if (cur && cur.recordedAt >= p.recordedAt) return; // older fix arrived late over the other transport
    set({ positions: { ...get().positions, [userId]: p } });
  },
  seedPositions: rows => {
    const positions = { ...get().positions };
    const sharingOff: Record<string, boolean> = {};
    for (const r of rows) {
      if (!r.sharing) sharingOff[r.user_id] = true;
      if (r.lat == null || r.lng == null || !r.recorded_at) continue;
      const t = Date.parse(r.recorded_at);
      if (!positions[r.user_id] || positions[r.user_id].recordedAt < t) {
        positions[r.user_id] = { lat: r.lat, lng: r.lng, recordedAt: t, accuracy: r.accuracy_m, speed: r.speed_mps, heading: r.heading, battery: r.battery_pct, via: 'rest' };
      }
    }
    set({ positions, sharingOff });
  },
  upsertStop: s => set({ stops: { ...get().stops, [s.id]: s } }),
  setStops: list => set({ stops: Object.fromEntries(list.map(s => [s.id, s])) }),
  upsertEmergency: e => set({ emergencies: { ...get().emergencies, [e.id]: e } }),
  setEmergencies: list => set({ emergencies: Object.fromEntries(list.map(e => [e.id, e])) }),
  track: o => set({ outgoing: { ...get().outgoing, [o.eventId]: o } }),
  updateOutgoing: (id, patch) => {
    const cur = get().outgoing[id];
    if (!cur) return;
    const p = typeof patch === 'function' ? patch(cur) : patch;
    set({ outgoing: { ...get().outgoing, [id]: { ...cur, ...p } } });
  },
  showBanner: banner => set({ banner }),
  reset: () => set(empty),
}));

export const isAdminRole = (r?: string | null) => r === 'ADMIN' || r === 'CO_ADMIN';
