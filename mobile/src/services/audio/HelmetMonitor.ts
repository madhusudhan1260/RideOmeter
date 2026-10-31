import { Devices } from '../../api/endpoints';
import { AudioDevice, AudioRouting, hasHelmetMic, isHelmet } from '../../native/RideWaveAudio';
import { useAudio } from '../../store/media';
import { useSettings } from '../../store/settings';
import { Announcer } from '../announce/AnnouncementEngine';

/**
 * Watches OS audio devices. Reports only what Android reports — a helmet is
 * "connected" when the OS lists it, "mic working" only after a passed mic test.
 */
class Monitor {
  private unsub: (() => void) | null = null;

  async start() {
    if (this.unsub || !AudioRouting.available()) return;
    this.unsub = AudioRouting.onDevicesChanged(d => this.update(d));
    this.update(await AudioRouting.getDevices());
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
  }

  private async update(devices: AudioDevice[]) {
    const st = useAudio.getState();
    const helmet = devices.find(hasHelmetMic) ?? devices.find(isHelmet) ?? null;
    const wasConnected = st.helmetConnected;
    st.patch({ devices, helmetConnected: !!helmet, lastHelmetName: helmet?.name ?? st.lastHelmetName });

    if (helmet && hasHelmetMic(helmet)) {
      // Route intercom mic/output to the helmet as soon as it appears.
      await AudioRouting.setCommunicationDevice(helmet.id);
      st.patch({ route: helmet });
      if (helmet.addressHash) {
        Devices.saveHelmet({
          name: helmet.name,
          address_hash: helmet.addressHash,
          supports_hfp: helmet.type === 'BLUETOOTH_SCO' ? true : null,
          supports_a2dp: devices.some(d => d.type === 'BLUETOOTH_A2DP' && d.addressHash === helmet.addressHash) || null,
          supports_le_audio: helmet.type === 'BLE_HEADSET' || null,
        }).catch(() => undefined);
      }
      if (!wasConnected) Announcer.say('Helmet connected.', 'LOW');
    } else if (wasConnected && !helmet) {
      st.patch({ route: null, micTest: null, speakerTest: null });
      if (!useSettings.getState().speakerFallback) await AudioRouting.clearCommunicationDevice();
      Announcer.say('Helmet disconnected.', 'HIGH');
    }
  }

  async runSpeakerTest(): Promise<{ played: boolean; routedTo: AudioDevice | null }> {
    return AudioRouting.playTestTone(1200);
  }

  async runMicTest() {
    const r = await AudioRouting.micTest(3000);
    // -50 dBFS RMS is a quiet room; a working helmet mic with speech is typically > -40.
    const ok = r.rmsDb > -50;
    useAudio.getState().patch({
      micTest: { ok, at: Date.now(), detail: `${r.rmsDb.toFixed(0)} dBFS avg via ${r.source?.name ?? 'phone mic'}` },
    });
    return { ...r, ok };
  }
}

export const HelmetMonitor = new Monitor();
