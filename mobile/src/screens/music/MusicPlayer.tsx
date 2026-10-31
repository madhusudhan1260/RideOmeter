import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, Image, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { Music } from '../../api/endpoints';
import { Badge, StatusTag, TickProgress } from '../../components/cluster';
import { Icon } from '../../components/Icon';
import { Bezel, Button, EmptyState, Gap, IconButton, Label, Row, Toggle, Txt } from '../../components/primitives';
import { useNow } from '../../hooks/useNow';
import { RideSession } from '../../services/RideSession';
import { targetPosition } from '../../services/music/syncMath';
import { useConnection } from '../../store/connection';
import { SyncState, useMusic } from '../../store/media';
import { isAdminRole, useRide } from '../../store/ride';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function syncLabel(s: SyncState): { label: string; tone: 'live' | 'warn' | 'danger' | 'dim' } {
  switch (s.kind) {
    case 'synced':
      return { label: Math.abs(s.driftMs) < 250 ? 'In sync with group' : `Drift ${s.driftMs} ms`, tone: 'live' };
    case 'correcting':
      return { label: 'Re-syncing…', tone: 'warn' };
    case 'missing_file':
      return { label: 'Not synced — file missing on this phone', tone: 'danger' };
    case 'spotify_unavailable':
      return { label: s.reason, tone: 'danger' };
    case 'clock_unsynced':
      return { label: 'Measuring clock offset…', tone: 'warn' };
    default:
      return { label: 'Idle', tone: 'dim' };
  }
}

/** Artwork fallback: a vinyl-meets-tachometer disc. */
function Disc({ size }: { size: number }) {
  const { c } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="48" fill={c.surfaceRaised} stroke={c.bezel} />
      {[40, 32, 24].map(r => (
        <Circle key={r} cx="50" cy="50" r={r} fill="none" stroke={c.bezel} strokeWidth={0.8} />
      ))}
      <Path d="M14 66 A38 38 0 0 1 72 18" stroke={c.accent} strokeWidth={3} fill="none" strokeLinecap="round" />
      <Circle cx="50" cy="50" r="9" fill={c.accent} />
      <Circle cx="50" cy="50" r="2.5" fill={c.bg} />
    </Svg>
  );
}

export function MusicPlayerScreen() {
  const { c } = useTheme();
  const nav = useNavigation();
  const m = useMusic();
  const ride = useRide(s => s.ride);
  const conn = useConnection();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);

  if (!ride || !RideSession.active) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.lg }}>
        <EmptyState icon="music" title="Group music lives in a ride" body="Join a ride to listen with your group. You can prepare your local library now." action="Open library" onAction={() => nav.navigate('MusicLibrary')} />
      </SafeAreaView>
    );
  }
  const admin = isAdminRole(ride.my_role);
  const st = m.status;
  const cur = st?.current;
  const pos = st && cur ? targetPosition({ state: st.state, trackRef: cur.ref, durationMs: cur.duration_ms, positionMs: st.position_ms, anchorAtServerMs: Date.parse(st.anchor_at), version: st.version }, RideSession.serverNow()) : 0;
  const sync = syncLabel(m.sync);
  void now;

  const cmd = async (a: 'PLAY' | 'PAUSE' | 'NEXT' | 'PREV') => {
    setBusy(true);
    try {
      await RideSession.music(a);
    } catch (e: any) {
      Alert.alert('Music', e?.detail ?? e?.message ?? 'Command failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="title">Music</Txt>
          <Row gap={space.sm}>
            {st && <Badge label={st.source === 'SPOTIFY' ? 'Spotify' : 'Local files'} tone="dim" />}
            {conn.ws !== 'open' && conn.peers > 0 && <Badge label="Mesh" tone="dim" />}
          </Row>
        </Row>
        <Gap />
        <View style={{ alignItems: 'center' }}>
          {cur?.artwork_url ? <Image source={{ uri: cur.artwork_url }} style={{ width: 260, height: 260, borderRadius: radius.lg }} accessibilityIgnoresInvertColors /> : <Disc size={260} />}
        </View>
        <Gap h={space.xl} />
        <Txt v="title" numberOfLines={1}>{cur?.title ?? 'Nothing playing'}</Txt>
        <Txt dim numberOfLines={1}>{cur ? [cur.artist, cur.album].filter(Boolean).join(' · ') : admin ? 'Pick a playlist for the group' : 'Waiting for the admin to start music'}</Txt>
        <Gap />
        <TickProgress fraction={cur?.duration_ms ? pos / cur.duration_ms : 0} />
        <Row style={{ justifyContent: 'space-between', marginTop: space.xs }}>
          <Label>{mmss(pos)}</Label>
          <Label>{cur ? mmss(cur.duration_ms) : '0:00'}</Label>
        </Row>
        <Gap h={space.md} />
        <StatusTag label={sync.label} tone={sync.tone} />

        {admin ? (
          <Row style={{ justifyContent: 'center', marginVertical: space.xl }} gap={space.xl}>
            <IconButton icon="prev" label="Previous track" onPress={() => cmd('PREV')} size={64} />
            <IconButton icon={st?.state === 'PLAYING' ? 'pause' : 'play'} label={st?.state === 'PLAYING' ? 'Pause for group' : 'Play for group'} tone="accent" onPress={() => cmd(st?.state === 'PLAYING' ? 'PAUSE' : 'PLAY')} size={88} />
            <IconButton icon="next" label="Next track" onPress={() => cmd('NEXT')} size={64} />
          </Row>
        ) : (
          <Txt v="small" faint style={{ marginVertical: space.lg }}>
            The admin controls group playback. Your phone plays its own copy in sync.
          </Txt>
        )}
        {busy && <Txt v="small" faint center>Sending to group…</Txt>}

        {admin && (
          <Bezel>
            <Toggle
              label="Group music"
              hint="Turn off to stop music for everyone"
              value={st?.enabled ?? ride.music_enabled}
              onChange={v => Music.enable(ride.id, v).catch((e: any) => Alert.alert('Music', e?.detail ?? e?.message))}
            />
            <Button title="Choose songs / playlist" icon="music" kind="quiet" style={{ marginTop: space.md }} onPress={() => nav.navigate('MusicLibrary')} />
          </Bezel>
        )}

        <Gap />
        <Label>QUEUE</Label>
        <Gap h={space.sm} />
        {st?.queue.length ? (
          st.queue.map((t, i) => (
            <Row key={`${t.ref}-${i}`} style={{ paddingVertical: space.sm }}>
              <Txt v="label" color={i === st.queue_index ? c.accent : c.textFaint} style={{ width: 24 }}>
                {String(i + 1).padStart(2, '0')}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt numberOfLines={1} color={i === st.queue_index ? c.accent : undefined}>{t.title}</Txt>
                <Txt v="small" dim numberOfLines={1}>{t.artist}</Txt>
              </View>
              <Label>{mmss(t.duration_ms)}</Label>
              {i === st.queue_index && <Icon name="music" size={16} color={c.accent} />}
            </Row>
          ))
        ) : (
          <Txt dim>Queue is empty.</Txt>
        )}
        <Gap />
        <Txt v="small" faint>
          Spotify: each rider needs their own Premium account and the Spotify app on their phone. Local mode: everyone needs the same audio file.
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}
