import React, { useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { StatusTag } from '../../components/cluster';
import { Icon } from '../../components/Icon';
import { Bezel, Button, Divider, Gap, Label, ListRow, Row, Screen, Txt } from '../../components/primitives';
import { AudioRouting, hasHelmetMic, isHelmet } from '../../native/RideWaveAudio';
import type { RootScreen } from '../../navigation/types';
import { HelmetMonitor } from '../../services/audio/HelmetMonitor';
import { useAudio } from '../../store/media';
import { useSettings } from '../../store/settings';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { ago } from '../../utils/freshness';

/** Helmet headset check: what the OS reports, plus real speaker and mic tests. */
export function DeviceSetupScreen({ navigation, route }: RootScreen<'DeviceSetup'>) {
  const { c } = useTheme();
  const audio = useAudio();
  const [busy, setBusy] = useState<'spk' | 'mic' | null>(null);
  const fromOnboarding = route.params?.fromOnboarding;
  const supported = AudioRouting.available();

  useEffect(() => {
    HelmetMonitor.start();
  }, []);

  const helmet = audio.devices.find(hasHelmetMic) ?? audio.devices.find(isHelmet) ?? null;

  const speakerTest = async () => {
    setBusy('spk');
    try {
      const r = await HelmetMonitor.runSpeakerTest();
      setBusy(null);
      if (!r.played) {
        useAudio.getState().patch({ speakerTest: { ok: false, at: Date.now(), detail: 'Tone could not be played' } });
        return;
      }
      // Only the rider can know if they heard it.
      Alert.alert('Did you hear the tone?', `Played through ${r.routedTo?.name ?? 'the phone'}.`, [
        { text: 'No', style: 'destructive', onPress: () => useAudio.getState().patch({ speakerTest: { ok: false, at: Date.now(), detail: 'Rider did not hear the tone' } }) },
        { text: 'Yes', onPress: () => useAudio.getState().patch({ speakerTest: { ok: true, at: Date.now(), detail: `Heard via ${r.routedTo?.name ?? 'phone'}` } }) },
      ]);
    } catch (e: any) {
      setBusy(null);
      useAudio.getState().patch({ speakerTest: { ok: false, at: Date.now(), detail: e?.message ?? 'Test failed' } });
    }
  };

  const micTest = async () => {
    setBusy('mic');
    try {
      await HelmetMonitor.runMicTest();
    } catch (e: any) {
      useAudio.getState().patch({ micTest: { ok: false, at: Date.now(), detail: e?.message ?? 'Test failed' } });
    } finally {
      setBusy(null);
    }
  };

  const finish = () => {
    if (fromOnboarding) {
      useSettings.getState().set({ onboarded: true });
      navigation.reset({ index: 0, routes: [{ name: 'Register' }] });
    } else navigation.goBack();
  };

  return (
    <Screen>
      <Gap h={space.xl} />
      {fromOnboarding && <Label color={c.accent}>STEP 2 OF 2</Label>}
      <Txt v="title" style={{ marginTop: space.xs }}>
        Helmet headset
      </Txt>
      <Txt dim style={{ marginTop: space.sm }}>
        Pair your helmet in Android Bluetooth settings first. RideWave then routes the intercom and announcements to it.
      </Txt>
      <Gap />

      <Bezel tone={helmet ? 'accent' : undefined}>
        <Row>
          <Icon name="helmet" size={36} color={helmet ? c.accent : c.textFaint} />
          <View style={{ flex: 1 }}>
            <Txt v="heading">{helmet ? helmet.name : supported ? 'No headset connected' : 'Not available'}</Txt>
            <Txt v="small" dim>
              {!supported
                ? 'Headset routing needs the Android build of RideWave.'
                : helmet
                  ? hasHelmetMic(helmet)
                    ? 'Connected with microphone (hands-free profile)'
                    : 'Connected for music only — no microphone profile reported'
                  : 'Turn the headset on and connect it to this phone.'}
            </Txt>
          </View>
          <StatusTag label={helmet ? 'Connected' : 'Offline'} tone={helmet ? 'live' : 'dim'} />
        </Row>
        {supported && !helmet && <Button title="Open Bluetooth settings" kind="quiet" icon="settings" style={{ marginTop: space.lg }} onPress={() => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => Linking.openSettings())} />}
      </Bezel>

      <Gap />
      <Label>TESTS</Label>
      <Gap h={space.sm} />
      <Bezel>
        <ListRow
          icon="speaker"
          title="Speaker test"
          subtitle={audio.speakerTest ? `${audio.speakerTest.detail} · ${ago(Date.now() - audio.speakerTest.at)}` : 'Plays a short tone through the current route'}
          right={audio.speakerTest ? <StatusTag label={audio.speakerTest.ok ? 'Speaker working' : 'Failed'} tone={audio.speakerTest.ok ? 'live' : 'danger'} /> : undefined}
        />
        <Button title="Play tone" kind="quiet" loading={busy === 'spk'} disabled={!supported || !!busy} onPress={speakerTest} />
        <Divider />
        <ListRow
          icon="mic"
          title="Microphone test"
          subtitle={audio.micTest ? `${audio.micTest.detail} · ${ago(Date.now() - audio.micTest.at)}` : 'Records 3 seconds — say a few words'}
          right={audio.micTest ? <StatusTag label={audio.micTest.ok ? 'Microphone working' : 'Too quiet'} tone={audio.micTest.ok ? 'live' : 'danger'} /> : undefined}
        />
        <Button title={busy === 'mic' ? 'Listening… speak now' : 'Test microphone'} kind="quiet" loading={busy === 'mic'} disabled={!supported || !!busy} onPress={micTest} />
      </Bezel>

      {audio.speakerTest?.ok && audio.micTest?.ok && (
        <Row style={{ marginTop: space.lg, justifyContent: 'center' }}>
          <Icon name="check" color={c.live} />
          <Txt v="bodyStrong" color={c.live}>
            Audio test successful
          </Txt>
        </Row>
      )}

      <Gap />
      <Txt v="small" faint>
        Helmets differ: some only allow one phone, some drop music quality while the mic is open (that is the Bluetooth hands-free profile, not a fault).
      </Txt>
      <Gap h={space.xl} />
      <Button title={fromOnboarding ? (helmet ? 'Finish setup' : 'Skip for now') : 'Done'} size="lg" onPress={finish} />
    </Screen>
  );
}
