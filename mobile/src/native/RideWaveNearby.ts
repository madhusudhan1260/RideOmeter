import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * Bindings for android/app/src/main/java/com/ridewave/app/nearby (Google Nearby Connections).
 * Topology: P2P_STAR. The hub advertises; members discover and connect.
 * The native side authenticates peers with HMAC(ride offline key) and the hub
 * relays event and voice payloads to every other member.
 *
 * iOS: not implemented (see docs/ARCHITECTURE.md §3.4). `available()` reports why.
 */

export type NearbyRole = 'HUB' | 'MEMBER';
export type NearbyState = 'off' | 'advertising' | 'discovering' | 'connected' | 'error';
export type NearbyPeerEvent = { endpointId: string; userId: string; name: string; state: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'REJECTED'; isHub: boolean };

type Native = {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  start(opts: { rideShortId: string; userId: string; displayName: string; role: NearbyRole; offlineKeyHex: string }): Promise<void>;
  stop(): Promise<void>;
  sendEvent(json: string): Promise<number>;
  startVoice(): Promise<void>;
  stopVoice(): Promise<void>;
  setTransmitting(on: boolean): Promise<void>;
};

const mod: Native | undefined = Platform.OS === 'android' ? NativeModules.RideWaveNearby : undefined;
const emitter = mod ? new NativeEventEmitter(NativeModules.RideWaveNearby) : null;

export const Nearby = {
  async available(): Promise<{ available: boolean; reason?: string }> {
    if (Platform.OS !== 'android') return { available: false, reason: 'Offline mesh is Android-only in this version' };
    if (!mod) return { available: false, reason: 'Native Nearby module is not linked in this build' };
    return mod.isAvailable();
  },
  start: (o: Parameters<Native['start']>[0]) => must().start(o),
  stop: () => mod?.stop() ?? Promise.resolve(),
  sendEvent: (json: string) => (mod ? mod.sendEvent(json) : Promise.resolve(0)),
  startVoice: () => must().startVoice(),
  stopVoice: () => mod?.stopVoice() ?? Promise.resolve(),
  setTransmitting: (on: boolean) => mod?.setTransmitting(on) ?? Promise.resolve(),

  onState: (cb: (e: { state: NearbyState; detail?: string }) => void) => sub('nearby:state', cb),
  onPeer: (cb: (e: NearbyPeerEvent) => void) => sub('nearby:peer', cb),
  onEvent: (cb: (e: { endpointId: string; json: string }) => void) => sub('nearby:event', cb),
  onVoiceActivity: (cb: (e: { userId: string; level: number }) => void) => sub('nearby:voice', cb),
};

function must(): Native {
  if (!mod) throw new Error('Nearby is not available on this device');
  return mod;
}

function sub<T>(name: string, cb: (e: T) => void): () => void {
  if (!emitter) return () => undefined;
  const s = emitter.addListener(name, cb as any);
  return () => s.remove();
}
