import TrackPlayer from 'react-native-track-player';
import { AudioRouting } from '../../native/RideWaveAudio';
import { useSettings } from '../../store/settings';
import { newEventId } from '../../utils/id';
import { Announcement, AnnouncementQueue, Priority } from './priorityQueue';

/**
 * Spoken announcements with priority and music ducking.
 * EMERGENCY pre-empts anything else. While the rider is transmitting on the
 * intercom, non-emergency announcements wait so we don't talk over them.
 */
class Engine {
  private q = new AnnouncementQueue();
  private speaking: Announcement | null = null;
  private ready = false;
  private holdForVoice = false;
  private ducked = false;

  async init() {
    if (this.ready) return;
    // Native TextToSpeech; it takes transient audio focus so other apps (Spotify) duck.
    this.ready = await AudioRouting.ttsInit().catch(() => false); // no engine: banners still show
    if (this.ready) AudioRouting.onTtsFinish(id => this.speaking?.id === id && this.done());
  }

  say(text: string, priority: Priority = 'NORMAL', ttlMs = 60_000) {
    if (!useSettings.getState().ttsEnabled && priority !== 'EMERGENCY') return;
    const a = { id: newEventId(), text, priority, createdAt: Date.now(), ttlMs };
    if (AnnouncementQueue.preempts(priority, this.speaking?.priority ?? null)) {
      this.q.push(a);
      AudioRouting.ttsStop(); // fires tts:finish → done() → pump() speaks the emergency next
      return;
    }
    this.q.push(a);
    this.pump();
  }

  /** Called by the intercom while this rider holds push-to-talk. */
  setVoiceActive(on: boolean) {
    this.holdForVoice = on;
    if (!on) this.pump();
  }

  private async pump() {
    if (!this.ready || this.speaking) return;
    const peek = this.q.next(Date.now());
    if (!peek) return this.unduck();
    if (this.holdForVoice && peek.priority !== 'EMERGENCY') {
      this.q.push(peek);
      return;
    }
    this.speaking = peek;
    await this.duck();
    AudioRouting.ttsSpeak(peek.text, peek.id).catch(() => this.done());
  }

  private done() {
    this.speaking = null;
    this.pump();
  }

  private async duck() {
    if (this.ducked) return;
    this.ducked = true;
    try {
      await TrackPlayer.setVolume(useSettings.getState().duckLevel);
    } catch {
      // player not initialised: nothing to duck
    }
  }

  private async unduck() {
    if (!this.ducked) return;
    this.ducked = false;
    try {
      await TrackPlayer.setVolume(useSettings.getState().musicVolume);
    } catch {
      // ignore
    }
  }
}

export const Announcer = new Engine();
