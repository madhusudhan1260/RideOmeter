import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { check, Permission, PERMISSIONS, request, RESULTS } from 'react-native-permissions';
import { StatusTag } from '../../components/cluster';
import { Icon, IconName } from '../../components/Icon';
import { Bezel, Button, Gap, Label, Row, Screen, Txt } from '../../components/primitives';
import type { RootScreen } from '../../navigation/types';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

type Item = { key: string; icon: IconName; title: string; why: string; perms: Permission[]; optional?: boolean };

const A = PERMISSIONS.ANDROID;

const ITEMS: Item[] =
  Platform.OS === 'android'
    ? [
        { key: 'mic', icon: 'mic', title: 'Microphone', why: 'To talk to your group over the intercom.', perms: [A.RECORD_AUDIO] },
        { key: 'loc', icon: 'pin', title: 'Location', why: 'To share your position with riders in your ride only, and to find nearby riders offline.', perms: [A.ACCESS_FINE_LOCATION] },
        {
          key: 'nearby',
          icon: 'nearby',
          title: 'Nearby devices & Bluetooth',
          why: 'To detect your helmet headset and link with nearby riders when there is no signal.',
          perms: Number(Platform.Version) >= 31 ? [A.BLUETOOTH_CONNECT, A.BLUETOOTH_SCAN, A.BLUETOOTH_ADVERTISE, ...(Number(Platform.Version) >= 33 ? [A.NEARBY_WIFI_DEVICES] : [])] : [],
        },
        { key: 'notif', icon: 'bell', title: 'Notifications', why: 'For stop requests and emergencies while the screen is off.', perms: Number(Platform.Version) >= 33 ? ['android.permission.POST_NOTIFICATIONS' as Permission] : [] },
        { key: 'cam', icon: 'qr', title: 'Camera', why: 'Only to scan ride invitation QR codes.', perms: [A.CAMERA], optional: true },
        { key: 'media', icon: 'music', title: 'Music files', why: 'To play songs stored on your phone in group music.', perms: Number(Platform.Version) >= 33 ? [A.READ_MEDIA_AUDIO] : [A.READ_EXTERNAL_STORAGE], optional: true },
      ]
    : [
        { key: 'mic', icon: 'mic', title: 'Microphone', why: 'To talk to your group over the intercom.', perms: [PERMISSIONS.IOS.MICROPHONE] },
        { key: 'loc', icon: 'pin', title: 'Location', why: 'To share your position with riders in your ride only.', perms: [PERMISSIONS.IOS.LOCATION_WHEN_IN_USE] },
        { key: 'cam', icon: 'qr', title: 'Camera', why: 'Only to scan ride invitation QR codes.', perms: [PERMISSIONS.IOS.CAMERA], optional: true },
      ];

type State = 'granted' | 'denied' | 'blocked' | 'unknown';

export function PermissionsScreen({ navigation }: RootScreen<'Permissions'>) {
  const { c } = useTheme();
  const [state, setState] = useState<Record<string, State>>({});

  const refresh = useCallback(async () => {
    const next: Record<string, State> = {};
    for (const it of ITEMS) {
      if (!it.perms.length) {
        next[it.key] = 'granted';
        continue;
      }
      const rs = await Promise.all(it.perms.map(p => check(p)));
      next[it.key] = rs.every(r => r === RESULTS.GRANTED || r === RESULTS.LIMITED) ? 'granted' : rs.some(r => r === RESULTS.BLOCKED) ? 'blocked' : 'denied';
    }
    setState(next);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ask = async (it: Item) => {
    if (state[it.key] === 'blocked') return Linking.openSettings();
    for (const p of it.perms) await request(p);
    refresh();
  };

  const requiredOk = ITEMS.filter(i => !i.optional).every(i => state[i.key] === 'granted');

  return (
    <Screen>
      <Gap h={space.xl} />
      <Label color={c.accent}>STEP 1 OF 2</Label>
      <Txt v="title" style={{ marginTop: space.xs }}>
        Permissions
      </Txt>
      <Txt dim style={{ marginTop: space.sm }}>
        RideOmeter only asks for what the ride features need. You can change these later in Android settings.
      </Txt>
      <Gap />
      {ITEMS.map(it => {
        const st = state[it.key] ?? 'unknown';
        return (
          <Bezel key={it.key} style={{ marginBottom: space.md }}>
            <Row center={false}>
              <Icon name={it.icon} color={st === 'granted' ? c.live : c.accent} />
              <View style={{ flex: 1 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt v="bodyStrong">
                    {it.title}
                    {it.optional ? <Txt v="small" faint>  optional</Txt> : null}
                  </Txt>
                  <StatusTag label={st === 'granted' ? 'Allowed' : st === 'blocked' ? 'Blocked' : 'Not yet'} tone={st === 'granted' ? 'live' : st === 'blocked' ? 'danger' : 'dim'} />
                </Row>
                <Txt v="small" dim style={{ marginTop: 2 }}>
                  {it.why}
                </Txt>
                {st !== 'granted' && (
                  <Button title={st === 'blocked' ? 'Open settings' : 'Allow'} kind="quiet" onPress={() => ask(it)} style={{ marginTop: space.md, alignSelf: 'flex-start' }} />
                )}
              </View>
            </Row>
          </Bezel>
        );
      })}
      <Gap />
      <Button title={requiredOk ? 'Continue' : 'Continue anyway'} size="lg" onPress={() => navigation.navigate('DeviceSetup', { fromOnboarding: true })} />
      {!requiredOk && (
        <Txt v="small" faint center style={{ marginTop: space.sm }}>
          Intercom and location sharing stay off until their permission is allowed.
        </Txt>
      )}
    </Screen>
  );
}
