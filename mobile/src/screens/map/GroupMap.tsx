import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusTag } from '../../components/cluster';
import { EmptyState, Label, Row, Txt } from '../../components/primitives';
import { useNow } from '../../hooks/useNow';
import type { RootScreen } from '../../navigation/types';
import { useAuth } from '../../store/auth';
import { useRide } from '../../store/ride';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { ago, freshnessOf } from '../../utils/freshness';
import { formatDistance, haversine } from '../../utils/geo';
import { RideMap } from './RideMap';

export function GroupMapScreen(_: RootScreen<'GroupMap'>) {
  const { c } = useTheme();
  const live = useRide();
  const meId = useAuth(s => s.me?.id ?? '');
  const now = useNow(3000);
  const ride = live.ride;
  if (!ride) return <EmptyState icon="map" title="No active ride" />;

  const leader = Object.values(live.participants).find(p => p.role === 'ADMIN');
  const leaderPos = leader ? live.positions[leader.user_id] : undefined;
  const rows = Object.values(live.participants).map(p => {
    const pos = live.positions[p.user_id];
    const f = live.sharingOff[p.user_id] ? 'UNAVAILABLE' : freshnessOf(pos?.recordedAt, now);
    return { p, pos, f, dist: pos && leaderPos && p.user_id !== leader?.user_id ? haversine(leaderPos, pos) : null };
  });
  const spread = Math.max(0, ...rows.map(r => r.dist ?? 0));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        <RideMap ride={ride} participants={live.participants} positions={live.positions} meId={meId} now={now} />
      </View>
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: 1, borderColor: c.bezel, maxHeight: '45%' }}>
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Label>GROUP SPREAD</Label>
              <Txt v="numeral">{leaderPos ? formatDistance(spread) : '—'}</Txt>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Label>DESTINATION</Label>
              <Txt v="bodyStrong" numberOfLines={1}>{ride.dest_name}</Txt>
            </View>
          </Row>
          {rows.map(({ p, pos, f, dist }) => (
            <Row key={p.user_id} style={{ justifyContent: 'space-between', paddingVertical: space.sm, borderTopWidth: 1, borderColor: c.bezel }}>
              <View style={{ flex: 1 }}>
                <Txt v="bodyStrong">
                  {p.display_name}
                  {p.role === 'ADMIN' ? <Txt v="small" color={c.accent}>  leader</Txt> : null}
                </Txt>
                <Txt v="small" dim>
                  {f === 'UNAVAILABLE' ? (live.sharingOff[p.user_id] ? 'Not sharing location' : 'No GPS fix received') : `Updated ${ago(now - pos!.recordedAt)} via ${pos!.via === 'nearby' ? 'nearby mesh' : 'server'}`}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <StatusTag label={f === 'LIVE' ? 'Live' : f === 'STALE' ? 'Last known' : 'Unavailable'} tone={f === 'LIVE' ? 'live' : f === 'STALE' ? 'warn' : 'dim'} />
                {dist != null && <Txt v="small" dim>{formatDistance(dist)} from leader</Txt>}
              </View>
            </Row>
          ))}
          <Txt v="small" faint style={{ marginTop: space.md }}>
            Route lines are guidance from OpenStreetMap, not a safety guarantee.
          </Txt>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
