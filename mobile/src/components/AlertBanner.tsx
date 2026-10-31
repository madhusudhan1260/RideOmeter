import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRide } from '../store/ride';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './primitives';

/** Global top banner for stop requests, SOS and announcements. */
export function AlertBanner({ onOpen }: { onOpen?: (id: string) => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const banner = useRide(s => s.banner);
  const clear = () => useRide.getState().showBanner(null);

  useEffect(() => {
    if (!banner || banner.tone === 'danger') return; // emergencies stay until dismissed
    const t = setTimeout(clear, 7000);
    return () => clearTimeout(t);
  }, [banner]);

  if (!banner) return null;
  const col = banner.tone === 'danger' ? c.danger : banner.tone === 'accent' ? c.accent : c.info;
  return (
    <Animated.View entering={SlideInUp.springify().damping(18)} exiting={SlideOutUp} style={{ position: 'absolute', top: insets.top + space.sm, left: space.md, right: space.md, zIndex: 50 }}>
      <Pressable
        onPress={() => {
          onOpen?.(banner.id);
          if (banner.tone !== 'danger') clear();
        }}
        accessibilityRole="alert"
        style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.lg, borderWidth: 1.5, borderColor: col, padding: space.lg, flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
        <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: col }} />
        <View style={{ flex: 1 }}>
          <Txt v="label" caps color={col}>
            {banner.title}
          </Txt>
          <Txt v="bodyStrong">{banner.body}</Txt>
        </View>
        <Pressable onPress={clear} hitSlop={14} accessibilityLabel="Dismiss">
          <Icon name="close" color={c.textDim} size={22} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}
