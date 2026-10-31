import React from 'react';
import { Alert, View } from 'react-native';
import { Rides } from '../../api/endpoints';
import type { Participant } from '../../api/types';
import { Avatar, Badge, StatusTag } from '../../components/cluster';
import { Bezel, EmptyState, Gap, Label, Row, Screen, Txt } from '../../components/primitives';
import { useNow } from '../../hooks/useNow';
import type { RootScreen } from '../../navigation/types';
import { RideSession } from '../../services/RideSession';
import { useAuth } from '../../store/auth';
import { useConnection } from '../../store/connection';
import { isAdminRole, useRide } from '../../store/ride';
import { space } from '../../theme/tokens';
import { ago, freshnessOf } from '../../utils/freshness';
import { formatDistance, haversine } from '../../utils/geo';

export function TeamScreen(_: RootScreen<'Team'>) {
  const live = useRide();
  const conn = useConnection();
  const meId = useAuth(s => s.me?.id ?? '');
  const now = useNow(5000);
  const ride = live.ride;
  if (!ride) return <Screen><EmptyState icon="team" title="No active ride" /></Screen>;
  const admin = isAdminRole(ride.my_role);
  const meshByUser = Object.fromEntries(Object.values(conn.peers_).map(p => [p.userId, p]));
  const list = Object.values(live.participants).sort((a, b) => (a.role === 'ADMIN' ? -1 : b.role === 'ADMIN' ? 1 : a.display_name.localeCompare(b.display_name)));
  const me = live.positions[meId];

  const manage = (p: Participant) => {
    if (!admin || p.user_id === meId || p.role === 'ADMIN') return;
    const run = (fn: () => Promise<unknown>) => fn().then(() => RideSession.refresh()).catch((e: any) => Alert.alert('Failed', e?.detail ?? e?.message));
    Alert.alert(p.display_name, undefined, [
      p.status === 'PENDING'
        ? { text: 'Approve', onPress: () => run(() => Rides.approve(ride.id, p.user_id)) }
        : p.role === 'CO_ADMIN'
          ? { text: 'Make member', onPress: () => run(() => Rides.setRole(ride.id, p.user_id, 'MEMBER')) }
          : { text: 'Make co-admin', onPress: () => run(() => Rides.setRole(ride.id, p.user_id, 'CO_ADMIN')) },
      { text: 'Remove from ride', style: 'destructive', onPress: () => run(() => Rides.remove(ride.id, p.user_id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <Screen>
      <Gap />
      <Txt v="title">Team</Txt>
      <Txt dim>{list.length} riders · status from the server and the nearby mesh</Txt>
      <Gap />
      {list.map(p => {
        const online = live.online[p.user_id];
        const mesh = meshByUser[p.user_id];
        const pos = live.positions[p.user_id];
        const f = live.sharingOff[p.user_id] ? 'UNAVAILABLE' : freshnessOf(pos?.recordedAt, now);
        const conn_ = p.user_id === meId ? { label: 'You', tone: 'accent' as const } : online ? { label: 'Online', tone: 'live' as const } : mesh?.state === 'CONNECTED' ? { label: 'Nearby', tone: 'live' as const } : mesh?.state === 'CONNECTING' ? { label: 'Connecting', tone: 'warn' as const } : { label: 'Offline', tone: 'dim' as const };
        return (
          <Bezel key={p.user_id} style={{ marginBottom: space.md }} onPress={admin ? () => manage(p) : undefined}>
            <Row center={false}>
              <Avatar name={p.display_name} uri={p.avatar_url} ring={conn_.tone === 'dim' ? 'dim' : conn_.tone} />
              <View style={{ flex: 1 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt v="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{p.display_name}</Txt>
                  {p.role !== 'MEMBER' && <Badge label={p.role === 'ADMIN' ? 'Admin' : 'Co-admin'} />}
                  {p.status === 'PENDING' && <Badge label="Pending" tone="dim" />}
                </Row>
                <Txt v="small" dim>{p.motorcycle ?? 'Motorcycle not set'}</Txt>
                <Row style={{ marginTop: space.sm, flexWrap: 'wrap' }} gap={space.md}>
                  <StatusTag label={conn_.label} tone={conn_.tone} />
                  <StatusTag
                    label={f === 'LIVE' ? 'Live location' : f === 'STALE' ? `Last known ${ago(now - pos!.recordedAt)}` : live.sharingOff[p.user_id] ? 'Location hidden' : 'No location'}
                    tone={f === 'LIVE' ? 'live' : f === 'STALE' ? 'warn' : 'dim'}
                  />
                  {pos?.battery != null && <Label>BATT {pos.battery}%</Label>}
                  {me && pos && p.user_id !== meId && <Label>{formatDistance(haversine(me, pos))}</Label>}
                </Row>
              </View>
            </Row>
          </Bezel>
        );
      })}
      <Txt v="small" faint>Helmet status of other riders isn't shared yet — each rider sees their own on Home.</Txt>
    </Screen>
  );
}
