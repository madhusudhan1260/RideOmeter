import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { Users } from '../../api/endpoints';
import { setApiBaseUrl, apiBaseUrl } from '../../api/client';
import { Avatar, StatusTag } from '../../components/cluster';
import { Bezel, Button, Divider, Field, Gap, InlineError, Label, ListRow, Row, Screen, Segmented, SectionHeader, Toggle, Txt } from '../../components/primitives';
import type { RootScreen } from '../../navigation/types';
import { Spotify } from '../../services/music/Spotify';
import { rideLog } from '../../services/storage/db';
import { useAuth } from '../../store/auth';
import { useConnection } from '../../store/connection';
import { useAudio } from '../../store/media';
import { useSettings } from '../../store/settings';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { ago } from '../../utils/freshness';

export function ProfileScreen() {
  const nav = useNavigation();
  const me = useAuth(s => s.me);
  const logout = useAuth(s => s.logout);
  const audio = useAudio();
  if (!me) return <Screen><Txt>Not signed in</Txt></Screen>;
  const bike = me.motorcycles[0];
  return (
    <Screen>
      <Gap />
      <Row>
        <Avatar name={me.profile.display_name} uri={me.profile.avatar_url} size={72} ring="accent" />
        <View style={{ flex: 1 }}>
          <Txt v="title">{me.profile.display_name}</Txt>
          <Txt dim>@{me.username}</Txt>
        </View>
      </Row>
      <Gap />
      <Bezel>
        <Label>MOTORCYCLE</Label>
        <Txt v="heading">{bike ? `${bike.make} ${bike.model}` : 'Not added'}</Txt>
        {bike?.year ? <Txt v="small" dim>{bike.year}{bike.color ? ` · ${bike.color}` : ''}</Txt> : null}
      </Bezel>
      <SectionHeader title="RIDER" />
      <Bezel>
        <ListRow icon="edit" title="Edit profile & motorcycle" onPress={() => nav.navigate('EditProfile')} />
        <ListRow icon="phone" title="Emergency contact" subtitle={me.profile.emergency_contact_name ? `${me.profile.emergency_contact_name} · ${me.profile.emergency_contact_phone ?? ''}` : 'Not set — riders can’t call anyone for you'} onPress={() => nav.navigate('EditProfile')} />
        <ListRow icon="helmet" title="Helmet headset" subtitle={audio.helmetConnected ? `${audio.lastHelmetName} connected` : 'Not connected'} onPress={() => nav.navigate('DeviceSetup')} />
      </Bezel>
      <SectionHeader title="APP" />
      <Bezel>
        <ListRow icon="settings" title="Settings" subtitle="Audio, offline mode, location, notifications, night mode" onPress={() => nav.navigate('Settings')} />
        <ListRow icon="music" title="Music library" onPress={() => nav.navigate('MusicLibrary')} />
        <ListRow icon="logout" title="Sign out" tone="danger" onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: logout }])} />
      </Bezel>
    </Screen>
  );
}

export function EditProfileScreen({ navigation }: RootScreen<'EditProfile'>) {
  const me = useAuth(s => s.me)!;
  const setMe = useAuth(s => s.setMe);
  const bike = me.motorcycles[0];
  const [f, setF] = useState({
    display_name: me.profile.display_name,
    phone: me.profile.phone ?? '',
    emergency_contact_name: me.profile.emergency_contact_name ?? '',
    emergency_contact_phone: me.profile.emergency_contact_phone ?? '',
    blood_group: me.profile.blood_group ?? '',
    make: bike?.make ?? '',
    model: bike?.model ?? '',
    year: bike?.year ? String(bike.year) : '',
    color: bike?.color ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const orNull = (s: string) => (s.trim() ? s.trim() : null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const updated = await Users.update({
        display_name: f.display_name.trim(),
        phone: orNull(f.phone),
        emergency_contact_name: orNull(f.emergency_contact_name),
        emergency_contact_phone: orNull(f.emergency_contact_phone),
        blood_group: orNull(f.blood_group.toUpperCase()),
        ...(f.make.trim() && f.model.trim()
          ? { motorcycle: { make: f.make.trim(), model: f.model.trim(), year: f.year ? Number(f.year) : null, color: orNull(f.color) } }
          : {}),
      });
      setMe(updated);
      navigation.goBack();
    } catch (e: any) {
      setErr(e?.detail ?? e?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Gap />
      <Txt v="title">Edit profile</Txt>
      <Gap />
      <InlineError message={err} />
      <Field label="Rider name" value={f.display_name} onChangeText={set('display_name')} />
      <Field label="Phone (optional)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" hint="Never shown to other riders" />
      <SectionHeader title="MOTORCYCLE" />
      <Field label="Make" value={f.make} onChangeText={set('make')} placeholder="Royal Enfield" />
      <Field label="Model" value={f.model} onChangeText={set('model')} placeholder="Himalayan 450" />
      <Row gap={space.md}>
        <Field label="Year" value={f.year} onChangeText={set('year')} keyboardType="number-pad" maxLength={4} style={{ flex: 1 }} />
        <Field label="Colour" value={f.color} onChangeText={set('color')} style={{ flex: 1 }} />
      </Row>
      <SectionHeader title="EMERGENCY" />
      <Field label="Contact name" value={f.emergency_contact_name} onChangeText={set('emergency_contact_name')} />
      <Field label="Contact phone" value={f.emergency_contact_phone} onChangeText={set('emergency_contact_phone')} keyboardType="phone-pad" hint="Shown to your ride group only when you raise an emergency" />
      <Field label="Blood group (optional)" value={f.blood_group} onChangeText={set('blood_group')} autoCapitalize="characters" maxLength={3} placeholder="O+" />
      <Button title="Save" size="lg" loading={busy} disabled={!f.display_name.trim()} onPress={save} />
    </Screen>
  );
}

export function SettingsScreen() {
  const { c } = useTheme();
  const s = useSettings();
  const conn = useConnection();
  const [server, setServer] = useState(apiBaseUrl());
  const [spotifyId, setSpotifyId] = useState('');
  return (
    <Screen>
      <Gap />
      <Txt v="title">Settings</Txt>
      <SectionHeader title="DISPLAY" />
      <Bezel>
        <Toggle label="High-contrast night mode" hint="Pure black, brighter text and borders" value={s.nightMode} onChange={v => s.set({ nightMode: v })} />
      </Bezel>
      <SectionHeader title="AUDIO" />
      <Bezel>
        <Toggle label="Spoken announcements" hint="Stop requests and announcements via text-to-speech. Emergencies are always spoken." value={s.ttsEnabled} onChange={v => s.set({ ttsEnabled: v })} />
        <Divider />
        <Label>MUSIC VOLUME WHILE VOICE PLAYS</Label>
        <Gap h={space.sm} />
        <Segmented value={String(s.duckLevel)} onChange={v => s.set({ duckLevel: Number(v) })} options={[{ value: '0', label: 'Mute' }, { value: '0.2', label: '20%' }, { value: '0.4', label: '40%' }]} />
        <Divider />
        <Toggle label="Phone speaker fallback" hint="If the helmet disconnects, play through the phone speaker. Off by default." value={s.speakerFallback} onChange={v => s.set({ speakerFallback: v })} />
      </Bezel>
      <SectionHeader title="LOCATION" />
      <Bezel>
        <Label>SHARE POSITION EVERY</Label>
        <Gap h={space.sm} />
        <Segmented value={String(s.locationIntervalSec)} onChange={v => s.set({ locationIntervalSec: Number(v) as any })} options={[{ value: '5', label: '5 s' }, { value: '10', label: '10 s' }, { value: '30', label: '30 s' }, { value: '60', label: '60 s' }]} />
        <Txt v="small" faint style={{ marginTop: space.sm }}>Longer intervals save battery. Your location is shared only with riders in your active ride.</Txt>
      </Bezel>
      <SectionHeader title="OFFLINE MODE" />
      <Bezel>
        <Toggle label="Nearby riders mesh" hint="Link with nearby phones when there's no signal (Android, Google Play services)" value={s.nearbyEnabled} onChange={v => s.set({ nearbyEnabled: v })} />
        <Row style={{ marginTop: space.sm, justifyContent: 'space-between' }}>
          <Label>STATUS</Label>
          <StatusTag label={conn.nearby === 'unsupported' ? 'Not supported here' : conn.nearby} tone={conn.nearby === 'connected' ? 'live' : conn.nearby === 'error' || conn.nearby === 'unsupported' ? 'danger' : 'dim'} />
        </Row>
        {conn.nearbyError && <Txt v="small" color={c.warn}>{conn.nearbyError}</Txt>}
        <Row style={{ marginTop: space.sm, justifyContent: 'space-between' }}>
          <Label>QUEUED FOR SYNC</Label>
          <Txt v="small">{conn.outbox} event{conn.outbox === 1 ? '' : 's'}{conn.lastSyncAt ? ` · last sync ${ago(Date.now() - conn.lastSyncAt)}` : ''}</Txt>
        </Row>
      </Bezel>
      <SectionHeader title="NOTIFICATIONS" />
      <Bezel>
        <Toggle label="Stop requests" value={s.notifyStops} onChange={v => s.set({ notifyStops: v })} />
        <Toggle label="Riders joining / disconnecting" value={s.notifyRiders} onChange={v => s.set({ notifyRiders: v })} />
        <Txt v="small" faint>Emergencies always notify.</Txt>
      </Bezel>
      <SectionHeader title="SPOTIFY" />
      <Bezel>
        <Field label="Spotify app Client ID" value={spotifyId} onChangeText={setSpotifyId} autoCapitalize="none" placeholder={Spotify.configured() ? 'Configured — paste to replace' : 'From developer.spotify.com'} />
        <Row gap={space.md}>
          <Button title="Save" kind="quiet" style={{ flex: 1 }} disabled={!spotifyId.trim()} onPress={() => (Spotify.setClientId(spotifyId), setSpotifyId(''))} />
          <Button title="Disconnect" kind="ghost" style={{ flex: 1 }} onPress={() => Spotify.disconnect()} />
        </Row>
      </Bezel>
      <SectionHeader title="SERVER" />
      <Bezel>
        <Field label="RideWave server" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" />
        <Button title="Save server" kind="quiet" onPress={() => setApiBaseUrl(server.trim())} />
      </Bezel>
      <SectionHeader title="PRIVACY" />
      <Bezel>
        <Txt v="small" dim>
          Location is visible only to riders in your active ride and stops when the ride ends. Your phone number and e-mail are never shown to other riders. Turn off location sharing per ride from the ride screen.
        </Txt>
        <Button title="App permissions" kind="ghost" style={{ marginTop: space.md }} onPress={() => Linking.openSettings()} />
      </Bezel>
    </Screen>
  );
}

export function RideHistoryScreen({ route }: RootScreen<'RideHistory'>) {
  const q = useQuery({ queryKey: ['ride-log', route.params.rideId], queryFn: () => rideLog(route.params.rideId) });
  return (
    <Screen>
      <Gap />
      <Txt v="title">Ride log</Txt>
      <Txt dim>Events this phone recorded during the ride.</Txt>
      <Gap />
      {q.data?.length ? (
        q.data
          .filter(e => !['LOCATION_UPDATED', 'DELIVERY_ACK'].includes(e.type))
          .map(e => (
            <Row key={e.event_id} style={{ paddingVertical: space.sm }} center={false}>
              <Label style={{ width: 64 }}>{new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</Label>
              <View style={{ flex: 1 }}>
                <Txt>{e.payload?.announcement ?? e.payload?.text ?? e.type.replace(/_/g, ' ').toLowerCase()}</Txt>
                <Txt v="small" faint>via {e.transport}</Txt>
              </View>
            </Row>
          ))
      ) : (
        <Txt dim>No events recorded on this phone.</Txt>
      )}
    </Screen>
  );
}
