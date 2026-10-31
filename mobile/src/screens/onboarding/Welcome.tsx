import React from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { Icon, IconName } from '../../components/Icon';
import { Button, Gap, Label, Row, Screen, Txt } from '../../components/primitives';
import type { RootScreen } from '../../navigation/types';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

/** Brand mark: a speedometer sweep crossed by a sound wave. */
export function BrandMark({ size = 120 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Defs>
        <LinearGradient id="rw" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={c.accent} stopOpacity="0.4" />
          <Stop offset="1" stopColor={c.accent} />
        </LinearGradient>
      </Defs>
      <Path d="M18 86 A46 46 0 1 1 102 86" stroke={c.bezelStrong} strokeWidth={5} fill="none" strokeLinecap="round" />
      <Path d="M18 86 A46 46 0 0 1 88 26" stroke="url(#rw)" strokeWidth={5} fill="none" strokeLinecap="round" />
      <Path d="M30 66 h12 l6 -14 l8 28 l8 -36 l8 30 l6 -8 h12" stroke={c.text} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="60" y1="64" x2="86" y2="34" stroke={c.accent} strokeWidth={3} strokeLinecap="round" />
      <Circle cx="60" cy="64" r="5" fill={c.accent} />
    </Svg>
  );
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'intercom', title: 'Group intercom', body: 'Push-to-talk over your helmet headset, online or rider-to-rider.' },
  { icon: 'music', title: 'One soundtrack', body: 'The admin drives the playlist; every phone plays in sync.' },
  { icon: 'fuel', title: 'Two-tap stops', body: 'Petrol, food, rest, breakdown — announced to the whole group.' },
  { icon: 'nearby', title: 'Works without signal', body: 'Nearby riders stay linked when the network drops.' },
];

export function WelcomeScreen({ navigation }: RootScreen<'Welcome'>) {
  const { c } = useTheme();
  return (
    <Screen>
      <Gap h={space.lg} />
      <Animated.View entering={FadeInDown.duration(600)} style={{ alignItems: 'center' }}>
        <BrandMark size={96} />
        <Gap h={space.lg} />
        <Label color={c.accent}>RIDEOMETER</Label>
        <Txt v="hero" center style={{ marginTop: space.sm }}>
          Ride together.{'\n'}Stay connected.
        </Txt>
      </Animated.View>
      <Gap h={space.xl} />
      {FEATURES.map((f, i) => (
        <Animated.View key={f.title} entering={FadeInDown.delay(150 + i * 90).duration(500)}>
          <Row style={{ paddingVertical: space.sm }} center={false}>
            <View style={{ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: c.bezel, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={f.icon} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="bodyStrong">{f.title}</Txt>
              <Txt v="small" dim>
                {f.body}
              </Txt>
            </View>
          </Row>
        </Animated.View>
      ))}
      <Gap h={space.xl} />
      <Button title="Get started" size="lg" onPress={() => navigation.navigate('Permissions')} />
      <Gap h={space.md} />
      <Button title="I already have an account" kind="ghost" onPress={() => navigation.navigate('Login')} />
    </Screen>
  );
}
