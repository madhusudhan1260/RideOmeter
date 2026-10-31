import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Rides } from '../../api/endpoints';
import { ConnectionPill } from '../../components/cluster';
import { Button, EmptyState, ErrorState, Gap, LoadingState, Row, Segmented, Txt } from '../../components/primitives';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { RideCard } from './RideCard';

type Scope = 'upcoming' | 'recent' | 'public';

export function RideListScreen() {
  const { c } = useTheme();
  const nav = useNavigation();
  const [scope, setScope] = useState<Scope>('upcoming');
  const q = useQuery({ queryKey: ['rides', scope], queryFn: () => Rides.list(scope) });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="title">Rides</Txt>
          <ConnectionPill compact />
        </Row>
        <Gap h={space.lg} />
        <Row gap={space.md}>
          <View style={{ flex: 1 }}>
            <Button title="Create" icon="plus" onPress={() => nav.navigate('CreateRide')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Join" icon="qr" kind="quiet" onPress={() => nav.navigate('JoinRide')} />
          </View>
        </Row>
        <Gap h={space.lg} />
        <Segmented<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { value: 'upcoming', label: 'Mine' },
            { value: 'recent', label: 'History' },
            { value: 'public', label: 'Open rides' },
          ]}
        />
      </View>
      <FlatList
        data={q.data ?? []}
        keyExtractor={r => r.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => {
          q.refetch();
        }} tintColor={c.accent} />}
        renderItem={({ item }) => (
          <RideCard
            ride={item}
            onPress={() => (item.status === 'ENDED' || item.status === 'CANCELLED' ? nav.navigate('RideHistory', { rideId: item.id }) : nav.navigate('ActiveRide', { rideId: item.id }))}
          />
        )}
        ListEmptyComponent={
          q.isLoading ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={q.refetch} />
          ) : (
            <EmptyState
              icon="rides"
              title={scope === 'public' ? 'No open rides nearby' : scope === 'recent' ? 'No ride history yet' : 'No rides yet'}
              body={scope === 'upcoming' ? 'Create a ride and share the code with your group.' : undefined}
            />
          )
        }
      />
    </SafeAreaView>
  );
}
