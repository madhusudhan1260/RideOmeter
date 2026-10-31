import TrackPlayer, { Event } from 'react-native-track-player';

/**
 * Headless playback service. Remote controls (lock screen, helmet buttons) are
 * deliberately not wired to the player: group playback is controlled by the
 * ride admin, and a member skipping locally would desync from the group.
 */
export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemoteDuck, async e => {
    // Phone call or another app took audio focus.
    if (e.paused) await TrackPlayer.pause();
  });
}
