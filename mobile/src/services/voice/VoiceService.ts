import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import { Voice } from '../../api/endpoints';
import { Nearby } from '../../native/RideWaveNearby';
import { useConnection } from '../../store/connection';
import { useIntercom } from '../../store/media';
import { Announcer } from '../announce/AnnouncementEngine';

/**
 * Group voice.
 *  online  → LiveKit room (WebRTC SFU, self-hosted). Push-to-talk toggles the mic track.
 *  offline → Nearby voice frames relayed by the hub (native, see voice/VoiceEngine.kt).
 * Uses the "communication" audio mode so Android routes mic + output to the helmet's HFP link.
 */
class Service {
  private room: Room | null = null;
  private rideId: string | null = null;
  private offline = false;

  async ensureMicPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  }

  async joinOnline(rideId: string) {
    const ic = useIntercom.getState();
    if (!(await this.ensureMicPermission())) {
      ic.patch({ error: 'Microphone permission denied' });
      return;
    }
    await this.leaveOffline();
    this.rideId = rideId;
    useConnection.getState().patch({ livekit: 'connecting' });
    try {
      const t = await Voice.token(rideId);
      await AudioSession.configureAudio({ android: { audioTypeOptions: AndroidAudioTypePresets.communication } });
      await AudioSession.startAudioSession();
      const room = new Room({ adaptiveStream: false, dynacast: false, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.room = room;
      room
        .on(RoomEvent.ConnectionStateChanged, s => {
          const map: Record<string, 'connected' | 'connecting' | 'reconnecting' | 'disconnected'> = {
            [ConnectionState.Connected]: 'connected',
            [ConnectionState.Connecting]: 'connecting',
            [ConnectionState.Reconnecting]: 'reconnecting',
            [ConnectionState.SignalReconnecting]: 'reconnecting',
            [ConnectionState.Disconnected]: 'disconnected',
          };
          useConnection.getState().patch({ livekit: map[s] ?? 'disconnected' });
          useIntercom.getState().patch({ joined: s === ConnectionState.Connected, network: s === ConnectionState.Connected ? 'online' : 'none' });
        })
        .on(RoomEvent.ActiveSpeakersChanged, speakers => useIntercom.getState().setSpeaking(speakers.map(p => p.identity)))
        .on(RoomEvent.ParticipantPermissionsChanged, () => {
          const can = room.localParticipant.permissions?.canPublish ?? false;
          useIntercom.getState().patch({ canPublish: can });
          if (!can) this.setTransmit(false);
        });
      await room.connect(t.url, t.token, { autoSubscribe: true });
      ic.patch({ canPublish: t.can_publish, mode: t.push_to_talk ? 'PTT' : 'OPEN', error: null, network: 'online', joined: true });
      if (!t.push_to_talk && t.can_publish) await this.setTransmit(true);
    } catch (e: any) {
      useConnection.getState().patch({ livekit: 'disconnected' });
      ic.patch({ joined: false, error: e?.message ?? 'Could not join voice', network: 'none' });
      await this.leaveOnline();
    }
  }

  async joinOffline() {
    if (!(await this.ensureMicPermission())) return;
    await this.leaveOnline();
    try {
      await Nearby.startVoice();
      this.offline = true;
      useIntercom.getState().patch({ joined: true, network: 'offline', error: null, canPublish: true });
    } catch (e: any) {
      useIntercom.getState().patch({ joined: false, network: 'none', error: e?.message ?? 'Offline voice unavailable' });
    }
  }

  async setTransmit(on: boolean) {
    const ic = useIntercom.getState();
    if (on && (!ic.canPublish || ic.muted)) return;
    Announcer.setVoiceActive(on);
    try {
      if (this.room) await this.room.localParticipant.setMicrophoneEnabled(on);
      else if (this.offline) await Nearby.setTransmitting(on);
      ic.patch({ transmitting: on });
    } catch (e: any) {
      ic.patch({ transmitting: false, error: e?.message ?? 'Microphone error' });
    }
  }

  async setMuted(m: boolean) {
    useIntercom.getState().patch({ muted: m });
    if (m) await this.setTransmit(false);
    else if (useIntercom.getState().mode === 'OPEN') await this.setTransmit(true);
  }

  async setMode(mode: 'PTT' | 'OPEN') {
    useIntercom.getState().patch({ mode });
    await this.setTransmit(mode === 'OPEN');
  }

  private async leaveOnline() {
    if (this.room) {
      await this.room.disconnect().catch(() => undefined);
      this.room = null;
      await AudioSession.stopAudioSession().catch(() => undefined);
    }
    useConnection.getState().patch({ livekit: 'disconnected' });
  }

  private async leaveOffline() {
    if (this.offline) await Nearby.stopVoice().catch(() => undefined);
    this.offline = false;
  }

  async leave() {
    await this.setTransmit(false);
    await this.leaveOnline();
    await this.leaveOffline();
    this.rideId = null;
    useIntercom.getState().patch({ joined: false, transmitting: false, network: 'none', speaking: {} });
  }

  get currentRide() {
    return this.rideId;
  }
}

export const VoiceService = new Service();
