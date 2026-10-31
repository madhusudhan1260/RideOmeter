import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Rides } from '../../api/endpoints';
import type { Place, VoiceMode } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Bezel, Button, Field, Gap, IconButton, InlineError, Label, ListRow, Row, Screen, Segmented, Toggle, Txt } from '../../components/primitives';
import type { RootScreen } from '../../navigation/types';
import { LocationService } from '../../services/location/LocationService';
import { PlaceHit, routePolyline, searchPlaces } from '../../services/location/geocode';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space, touch } from '../../theme/tokens';
import { formatDistance } from '../../utils/geo';

function PlacePicker({ label, value, onChange, allowGps }: { label: string; value: Place | null; onChange: (p: Place | null) => void; allowGps?: boolean }) {
  const { c } = useTheme();
  const [q, setQ] = useState(value?.name ?? '');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Text that came from picking a result — don't search it again.
  const picked = useRef<string | null>(null);

  const search = async (text = q) => {
    if (text.trim().length < 3) return setHits([]);
    setBusy(true);
    setErr(null);
    try {
      setHits(await searchPlaces(text));
    } catch (e: any) {
      setErr(e?.message ?? 'Search failed — you can still type a place name');
    } finally {
      setBusy(false);
    }
  };

  // Search as you type, debounced (Nominatim allows ~1 request/second).
  useEffect(() => {
    if (picked.current === q) return;
    const t = setTimeout(() => search(q), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const useGps = async () => {
    setBusy(true);
    const fix = (await LocationService.ensurePermission()) ? await LocationService.current() : null;
    setBusy(false);
    if (!fix) return setErr('No GPS fix right now');
    const name = q.trim() || 'My location';
    picked.current = name;
    setQ(name);
    onChange({ name, lat: fix.lat, lng: fix.lng });
    setHits([]);
  };

  return (
    <View>
      <Field
        label={label}
        value={q}
        onChangeText={t => {
          setQ(t);
          onChange(t.trim() ? { name: t.trim() } : null);
        }}
        onSubmitEditing={() => search()}
        returnKeyType="search"
        placeholder="Search a place"
        hint={value?.lat != null ? `Pinned on map · ${value.lat.toFixed(4)}, ${value.lng?.toFixed(4)}` : 'Pick a result below to pin it on the map'}
        error={err}
      />
      <Row style={{ marginTop: -space.sm, marginBottom: space.md }} gap={space.sm}>
        {allowGps && <Button title="Use my GPS location" kind="quiet" icon="pin" onPress={useGps} style={{ flex: 1 }} />}
      </Row>
      {busy && <ActivityIndicator color={c.accent} />}
      {hits.map(h => (
        <ListRow
          key={`${h.lat},${h.lng}`}
          icon="pin"
          title={h.name}
          subtitle={h.detail}
          onPress={() => {
            picked.current = h.name;
            setQ(h.name);
            onChange({ name: h.name, lat: h.lat, lng: h.lng });
            setHits([]);
          }}
        />
      ))}
    </View>
  );
}

function DateTimePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const { c } = useTheme();
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return d;
  }), []);
  const setDay = (d: Date) => {
    const n = new Date(value);
    n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    onChange(n);
  };
  const bump = (mins: number) => onChange(new Date(value.getTime() + mins * 60_000));
  return (
    <View>
      <Label>DATE</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: space.sm }} contentContainerStyle={{ gap: space.sm }}>
        {days.map((d, i) => {
          const on = d.toDateString() === value.toDateString();
          return (
            <Pressable key={d.toISOString()} onPress={() => setDay(d)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ width: 62, height: 72, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.accent : c.bezel, backgroundColor: on ? c.accentSoft : c.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Txt v="label" caps color={on ? c.accent : c.textFaint}>{i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</Txt>
              <Txt v="heading" color={on ? c.accent : c.text}>{d.getDate()}</Txt>
            </Pressable>
          );
        })}
      </ScrollView>
      <Label>START TIME</Label>
      <Row style={{ marginTop: space.sm, justifyContent: 'space-between' }}>
        <IconButton icon="chevronLeft" label="Earlier by 15 minutes" onPress={() => bump(-15)} size={touch.ride} />
        <Txt v="hero" style={{ fontVariant: ['tabular-nums'] }}>{value.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</Txt>
        <IconButton icon="chevronRight" label="Later by 15 minutes" onPress={() => bump(15)} size={touch.ride} />
      </Row>
      <Row style={{ justifyContent: 'center', marginTop: space.sm }} gap={space.sm}>
        {[-60, 60].map(m => (
          <Button key={m} title={m < 0 ? '− 1 h' : '+ 1 h'} kind="ghost" onPress={() => bump(m)} />
        ))}
      </Row>
    </View>
  );
}

export function CreateRideScreen({ navigation }: RootScreen<'CreateRide'>) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState<Place | null>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setHours(6, 0, 0, 0);
    return d;
  });
  const [max, setMax] = useState(10);
  const [isPublic, setPublic] = useState(false);
  const [approval, setApproval] = useState(false);
  const [voice, setVoice] = useState<VoiceMode>('PUSH_TO_TALK');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<string | null>(null);

  const submit = async () => {
    if (!start || !dest) return;
    setBusy(true);
    setErr(null);
    try {
      let polyline: string | undefined;
      if (start.lat != null && dest.lat != null) {
        const r = await routePolyline({ lat: start.lat, lng: start.lng! }, { lat: dest.lat, lng: dest.lng! }).catch(() => null);
        if (r) {
          polyline = r.polyline;
          setRouteInfo(`${formatDistance(r.distanceM)} · about ${Math.round(r.durationS / 60)} min`);
        }
      }
      const ride = await Rides.create({
        name: name.trim(),
        description: description.trim() || undefined,
        start,
        destination: dest,
        scheduled_at: when.toISOString(),
        max_participants: max,
        visibility: isPublic ? 'PUBLIC' : 'PRIVATE',
        requires_approval: approval,
        voice_mode: voice,
        ...(polyline ? { route_polyline: polyline } : {}),
      });
      qc.invalidateQueries({ queryKey: ['rides'] });
      navigation.replace('RideInvite', { rideId: ride.id });
    } catch (e: any) {
      setErr(e?.detail ?? e?.message ?? 'Could not create ride');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Gap />
      <Txt v="title">New ride</Txt>
      <Txt dim>You'll be the ride admin.</Txt>
      <Gap />
      <InlineError message={err} />
      <Field label="Ride name" value={name} onChangeText={setName} placeholder="Sunrise run to Nandi Hills" maxLength={80} />
      <PlacePicker label="Starting point" value={start} onChange={setStart} allowGps />
      <PlacePicker label="Destination" value={dest} onChange={setDest} />
      <Bezel>
        <DateTimePicker value={when} onChange={setWhen} />
      </Bezel>
      <Gap />
      <Field label="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={2000} placeholder="Meeting point, pace, fuel plan…" />

      <Label>MAX RIDERS</Label>
      <Row style={{ marginVertical: space.sm, justifyContent: 'space-between' }}>
        <IconButton icon="chevronLeft" label="Fewer riders" onPress={() => setMax(m => Math.max(2, m - 1))} size={touch.ride} />
        <Txt v="numeral">{max}</Txt>
        <IconButton icon="chevronRight" label="More riders" onPress={() => setMax(m => Math.min(50, m + 1))} size={touch.ride} />
      </Row>
      <Txt v="small" faint>The offline mesh is tested with up to 5 phones; online voice has no such limit.</Txt>
      <Gap />

      <Label>INTERCOM MODE</Label>
      <Gap h={space.sm} />
      <Segmented<VoiceMode>
        value={voice}
        onChange={setVoice}
        options={[
          { value: 'PUSH_TO_TALK', label: 'Push to talk' },
          { value: 'OPEN_MIC', label: 'Open mic' },
          { value: 'ADMIN_ONLY', label: 'Admin only' },
        ]}
      />
      <Gap />
      <Bezel>
        <Toggle label="Public ride" hint="Shown under Open rides; anyone can request to join" value={isPublic} onChange={setPublic} />
        <Toggle label="Approve riders before they join" value={approval} onChange={setApproval} />
      </Bezel>
      {routeInfo && (
        <Row style={{ marginTop: space.md }}>
          <Icon name="route" size={18} />
          <Txt v="small" dim>{routeInfo}</Txt>
        </Row>
      )}
      <Gap h={space.xl} />
      <Button title="Create ride & get invite" size="lg" loading={busy} disabled={name.trim().length < 2 || !start || !dest} onPress={submit} />
      <Txt v="small" faint center style={{ marginTop: space.sm }}>
        Routes come from OpenStreetMap data and are a guide only — they are not checked for road safety.
      </Txt>
    </Screen>
  );
}
