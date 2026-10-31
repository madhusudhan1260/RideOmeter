import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Rides } from '../../api/endpoints';
import { ConnectionPill, StatusTag } from '../../components/cluster';
import { Icon } from '../../components/Icon';
import { Bezel, Button, EmptyState, ErrorState, Gap, Label, LoadingState, Row, SectionHeader, Txt } from '../../components/primitives';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../store/auth';
import { useAudio } from '../../store/media';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { RideCard } from '../rides/RideCard';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Night ride' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function HomeScreen() {
  const { c } = useTheme();
  const nav = useNavigation();
  const me = useAuth(s => s.me);
  const helmet = useAudio();
  const upcoming = useQuery({ queryKey: ['rides', 'upcoming'], queryFn: () => Rides.list('upcoming') });
  const recent = useQuery({ queryKey: ['rides', 'recent'], queryFn: () => Rides.list('recent') });
  const active = upcoming.data?.find(r => r.status === 'ACTIVE' && r.my_status === 'ACTIVE');
  const planned = upcoming.data?.filter(r => r.id !== active?.id) ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={upcoming.isRefetching} onRefresh={() => {
          upcoming.refetch();
          recent.refetch();
        }} tintColor={c.accent} />}>
        <Row style={{ justifyContent: 'space-between' }}>
          <ConnectionPill />
          <Pressable onPress={() => nav.navigate('Emergency')} accessibilityRole="button" accessibilityLabel="Emergency" hitSlop={8}
            style={{ height: 40, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: c.dangerSoft, borderWidth: 1, borderColor: c.danger, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="sos" size={18} color={c.danger} />
            <Txt v="label" caps color={c.danger}>SOS</Txt>
          </Pressable>
        </Row>
        <Gap h={space.xl} />
        <Label>{greeting().toUpperCase()}</Label>
        <Txt v="title">{me?.profile.display_name ?? 'Rider'}</Txt>
        {me?.motorcycles[0] ? (
          <Txt dim>
            {me.motorcycles[0].make} {me.motorcycles[0].model}
          </Txt>
        ) : null}

        {active && (
          <>
            <Gap />
            <Bezel tone="accent" onPress={() => nav.navigate('ActiveRide', { rideId: active.id })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <StatusTag label="Ride in progress" tone="live" />
                <Icon name="chevronRight" color={c.accent} />
              </Row>
              <Txt v="heading" style={{ marginTop: space.sm }}>{active.name}</Txt>
              <Txt v="small" dim>→ {active.dest_name} · {active.participant_count} riders</Txt>
              <Button title="Open ride dashboard" size="lg" style={{ marginTop: space.lg }} onPress={() => nav.navigate('ActiveRide', { rideId: active.id })} />
            </Bezel>
          </>
        )}

        <Gap />
        <Row gap={space.md}>
          <View style={{ flex: 1 }}>
            <Button title="Create ride" icon="plus" size="lg" onPress={() => nav.navigate('CreateRide')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Join ride" icon="qr" size="lg" kind="quiet" onPress={() => nav.navigate('JoinRide')} />
          </View>
        </Row>

        <Gap />
        <Bezel onPress={() => nav.navigate('DeviceSetup')}>
          <Row>
            <Icon name="helmet" size={30} color={helmet.helmetConnected ? c.accent : c.textFaint} />
            <View style={{ flex: 1 }}>
              <Label>HELMET</Label>
              <Txt v="bodyStrong">{helmet.helmetConnected ? helmet.lastHelmetName ?? 'Headset' : 'Not connected'}</Txt>
            </View>
            <StatusTag label={helmet.helmetConnected ? (helmet.micTest?.ok ? 'Mic OK' : 'Connected') : 'Offline'} tone={helmet.helmetConnected ? 'live' : 'dim'} />
          </Row>
        </Bezel>

        <SectionHeader title="UPCOMING RIDES" action="All rides" onAction={() => nav.navigate('Main', { screen: 'Rides' })} />
        {upcoming.isLoading ? (
          <LoadingState />
        ) : upcoming.isError ? (
          <ErrorState error={upcoming.error} onRetry={() => upcoming.refetch()} />
        ) : planned.length === 0 ? (
          <EmptyState icon="rides" title="No rides planned" body="Create a ride and invite your group, or join with a code." />
        ) : (
          planned.slice(0, 3).map(r => <RideCard key={r.id} ride={r} onPress={() => nav.navigate('ActiveRide', { rideId: r.id })} />)
        )}

        <SectionHeader title="RECENT RIDES" />
        {recent.data && recent.data.length > 0 ? (
          recent.data.slice(0, 3).map(r => <RideCard key={r.id} ride={r} onPress={() => nav.navigate('RideHistory', { rideId: r.id })} />)
        ) : !recent.isLoading && !recent.isError ? (
          <Txt dim>Completed rides will show up here.</Txt>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
