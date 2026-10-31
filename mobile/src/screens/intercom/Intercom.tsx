import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Voice } from '../../api/endpoints';
import type { VoiceMode } from '../../api/types';
import { Avatar, ConnectionPill, PTTButton, StatusTag } from '../../components/cluster';
import { Icon } from '../../components/Icon';
import { Bezel, Button, EmptyState, Gap, IconButton, Label, Row, Segmented, Txt } from '../../components/primitives';
import { RideSession } from '../../services/RideSession';
import { VoiceService } from '../../services/voice/VoiceService';
import { useConnection } from '../../store/connection';
import { useAudio, useIntercom } from '../../store/media';
import { isAdminRole, useRide } from '../../store/ride';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export function IntercomScreen() {
  const { c } = useTheme();
  const nav = useNavigation();
  const ic = useIntercom();
  const conn = useConnection();
  const audio = useAudio();
  const live = useRide();
  const ride = live.ride;

  if (!ride || !RideSession.active) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.lg }}>
        <EmptyState icon="intercom" title="No active ride" body="Open a ride to talk to your group." action="Go to rides" onAction={() => nav.navigate('Main', { screen: 'Rides' })} />
      </SafeAreaView>
    );
  }
  const admin = isAdminRole(ride.my_role);
  const ptt = ic.mode === 'PTT';
  const signal = conn.ws === 'open' ? (conn.livekit === 'connected' ? 'Strong · server' : conn.livekit === 'reconnecting' ? 'Reconnecting' : 'Server reachable') : conn.peers > 0 ? `Mesh · ${conn.peers} peer${conn.peers > 1 ? 's' : ''}` : 'No signal';
  const participants = Object.values(live.participants);

  const join = () => (conn.ws === 'open' ? VoiceService.joinOnline(ride.id) : conn.peers > 0 ? VoiceService.joinOffline() : Alert.alert('No connection', 'No server and no nearby riders — voice cannot connect.'));

  const setGroupMode = async (m: VoiceMode) => {
    try {
      await Voice.setMode(ride.id, m);
      live.setVoiceMode(m);
    } catch (e: any) {
      Alert.alert('Could not change mode', e?.detail ?? e?.message);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="title">Intercom</Txt>
          <ConnectionPill compact />
        </Row>
        <Gap h={space.md} />
        <Row style={{ flexWrap: 'wrap' }} gap={space.lg}>
          <View>
            <Label>NETWORK</Label>
            <StatusTag label={ic.network === 'online' ? 'Online (LiveKit)' : ic.network === 'offline' ? 'Offline mesh' : 'Not connected'} tone={ic.joined ? 'live' : 'dim'} />
          </View>
          <View>
            <Label>SIGNAL</Label>
            <Row gap={6}>
              <Icon name="signal" size={16} color={conn.ws === 'open' || conn.peers ? c.live : c.textFaint} />
              <Txt v="small">{signal}</Txt>
            </Row>
          </View>
          <View>
            <Label>AUDIO ROUTE</Label>
            <Row gap={6}>
              <Icon name={audio.route ? 'helmet' : 'speaker'} size={16} color={audio.route ? c.accent : c.textDim} />
              <Txt v="small">{audio.route?.name ?? 'Phone'}</Txt>
            </Row>
          </View>
        </Row>

        {ic.error && (
          <Txt v="small" color={c.danger} style={{ marginTop: space.md }}>
            {ic.error}
          </Txt>
        )}

        <View style={{ alignItems: 'center', marginVertical: space.xl }}>
          {ic.joined ? (
            <PTTButton
              active={ic.transmitting}
              disabled={!ic.canPublish || ic.muted || !ptt}
              label={!ic.canPublish ? 'Listen only' : ic.muted ? 'Muted' : !ptt ? (ic.transmitting ? 'Open mic · live' : 'Open mic') : ic.transmitting ? 'Talking' : 'Hold to talk'}
              onPressIn={() => ptt && VoiceService.setTransmit(true)}
              onPressOut={() => ptt && VoiceService.setTransmit(false)}
            />
          ) : (
            <Button title="Join voice" icon="intercom" size="lg" onPress={join} />
          )}
          {!ic.canPublish && ic.joined && (
            <Txt v="small" dim center style={{ marginTop: space.sm }}>
              Admin-only announcements are on — you can listen but not talk.
            </Txt>
          )}
        </View>

        {ic.joined && (
          <Row gap={space.md} style={{ justifyContent: 'center' }}>
            <IconButton icon={ic.muted ? 'micOff' : 'mic'} label={ic.muted ? 'Unmute' : 'Mute'} tone={ic.muted ? 'danger' : undefined} onPress={() => VoiceService.setMuted(!ic.muted)} size={64} />
            <View style={{ flex: 1 }}>
              <Segmented
                value={ic.mode}
                onChange={m => VoiceService.setMode(m)}
                options={[
                  { value: 'PTT', label: 'Push to talk' },
                  { value: 'OPEN', label: 'Open mic' },
                ]}
              />
            </View>
          </Row>
        )}

        {admin && (
          <>
            <Gap h={space.xl} />
            <Label>GROUP VOICE RULES (ADMIN)</Label>
            <Gap h={space.sm} />
            <Segmented<VoiceMode>
              value={ride.voice_mode}
              onChange={setGroupMode}
              options={[
                { value: 'PUSH_TO_TALK', label: 'PTT' },
                { value: 'OPEN_MIC', label: 'Open mic' },
                { value: 'ADMIN_ONLY', label: 'Admin only' },
              ]}
            />
          </>
        )}

        <Gap h={space.xl} />
        <Label>RIDERS</Label>
        <Gap h={space.sm} />
        <Bezel>
          {participants.map(p => {
            const speaking = ic.speaking[p.user_id];
            const reachable = live.online[p.user_id] || Object.values(conn.peers_).some(x => x.userId === p.user_id && x.state === 'CONNECTED');
            return (
              <Row key={p.user_id} style={{ paddingVertical: space.sm }}>
                <Avatar name={p.display_name} uri={p.avatar_url} size={40} ring={speaking ? 'accent' : reachable ? 'live' : 'dim'} />
                <Txt style={{ flex: 1 }}>{p.display_name}</Txt>
                {speaking ? <StatusTag label="Speaking" tone="accent" /> : <StatusTag label={reachable ? 'Connected' : 'Offline'} tone={reachable ? 'live' : 'dim'} />}
              </Row>
            );
          })}
        </Bezel>
        <Gap />
        <Txt v="small" faint>
          Offline voice works only within radio range of the hub phone (typically tens of metres between moving bikes) and is limited to a small group.
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}
