import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Rides } from '../../api/endpoints';
import type { Stop, StopType } from '../../api/types';
import { Badge, ConnectionPill, DeliveryChip, Gauge, QuickAction, StatusTag } from '../../components/cluster';
import { Icon } from '../../components/Icon';
import { Bezel, Button, ErrorState, Field, Gap, Label, LoadingState, Row, Screen, SectionHeader, Txt } from '../../components/primitives';
import { useNow } from '../../hooks/useNow';
import type { RootScreen } from '../../navigation/types';
import { RideSession, STOP_LABEL } from '../../services/RideSession';
import { useAuth } from '../../store/auth';
import { useConnection } from '../../store/connection';
import { useIntercom, useMusic } from '../../store/media';
import { isAdminRole, useRide } from '../../store/ride';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { ago } from '../../utils/freshness';
import { formatDistance, haversine } from '../../utils/geo';
import { RideMap } from '../map/RideMap';

const MORE_STOPS: { type: StopType; icon: any; label: string }[] = [
  { type: 'TEA_COFFEE', icon: 'cup', label: 'Tea' },
  { type: 'RESTROOM', icon: 'restroom', label: 'Restroom' },
  { type: 'CUSTOM', icon: 'dots', label: 'Custom' },
];

export function ActiveRideScreen({ route, navigation }: RootScreen<'ActiveRide'>) {
  const { c } = useTheme();
  const { rideId } = route.params;
  const qc = useQueryClient();
  const meId = useAuth(s => s.me?.id ?? '');
  const q = useQuery({ queryKey: ['ride', rideId], queryFn: () => Rides.get(rideId) });
  const live = useRide();
  const conn = useConnection();
  const music = useMusic();
  const ic = useIntercom();
  const now = useNow(5000);
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState<string | null>(null);

  // Start (or keep) the live session once the ride is known and we're an active participant.
  useEffect(() => {
    if (q.data && q.data.my_status === 'ACTIVE' && (q.data.status === 'PLANNED' || q.data.status === 'ACTIVE')) {
      RideSession.start(q.data);
    }
  }, [q.data]);

  if (q.isLoading && !live.ride) return <Screen><LoadingState label="Loading ride" /></Screen>;
  const ride = live.ride?.id === rideId ? live.ride : q.data;
  if (!ride) return <Screen><ErrorState error={q.error} onRetry={q.refetch} /></Screen>;

  const admin = isAdminRole(ride.my_role);
  const participants = Object.values(live.participants);
  const onlineCount = participants.filter(p => live.online[p.user_id]).length;
  const meshCount = conn.peers;
  const myPos = live.positions[meId];
  const destDist = myPos && ride.dest_lat != null ? haversine(myPos, { lat: ride.dest_lat, lng: ride.dest_lng! }) : null;
  const openStops = Object.values(live.stops).filter(s => ['OPEN', 'ACKNOWLEDGED', 'APPROVED'].includes(s.status));
  const activeSos = Object.values(live.emergencies).filter(e => e.status !== 'RESOLVED');
  const myOutgoing = Object.values(live.outgoing).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);

  const stop = async (type: StopType, note?: string) => {
    setBusy(type);
    try {
      await RideSession.requestStop(type, note);
    } catch (e: any) {
      Alert.alert('Could not send', e?.message ?? 'Try again');
    } finally {
      setBusy(null);
    }
  };

  const adminAct = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(label);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['rides'] });
      await q.refetch();
      await RideSession.refresh().catch(() => undefined);
    } catch (e: any) {
      Alert.alert('Failed', e?.detail ?? e?.message ?? 'Try again');
    } finally {
      setBusy(null);
    }
  };

  if (ride.my_status === 'PENDING') {
    return (
      <Screen>
        <Gap />
        <Txt v="title">{ride.name}</Txt>
        <Gap />
        <Bezel>
          <StatusTag label="Waiting for admin approval" tone="warn" />
          <Txt dim style={{ marginTop: space.sm }}>You'll get access to the ride once the admin approves you.</Txt>
        </Bezel>
      </Screen>
    );
  }

  return (
    <Screen>
      <Gap h={space.md} />
      <Row style={{ justifyContent: 'space-between' }}>
        <ConnectionPill />
        {admin && <Badge label={ride.my_role === 'ADMIN' ? 'You are admin' : 'Co-admin'} />}
      </Row>
      <Gap h={space.md} />
      <Txt v="title" numberOfLines={1}>{ride.name}</Txt>
      <Row gap={space.sm}>
        <Icon name="flag" size={18} color={c.accent} />
        <Txt dim numberOfLines={1} style={{ flex: 1 }}>
          {ride.dest_name}
          {destDist != null ? ` · ${formatDistance(destDist)} away` : ''}
        </Txt>
      </Row>

      {activeSos.map(e => (
        <Bezel key={e.id} tone="danger" style={{ marginTop: space.lg, backgroundColor: c.dangerSoft }} onPress={() => navigation.navigate('Emergency')}>
          <Row style={{ justifyContent: 'space-between' }}>
            <StatusTag label={e.status === 'ACKNOWLEDGED' ? 'Emergency · acknowledged' : 'Emergency active'} tone="danger" />
            <Icon name="chevronRight" color={c.danger} />
          </Row>
          <Txt v="bodyStrong" style={{ marginTop: space.xs }}>{e.announcement}</Txt>
        </Bezel>
      ))}

      <Gap />
      {/* Cluster: rider gauge + status stack */}
      <Row center={false} gap={space.lg}>
        <Gauge value={onlineCount || meshCount} max={participants.length || ride.participant_count} label={onlineCount ? 'ONLINE' : meshCount ? 'NEARBY' : 'CONNECTED'} />
        <View style={{ flex: 1, gap: space.md, paddingTop: space.md }}>
          <View>
            <Label>RIDE</Label>
            <StatusTag label={ride.status === 'ACTIVE' ? `Rolling · ${ride.started_at ? ago(now - Date.parse(ride.started_at)).replace(' ago', '') : ''}` : ride.status === 'PLANNED' ? 'Not started' : 'Ended'} tone={ride.status === 'ACTIVE' ? 'live' : 'dim'} />
          </View>
          <Pressable onPress={() => navigation.navigate('Main', { screen: 'Intercom' })}>
            <Label>INTERCOM</Label>
            <StatusTag label={ic.joined ? (ic.network === 'offline' ? 'Mesh voice' : 'Voice connected') : 'Not joined'} tone={ic.joined ? 'live' : 'dim'} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Main', { screen: 'Music' })}>
            <Label>MUSIC</Label>
            <Txt v="small" numberOfLines={1}>
              {music.status?.current ? `${music.status.state === 'PLAYING' ? '▶' : 'Ⅱ'}  ${music.status.current.title}` : 'Nothing queued'}
            </Txt>
          </Pressable>
        </View>
      </Row>

      {/* Big quick actions — two taps max */}
      <Gap h={space.md} />
      <Row gap={space.md}>
        <QuickAction icon="fuel" label="Petrol" onPress={() => stop('PETROL')} busy={busy === 'PETROL'} disabled={ride.status !== 'ACTIVE'} />
        <QuickAction icon="food" label="Food" onPress={() => stop('FOOD')} busy={busy === 'FOOD'} disabled={ride.status !== 'ACTIVE'} />
        <QuickAction icon="rest" label="Rest" onPress={() => stop('REST')} busy={busy === 'REST'} disabled={ride.status !== 'ACTIVE'} />
      </Row>
      <Gap h={space.md} />
      <Row gap={space.md}>
        <QuickAction icon="wrench" label="Breakdown" tone="accent" onPress={() => stop('BREAKDOWN')} busy={busy === 'BREAKDOWN'} disabled={ride.status !== 'ACTIVE'} />
        <QuickAction icon="sos" label="SOS" tone="danger" onPress={() => navigation.navigate('Emergency')} />
      </Row>
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        {MORE_STOPS.map(s => (
          <Button key={s.type} title={s.label} icon={s.icon} kind="quiet" style={{ flex: 1, paddingHorizontal: space.sm }} disabled={ride.status !== 'ACTIVE'}
            onPress={() => (s.type === 'CUSTOM' ? setCustom('') : stop(s.type))} />
        ))}
      </Row>
      {custom !== null && (
        <Bezel style={{ marginTop: space.md }}>
          <Field label="Custom request" value={custom} onChangeText={setCustom} maxLength={140} placeholder="e.g. Photo stop at the viewpoint" />
          <Row gap={space.md}>
            <Button title="Cancel" kind="ghost" style={{ flex: 1 }} onPress={() => setCustom(null)} />
            <Button title="Send" style={{ flex: 1 }} disabled={!custom.trim()} onPress={() => (stop('CUSTOM', custom.trim()), setCustom(null))} />
          </Row>
        </Bezel>
      )}

      {myOutgoing.length > 0 && (
        <>
          <SectionHeader title="YOUR REQUESTS" />
          {myOutgoing.map(o => (
            <Row key={o.eventId} style={{ justifyContent: 'space-between', paddingVertical: space.xs }}>
              <Txt>{o.kind === 'STOP' ? o.label : `SOS · ${o.label}`}</Txt>
              <DeliveryChip status={o.status} delivered={o.deliveredTo.length} recipients={o.recipients} via={o.via} />
            </Row>
          ))}
        </>
      )}

      <SectionHeader title={`STOP REQUESTS · ${openStops.length}`} />
      {openStops.length === 0 ? (
        <Txt dim>No open requests.</Txt>
      ) : (
        openStops.map(s => <StopRow key={s.id} stop={s} admin={admin} mine={s.requester_id === meId} now={now} />)
      )}

      <SectionHeader title="MAP" action="Full map" onAction={() => navigation.navigate('GroupMap')} />
      <View style={{ height: 200, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: c.bezel }}>
        <RideMap ride={ride} participants={live.participants} positions={live.positions} meId={meId} now={now} interactive={false} height={200} />
      </View>

      <Gap />
      <Row gap={space.md}>
        <Button title="Team" icon="team" kind="quiet" style={{ flex: 1 }} onPress={() => navigation.navigate('Team')} />
        <Button title="Map" icon="map" kind="quiet" style={{ flex: 1 }} onPress={() => navigation.navigate('GroupMap')} />
      </Row>

      {admin && (
        <>
          <SectionHeader title="ADMIN" />
          <Bezel>
            {ride.status === 'PLANNED' && <Button title="Start ride" size="lg" loading={busy === 'start'} onPress={() => adminAct(() => Rides.start(ride.id), 'start')} />}
            {ride.status === 'ACTIVE' && (
              <Button
                title="End ride"
                kind="danger"
                loading={busy === 'end'}
                onPress={() =>
                  Alert.alert('End ride?', 'Stops sharing location and closes the intercom for everyone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'End ride', style: 'destructive', onPress: () => adminAct(() => Rides.end(ride.id), 'end') },
                  ])
                }
              />
            )}
            <Gap h={space.md} />
            <Row gap={space.md}>
              <Button title="Invite" icon="qr" kind="quiet" style={{ flex: 1 }} onPress={() => navigation.navigate('RideInvite', { rideId: ride.id })} />
            </Row>
            <Gap h={space.md} />
            <AnnouncePanel />
          </Bezel>
        </>
      )}
      {!admin && ride.status !== 'ENDED' && (
        <>
          <Gap h={space.xl} />
          <Button
            title="Leave ride"
            kind="ghost"
            onPress={() =>
              Alert.alert('Leave this ride?', 'You stop sharing location and leave the intercom.', [
                { text: 'Stay', style: 'cancel' },
                {
                  text: 'Leave',
                  style: 'destructive',
                  onPress: async () => {
                    await Rides.leave(ride.id).catch(() => undefined);
                    await RideSession.stop();
                    qc.invalidateQueries({ queryKey: ['rides'] });
                    navigation.goBack();
                  },
                },
              ])
            }
          />
        </>
      )}
    </Screen>
  );
}

const PRESETS = ['Regroup at the next stop.', 'Slow down, the group is spreading out.', 'Fuel stop at the next petrol pump.'];

function AnnouncePanel() {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const send = async (t: string) => {
    setState('sending');
    try {
      await RideSession.announce(t);
      setState('sent');
      setText('');
    } catch {
      setState('failed');
    }
  };
  return (
    <View>
      <Field label="Announcement (spoken to every rider)" value={text} onChangeText={setText} maxLength={280} placeholder="Type or pick a preset" />
      <Button title={state === 'sent' ? 'Sent' : state === 'failed' ? 'Failed — retry' : 'Announce'} icon="speaker" loading={state === 'sending'} disabled={!text.trim()} onPress={() => send(text.trim())} />
      <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
        {PRESETS.map(p => (
          <Button key={p} title={p.replace(/\.$/, '')} kind="ghost" style={{ paddingHorizontal: space.md }} onPress={() => send(p)} />
        ))}
      </Row>
    </View>
  );
}

function StopRow({ stop, admin, mine, now }: { stop: Stop; admin: boolean; mine: boolean; now: number }) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const act = async (a: 'acknowledge' | 'approve' | 'reject' | 'complete') => {
    setBusy(true);
    try {
      await RideSession.actOnStop(stop, a);
    } catch (e: any) {
      Alert.alert('Failed', e?.detail ?? e?.message);
    } finally {
      setBusy(false);
    }
  };
  const urgent = stop.type === 'BREAKDOWN' || stop.type === 'EMERGENCY';
  return (
    <Bezel tone={urgent ? 'danger' : undefined} style={{ marginBottom: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="bodyStrong">{STOP_LABEL[stop.type]}</Txt>
        <StatusTag label={stop.status.toLowerCase()} tone={stop.status === 'OPEN' ? 'warn' : 'live'} />
      </Row>
      <Txt v="small" dim>
        {stop.requester_name}
        {stop.note ? ` · ${stop.note}` : ''} · {ago(now - Date.parse(stop.created_at))}
      </Txt>
      {(admin || mine) && (
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          {admin && stop.status === 'OPEN' && <Button title="Acknowledge" kind="quiet" loading={busy} style={{ flex: 1 }} onPress={() => act('acknowledge')} />}
          {admin && stop.status !== 'APPROVED' && <Button title="Approve" kind="quiet" loading={busy} style={{ flex: 1 }} onPress={() => act('approve')} />}
          {admin && <Button title="Reject" kind="ghost" loading={busy} style={{ flex: 1 }} onPress={() => act('reject')} />}
          <Button title={mine && !admin ? 'Withdraw' : 'Done'} kind="ghost" loading={busy} style={{ flex: 1 }} onPress={() => act('complete')} />
        </Row>
      )}
      {!admin && !mine && <Txt v="label" color={c.textFaint} style={{ marginTop: space.xs }}>WAITING FOR ADMIN</Txt>}
    </Bezel>
  );
}
