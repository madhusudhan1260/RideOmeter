import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
import { Rides } from '../../api/endpoints';
import { Button, ErrorState, Field, Gap, InlineError, Label, LoadingState, Row, Screen, Txt } from '../../components/primitives';
import type { RootScreen } from '../../navigation/types';
import { useTheme } from '../../theme/ThemeProvider';
import { parseJoinCode } from '../../utils/joinCode';
import { radius, space } from '../../theme/tokens';

export function RideInviteScreen({ route, navigation }: RootScreen<'RideInvite'>) {
  const { c } = useTheme();
  const { rideId } = route.params;
  const q = useQuery({ queryKey: ['ride', rideId], queryFn: () => Rides.get(rideId) });
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Screen><LoadingState /></Screen>;
  if (q.isError || !q.data) return <Screen><ErrorState error={q.error} onRetry={q.refetch} /></Screen>;
  const ride = q.data;
  if (!ride.join_code) return <Screen><ErrorState error={{ detail: 'Only the ride admin can share the invite.' }} /></Screen>;
  const link = ride.invite_link ?? '';

  const regenerate = async () => {
    setBusy(true);
    try {
      qc.setQueryData(['ride', rideId], await Rides.regenerateCode(rideId));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Gap />
      <Label color={c.accent}>INVITE RIDERS</Label>
      <Txt v="title">{ride.name}</Txt>
      <Gap h={space.xl} />
      <View style={{ alignItems: 'center' }}>
        <View style={{ padding: space.lg, backgroundColor: '#FFFFFF', borderRadius: radius.lg }}>
          <QRCode value={link} size={220} color="#0B0C0E" backgroundColor="#FFFFFF" />
        </View>
        <Gap />
        <Label>JOIN CODE</Label>
        <Txt v="hero" style={{ letterSpacing: 6, fontVariant: ['tabular-nums'] }} selectable>
          {ride.join_code}
        </Txt>
        <Txt v="small" faint center>
          Riders scan this, open the link, or type the code in Join ride.
        </Txt>
      </View>
      <Gap h={space.xl} />
      <Button title="Share invite link" icon="share" size="lg" onPress={() => Share.share({ message: `Join my RideOmeter ride "${ride.name}": ${link} (code ${ride.join_code})` })} />
      <Gap h={space.md} />
      <Row gap={space.md}>
        <Button title="New code" kind="ghost" loading={busy} onPress={regenerate} style={{ flex: 1 }} />
        <Button title="Open ride" kind="quiet" onPress={() => navigation.replace('ActiveRide', { rideId })} style={{ flex: 1 }} />
      </Row>
      <Txt v="small" faint style={{ marginTop: space.sm }}>
        A new code stops the old one from working.
      </Txt>
    </Screen>
  );
}

export function JoinRideScreen({ route, navigation }: RootScreen<'JoinRide'>) {
  const qc = useQueryClient();
  const [code, setCode] = useState(route.params?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const join = async (raw = code) => {
    const parsed = parseJoinCode(raw);
    if (!parsed) return setErr('That does not look like a RideOmeter code');
    setBusy(true);
    setErr(null);
    try {
      const ride = await Rides.joinByCode(parsed);
      qc.invalidateQueries({ queryKey: ['rides'] });
      navigation.replace('ActiveRide', { rideId: ride.id });
    } catch (e: any) {
      setErr(e?.detail ?? e?.message ?? 'Could not join');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (route.params?.code) join(route.params.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.code]);

  return (
    <Screen>
      <Gap />
      <Txt v="title">Join a ride</Txt>
      <Txt dim>Scan the admin's QR code or enter the 8-character code.</Txt>
      <Gap h={space.xl} />
      <Button title="Scan QR code" icon="qr" size="lg" onPress={() => navigation.navigate('ScanQR')} />
      <Gap h={space.xl} />
      <InlineError message={err} />
      <Field label="Join code" value={code} onChangeText={t => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={64} placeholder="e.g. K7MXQ2PA" onSubmitEditing={() => join()} />
      <Button title="Join ride" size="lg" kind="quiet" loading={busy} disabled={code.trim().length < 4} onPress={() => join()} />
    </Screen>
  );
}

export function ScanQRScreen({ navigation }: RootScreen<'ScanQR'>) {
  const { c } = useTheme();
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [done, setDone] = useState(false);
  const scanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      if (done) return;
      const val = codes[0]?.value;
      const parsed = val ? parseJoinCode(val) : null;
      if (parsed) {
        setDone(true);
        navigation.replace('JoinRide', { code: parsed });
      }
    },
  });

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  if (!hasPermission)
    return (
      <Screen>
        <Gap />
        <ErrorState error={{ detail: 'Camera permission is needed to scan. You can type the code instead.' }} />
        <Button title="Open settings" kind="quiet" onPress={() => Linking.openSettings()} />
      </Screen>
    );
  if (!device) return <Screen><ErrorState error={{ detail: 'No camera available on this device.' }} /></Screen>;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive={!done} codeScanner={scanner} />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 250, height: 250, borderRadius: radius.xl, borderWidth: 3, borderColor: c.accent }} />
        <Txt v="bodyStrong" style={{ marginTop: space.xl }}>
          Point at the ride QR code
        </Txt>
      </View>
    </View>
  );
}
