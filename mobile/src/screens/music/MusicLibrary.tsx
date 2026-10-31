import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Music } from '../../api/endpoints';
import type { Track } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Bezel, Button, EmptyState, Field, Gap, Label, ListRow, LoadingState, Row, Screen, Segmented, Txt } from '../../components/primitives';
import type { RootScreen } from '../../navigation/types';
import { RideSession } from '../../services/RideSession';
import { LibraryTrack, LocalLibrary } from '../../services/music/LocalLibrary';
import { MusicController } from '../../services/music/MusicController';
import { Spotify } from '../../services/music/Spotify';
import { isAdminRole, useRide } from '../../store/ride';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

const toTrack = (t: LibraryTrack): Track => ({ source: 'LOCAL', ref: t.ref, title: t.title, artist: t.artist, album: t.album, duration_ms: t.durationMs });

export function MusicLibraryScreen({ navigation }: RootScreen<'MusicLibrary'>) {
  const { c } = useTheme();
  const ride = useRide(s => s.ride);
  const admin = isAdminRole(ride?.my_role);
  const [tab, setTab] = useState<'LOCAL' | 'SPOTIFY'>('LOCAL');
  const [lib, setLib] = useState<LibraryTrack[] | null>(null);
  const [picked, setPicked] = useState<Track[]>([]);
  const [scanning, setScanning] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Track[]>([]);
  const [spotifyState, setSpotifyState] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => setLib(await LocalLibrary.all()), []);
  useEffect(() => {
    load();
  }, [load]);

  const scan = async () => {
    setScanning(true);
    try {
      const found = await LocalLibrary.scanDevice();
      for (const t of found) await LocalLibrary.add(t);
      await load();
      if (!found.length) Alert.alert('Library', 'No new audio files found on this phone.');
    } catch (e: any) {
      Alert.alert('Scan failed', e?.message ?? 'Allow music file access in Permissions.');
    } finally {
      setScanning(false);
    }
  };

  const toggle = (t: Track) => setPicked(p => (p.some(x => x.ref === t.ref) ? p.filter(x => x.ref !== t.ref) : [...p, t]));

  const searchSpotify = async () => {
    setSpotifyState(null);
    try {
      if (!(await Spotify.isConnected())) await Spotify.connect();
      const prof = await Spotify.profile();
      if (prof.product !== 'premium') setSpotifyState('Your Spotify account is not Premium — group playback control will not work for you.');
      setHits(await Spotify.searchTracks(q));
    } catch (e: any) {
      setSpotifyState(e?.message ?? 'Spotify unavailable');
    }
  };

  const sendQueue = async () => {
    if (!ride || !picked.length) return;
    setSending(true);
    try {
      const st = await Music.queue(ride.id, tab, picked.filter(t => t.source === tab));
      await MusicController.apply(st, true);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not set queue', e?.detail ?? e?.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <Gap />
      <Txt v="title">Music library</Txt>
      <Txt dim>{admin ? 'Pick songs to play for the group.' : 'Add the songs your admin will play, so your phone can join in.'}</Txt>
      <Gap />
      <Segmented value={tab} onChange={v => (setTab(v), setPicked([]))} options={[{ value: 'LOCAL', label: 'On this phone' }, { value: 'SPOTIFY', label: 'Spotify' }]} />
      <Gap />
      {tab === 'LOCAL' ? (
        <>
          <Button title="Scan phone for music" icon="music" kind="quiet" loading={scanning} onPress={scan} />
          <Gap />
          {lib == null ? (
            <LoadingState />
          ) : lib.length === 0 ? (
            <EmptyState icon="music" title="No songs yet" body="Only files stored on this phone are used. Everyone in the group needs the same file for it to play in sync." />
          ) : (
            <Bezel>
              {lib.map(t => {
                const on = picked.some(p => p.ref === t.ref);
                return (
                  <ListRow
                    key={t.ref}
                    icon="music"
                    title={t.title}
                    subtitle={t.artist ?? undefined}
                    onPress={admin && RideSession.active ? () => toggle(toTrack(t)) : undefined}
                    right={on ? <Icon name="check" color={c.accent} /> : undefined}
                  />
                );
              })}
            </Bezel>
          )}
        </>
      ) : (
        <>
          {!Spotify.configured() ? (
            <Bezel>
              <Label>SETUP NEEDED</Label>
              <Txt dim style={{ marginTop: space.xs }}>
                Create a free app at developer.spotify.com, add redirect URI com.ridewave.app:/spotify-callback, then paste the Client ID in Settings.
              </Txt>
              <Button title="Open settings" kind="quiet" style={{ marginTop: space.md }} onPress={() => navigation.navigate('Settings')} />
            </Bezel>
          ) : (
            <>
              <Field label="Search Spotify" value={q} onChangeText={setQ} onSubmitEditing={searchSpotify} returnKeyType="search" />
              <Button title="Search" kind="quiet" onPress={searchSpotify} disabled={q.trim().length < 2} />
              {spotifyState && <Txt v="small" color={c.warn} style={{ marginTop: space.sm }}>{spotifyState}</Txt>}
              <Gap />
              {hits.map(t => (
                <ListRow key={t.ref} icon="music" title={t.title} subtitle={t.artist ?? undefined} onPress={admin ? () => toggle(t) : undefined}
                  right={picked.some(p => p.ref === t.ref) ? <Icon name="check" color={c.accent} /> : undefined} />
              ))}
            </>
          )}
        </>
      )}
      {admin && RideSession.active && picked.length > 0 && (
        <View style={{ marginTop: space.xl }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: space.sm }}>
            <Label>{picked.length} SELECTED</Label>
            <Txt v="small" color={c.accent} onPress={() => setPicked([])}>Clear</Txt>
          </Row>
          <Button title="Set as group queue" size="lg" loading={sending} onPress={sendQueue} />
        </View>
      )}
    </Screen>
  );
}
