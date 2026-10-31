import React, { useState } from 'react';
import { Alert, Linking, Share, View } from 'react-native';
import type { EmergencyType } from '../../api/types';
import { DeliveryChip, QuickAction, SOSHoldButton, StatusTag } from '../../components/cluster';
import { Bezel, Button, Gap, Label, Row, Screen, SectionHeader, Txt } from '../../components/primitives';
import { useNow } from '../../hooks/useNow';
import type { RootScreen } from '../../navigation/types';
import { LocationService } from '../../services/location/LocationService';
import { RideSession } from '../../services/RideSession';
import { useAuth } from '../../store/auth';
import { useConnection } from '../../store/connection';
import { useRide } from '../../store/ride';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { ago } from '../../utils/freshness';

/** Local emergency number (India: 112). Change in a future locale setting. */
const EMERGENCY_NUMBER = '112';

const VIA_LABEL = { ws: 'server', nearby: 'nearby mesh', outbox: 'queued for sync' } as const;

export function EmergencyScreen(_: RootScreen<'Emergency'>) {
  const { c } = useTheme();
  const live = useRide();
  const conn = useConnection();
  const me = useAuth(s => s.me);
  const now = useNow(2000);
  const [busy, setBusy] = useState<EmergencyType | null>(null);
  const inRide = !!RideSession.active && live.ride && live.ride.status !== 'ENDED';

  const raise = async (type: EmergencyType) => {
    if (!inRide) return;
    setBusy(type);
    try {
      await RideSession.raiseEmergency(type);
    } catch (e: any) {
      Alert.alert('Could not send', `${e?.message ?? 'Unknown error'}. Call ${EMERGENCY_NUMBER} directly.`);
    } finally {
      setBusy(null);
    }
  };

  const shareLocation = async () => {
    const fix = LocationService.lastKnown() ?? (await LocationService.current(5000));
    if (!fix) return Alert.alert('No GPS fix', 'Your phone has not obtained a location yet.');
    const age = ago(Date.now() - Date.parse(fix.recorded_at));
    Share.share({ message: `My location (${age}): https://www.openstreetmap.org/?mlat=${fix.lat}&mlon=${fix.lng}#map=17/${fix.lat}/${fix.lng}` });
  };

  const mine = Object.values(live.outgoing).filter(o => o.kind === 'EMERGENCY').sort((a, b) => b.createdAt - a.createdAt);
  const others = Object.values(live.emergencies).filter(e => e.status !== 'RESOLVED' && e.reporter_id !== me?.id);
  const channels = [conn.ws === 'open' && 'server', conn.peers > 0 && `${conn.peers} nearby`].filter(Boolean).join(' + ') || 'no connection';

  return (
    <Screen>
      <Gap />
      <Txt v="title" color={c.danger}>Emergency</Txt>
      <Txt dim>
        {inRide ? `Alerts go to your ride group via ${channels}.` : 'You are not in an active ride — group alerts are unavailable.'}
      </Txt>
      <Gap h={space.xl} />

      {inRide ? (
        <View style={{ alignItems: 'center' }}>
          <SOSHoldButton onFire={() => raise('SOS')} />
        </View>
      ) : null}

      <Gap />
      <Row gap={space.md}>
        <QuickAction icon="crash" label="Accident" tone="danger" disabled={!inRide} busy={busy === 'ACCIDENT'} onPress={() => raise('ACCIDENT')} />
        <QuickAction icon="wrench" label="Breakdown" tone="accent" disabled={!inRide} busy={busy === 'BREAKDOWN'} onPress={() => raise('BREAKDOWN')} />
      </Row>
      <Gap h={space.md} />
      <Row gap={space.md}>
        <QuickAction icon="hand" label="Need help" disabled={!inRide} busy={busy === 'ASSISTANCE'} onPress={() => raise('ASSISTANCE')} />
        <QuickAction icon="pin" label="Share location" onPress={shareLocation} />
      </Row>
      <Gap h={space.md} />
      <Button title={`Call ${EMERGENCY_NUMBER}`} icon="phone" kind="danger" size="lg" onPress={() => Linking.openURL(`tel:${EMERGENCY_NUMBER}`)} />

      {mine.length > 0 && (
        <>
          <SectionHeader title="YOUR ALERTS" />
          {mine.map(o => (
            <Bezel key={o.eventId} tone="danger" style={{ marginBottom: space.sm }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="bodyStrong">{o.label}</Txt>
                <DeliveryChip status={o.status} delivered={o.deliveredTo.length} recipients={o.recipients} via={o.via} />
              </Row>
              <Txt v="small" dim>
                Sent {ago(now - o.createdAt)} via {o.via.length ? o.via.map(v => VIA_LABEL[v]).join(' + ') : 'nothing — no connection'}
                {o.error ? ` · ${o.error}` : ''}
              </Txt>
            </Bezel>
          ))}
          <Txt v="small" faint>"Delivered" counts only riders whose phones confirmed receipt.</Txt>
        </>
      )}

      {others.length > 0 && (
        <>
          <SectionHeader title="RIDERS NEEDING HELP" />
          {others.map(e => (
            <Bezel key={e.id} tone="danger" style={{ marginBottom: space.sm }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="bodyStrong">{e.announcement}</Txt>
              </Row>
              <StatusTag label={e.status === 'ACKNOWLEDGED' ? 'Acknowledged' : 'Needs acknowledgement'} tone={e.status === 'ACKNOWLEDGED' ? 'live' : 'danger'} />
              <Txt v="small" dim style={{ marginTop: space.xs }}>
                {e.lat != null
                  ? `Location ${e.lat.toFixed(5)}, ${e.lng!.toFixed(5)}${e.location_recorded_at ? ` (fix ${ago(now - Date.parse(e.location_recorded_at))})` : ''}`
                  : 'No location attached'}
              </Txt>
              {e.emergency_contact.name ? (
                <Txt v="small" dim>
                  Emergency contact: {e.emergency_contact.name} {e.emergency_contact.phone ?? ''}
                  {e.emergency_contact.blood_group ? ` · blood ${e.emergency_contact.blood_group}` : ''}
                </Txt>
              ) : null}
              <Row gap={space.sm} style={{ marginTop: space.md }}>
                {e.status === 'ACTIVE' && <Button title="Acknowledge" kind="danger" style={{ flex: 1 }} onPress={() => RideSession.acknowledgeEmergency(e)} />}
                {e.lat != null && <Button title="Navigate" kind="quiet" style={{ flex: 1 }} onPress={() => Linking.openURL(`geo:${e.lat},${e.lng}?q=${e.lat},${e.lng}`)} />}
                {e.emergency_contact.phone ? <Button title="Call contact" kind="quiet" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${e.emergency_contact.phone}`)} /> : null}
              </Row>
            </Bezel>
          ))}
        </>
      )}

      <SectionHeader title="YOUR EMERGENCY CONTACT" />
      <Bezel>
        {me?.profile.emergency_contact_name ? (
          <>
            <Txt v="bodyStrong">{me.profile.emergency_contact_name}</Txt>
            <Txt dim>{me.profile.emergency_contact_phone}</Txt>
            {me.profile.emergency_contact_phone && <Button title="Call" icon="phone" kind="quiet" style={{ marginTop: space.md }} onPress={() => Linking.openURL(`tel:${me.profile.emergency_contact_phone}`)} />}
          </>
        ) : (
          <>
            <Label>NOT SET</Label>
            <Txt dim>Add one in Profile so riders can call them if something happens to you.</Txt>
          </>
        )}
      </Bezel>
    </Screen>
  );
}
