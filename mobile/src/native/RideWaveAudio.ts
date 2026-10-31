import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * Bindings for android/app/src/main/java/com/ridewave/app/audio.
 * Pairing is done by the OS; this only reads connected devices and routes audio.
 */

export type AudioDeviceType = 'BLUETOOTH_SCO' | 'BLUETOOTH_A2DP' | 'BLE_HEADSET' | 'WIRED' | 'USB' | 'SPEAKER' | 'EARPIECE' | 'OTHER';

export type AudioDevice = {
  id: number;
  type: AudioDeviceType;
  name: string;
  isSink: boolean;
  isSource: boolean;
  /** SHA-256 of the Bluetooth address (raw MAC never leaves the device). */
  addressHash: string | null;
};

export type LocalTrack = { uri: string; title: string; artist: string | null; album: string | null; durationMs: number; sizeBytes: number };

type Native = {
  getDevices(): Promise<AudioDevice[]>;
  getCommunicationDevice(): Promise<AudioDevice | null>;
  setCommunicationDevice(id: number): Promise<boolean>;
  clearCommunicationDevice(): Promise<void>;
  playTestTone(durationMs: number): Promise<{ played: boolean; routedTo: AudioDevice | null }>;
  micTest(durationMs: number): Promise<{ rmsDb: number; peakDb: number; source: AudioDevice | null }>;
  listLocalTracks(): Promise<LocalTrack[]>;
  fingerprint(uri: string): Promise<string>;
  ttsInit(): Promise<boolean>;
  ttsSpeak(text: string, id: string): Promise<void>;
  ttsStop(): Promise<void>;
  startRideService(title: string, text: string, withMic: boolean): Promise<void>;
  stopRideService(): Promise<void>;
};

const mod: Native | undefined = Platform.OS === 'android' ? NativeModules.RideWaveAudio : undefined;
const emitter = mod ? new NativeEventEmitter(NativeModules.RideWaveAudio) : null;

export const isHelmet = (d: AudioDevice) => d.type === 'BLUETOOTH_SCO' || d.type === 'BLE_HEADSET' || d.type === 'BLUETOOTH_A2DP';
/** Can carry the rider's voice (A2DP alone has no microphone). */
export const hasHelmetMic = (d: AudioDevice) => (d.type === 'BLUETOOTH_SCO' || d.type === 'BLE_HEADSET') && d.isSource;

export const AudioRouting = {
  available: () => !!mod,
  getDevices: () => (mod ? mod.getDevices() : Promise.resolve([])),
  getCommunicationDevice: () => (mod ? mod.getCommunicationDevice() : Promise.resolve(null)),
  setCommunicationDevice: (id: number) => (mod ? mod.setCommunicationDevice(id) : Promise.resolve(false)),
  clearCommunicationDevice: () => mod?.clearCommunicationDevice() ?? Promise.resolve(),
  playTestTone: (ms = 1200) => need().playTestTone(ms),
  micTest: (ms = 3000) => need().micTest(ms),
  listLocalTracks: () => (mod ? mod.listLocalTracks() : Promise.resolve([])),
  fingerprint: (uri: string) => need().fingerprint(uri),
  startRideService: (title: string, text: string, withMic: boolean) => mod?.startRideService(title, text, withMic) ?? Promise.resolve(),
  stopRideService: () => mod?.stopRideService() ?? Promise.resolve(),
  ttsInit: () => (mod ? mod.ttsInit() : Promise.resolve(false)),
  ttsSpeak: (text: string, id: string) => need().ttsSpeak(text, id),
  ttsStop: () => mod?.ttsStop() ?? Promise.resolve(),
  onTtsFinish: (cb: (id: string) => void) => {
    if (!emitter) return () => undefined;
    const s = emitter.addListener('tts:finish', (e: any) => cb(String(e.id)));
    return () => s.remove();
  },
  onDevicesChanged: (cb: (devices: AudioDevice[]) => void) => {
    if (!emitter) return () => undefined;
    const s = emitter.addListener('audio:devices', (e: any) => cb((e as { devices: AudioDevice[] }).devices));
    return () => s.remove();
  },
};

function need(): Native {
  if (!mod) throw new Error('Audio test is only available in the Android build');
  return mod;
}
