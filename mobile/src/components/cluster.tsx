import React, { useEffect } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg';
import { describe } from '../services/connection/stateMachine';
import { useConnection } from '../store/connection';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, touch } from '../theme/tokens';
import { Icon, IconName } from './Icon';
import { Label, Row, Txt } from './primitives';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ---------------------------------------------------------------- LEDs & pills

export type LedTone = 'live' | 'warn' | 'danger' | 'dim' | 'accent';

export function Led({ tone, pulse, size = 9 }: { tone: LedTone; pulse?: boolean; size?: number }) {
  const { c } = useTheme();
  const col = { live: c.live, warn: c.warn, danger: c.danger, dim: c.textFaint, accent: c.accent }[tone];
  const o = useSharedValue(1);
  useEffect(() => {
    if (pulse) o.value = withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
    else {
      cancelAnimation(o);
      o.value = 1;
    }
  }, [pulse, o]);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: col }, st]} />;
}

/** Global connection indicator, always reflecting the real state machine. */
export function ConnectionPill({ compact }: { compact?: boolean }) {
  const { c } = useTheme();
  const snap = useConnection();
  const d = describe(snap);
  const pulse = ['CONNECTING', 'DISCOVERING_NEARBY', 'SYNCING', 'INTERNET_RESTORED'].includes(snap.state);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Connection: ${d.label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 32, borderRadius: radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.bezel, alignSelf: 'flex-start' }}>
      <Led tone={d.tone} pulse={pulse} />
      {!compact && (
        <Txt v="label" caps dim>
          {d.label}
        </Txt>
      )}
      {snap.outbox > 0 && (
        <Txt v="label" color={c.warn}>
          · {snap.outbox} queued
        </Txt>
      )}
    </View>
  );
}

export function StatusTag({ label, tone }: { label: string; tone: LedTone }) {
  const { c } = useTheme();
  const col = { live: c.live, warn: c.warn, danger: c.danger, dim: c.textFaint, accent: c.accent }[tone];
  return (
    <Row gap={6}>
      <Led tone={tone} size={7} />
      <Txt v="label" caps color={col}>
        {label}
      </Txt>
    </Row>
  );
}

export function Badge({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'danger' | 'dim' }) {
  const { c } = useTheme();
  const bg = tone === 'accent' ? c.accentSoft : tone === 'danger' ? c.dangerSoft : c.surfaceRaised;
  const fg = tone === 'accent' ? c.accent : tone === 'danger' ? c.danger : c.textDim;
  return (
    <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 6, backgroundColor: bg, justifyContent: 'center' }}>
      <Txt v="label" caps color={fg} style={{ fontSize: 10.5 }}>
        {label}
      </Txt>
    </View>
  );
}

export function Avatar({ name, uri, size = 44, ring }: { name: string; uri?: string | null; size?: number; ring?: LedTone }) {
  const { c } = useTheme();
  const ringCol = ring ? { live: c.live, warn: c.warn, danger: c.danger, dim: c.bezelStrong, accent: c.accent }[ring] : c.bezel;
  const initials = name
    .split(/\s+/)
    .map(s => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: ringCol, padding: 2 }}>
      {uri ? (
        <Image source={{ uri }} style={{ flex: 1, borderRadius: size / 2 }} />
      ) : (
        <View style={{ flex: 1, borderRadius: size / 2, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Txt v="bodyStrong" dim style={{ fontSize: size * 0.34 }}>
            {initials || '?'}
          </Txt>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- gauge

/** Tachometer-style 240° arc with tick marks. */
export function Gauge({ value, max, label, sub, size = 168 }: { value: number; max: number; label: string; sub?: string; size?: number }) {
  const { c } = useTheme();
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  const start = 150;
  const sweep = 240;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  const polar = (deg: number, rr = r) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) };
  };
  const arc = (from: number, to: number) => {
    const a = polar(from);
    const b = polar(to);
    const large = to - from > 180 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
  };
  const ticks = Array.from({ length: 13 }, (_, i) => start + (sweep * i) / 12);
  return (
    <View style={{ width: size, height: size * 0.86, alignItems: 'center' }} accessibilityLabel={`${label} ${value} of ${max}`}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={c.accent} stopOpacity="0.55" />
            <Stop offset="1" stopColor={c.accent} />
          </LinearGradient>
        </Defs>
        <Path d={arc(start, start + sweep)} stroke={c.bezel} strokeWidth={8} fill="none" strokeLinecap="round" />
        {frac > 0 && <Path d={arc(start, start + sweep * Math.max(frac, 0.02))} stroke="url(#g)" strokeWidth={8} fill="none" strokeLinecap="round" />}
        {ticks.map((t, i) => {
          const a = polar(t, r - 12);
          const b = polar(t, r - (i % 3 === 0 ? 20 : 16));
          return <Line key={t} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c.textFaint} strokeWidth={i % 3 === 0 ? 1.6 : 1} />;
        })}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: size * 0.08 }]}>
        <Txt v="hero" style={{ fontVariant: ['tabular-nums'] }}>
          {value}
          <Txt v="heading" faint>
            /{max}
          </Txt>
        </Txt>
        <Label>{label}</Label>
        {sub ? (
          <Txt v="small" dim>
            {sub}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- quick actions

export function QuickAction({ icon, label, onPress, tone, disabled, busy }: { icon: IconName; label: string; onPress: () => void; tone?: 'danger' | 'accent'; disabled?: boolean; busy?: boolean }) {
  const { c } = useTheme();
  const col = tone === 'danger' ? c.danger : tone === 'accent' ? c.accent : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: touch.ride + 24,
        borderRadius: radius.lg,
        backgroundColor: tone === 'danger' ? c.dangerSoft : c.surface,
        borderWidth: 1,
        borderColor: tone === 'danger' ? c.danger : c.bezel,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: disabled ? 0.4 : pressed || busy ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <Icon name={icon} color={col} size={28} />
      <Txt v="label" caps color={col}>
        {label}
      </Txt>
    </Pressable>
  );
}

// ---------------------------------------------------------------- progress

/** Segmented tick bar — a progress bar that reads like a fuel gauge. */
export function TickProgress({ fraction, ticks = 32 }: { fraction: number; ticks?: number }) {
  const { c } = useTheme();
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * ticks);
  return (
    <View style={{ flexDirection: 'row', gap: 2, height: 14 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      {Array.from({ length: ticks }, (_, i) => (
        <View key={i} style={{ flex: 1, borderRadius: 1.5, backgroundColor: i < lit ? c.accent : c.bezel, opacity: i < lit ? 0.6 + (0.4 * i) / ticks : 1 }} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- PTT

/**
 * The push-to-talk "throttle". Hold to transmit; the ring breathes while live.
 * Large (200pt) so it works with gloves.
 */
export function PTTButton({ active, disabled, onPressIn, onPressOut, label }: { active: boolean; disabled?: boolean; onPressIn: () => void; onPressOut: () => void; label: string }) {
  const { c } = useTheme();
  const size = touch.hero;
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (active) pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1);
    else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [active, pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: active ? 1 - pulse.value : 0, transform: [{ scale: 1 + pulse.value * 0.28 }] }));
  return (
    <View style={{ width: size * 1.3, height: size * 1.3, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: c.accent }, ring]} />
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Hold to talk to the group"
        accessibilityState={{ disabled, selected: active }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: active ? c.accent : c.surfaceRaised,
          borderWidth: 6,
          borderColor: active ? c.accentSoft : c.bezelStrong,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.35 : 1,
        }}>
        <Icon name={disabled ? 'micOff' : 'mic'} size={64} color={active ? c.accentInk : c.text} strokeWidth={1.6} />
        <Txt v="label" caps color={active ? c.accentInk : c.textDim} style={{ marginTop: space.sm }}>
          {label}
        </Txt>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------- SOS

/** Long-press (1.2 s) to fire, so it can't be triggered from a pocket. */
export function SOSHoldButton({ onFire, size = 180, label = 'HOLD FOR SOS' }: { onFire: () => void; size?: number; label?: string }) {
  const { c } = useTheme();
  const p = useSharedValue(0);
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const props = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - p.value) }));
  const start = () => {
    p.value = withTiming(1, { duration: 1200, easing: Easing.linear }, done => {
      if (done) runOnJS(onFire)();
    });
  };
  const cancel = () => {
    cancelAnimation(p);
    p.value = withTiming(0, { duration: 180 });
  };
  return (
    <Pressable onPressIn={start} onPressOut={cancel} accessibilityRole="button" accessibilityLabel="Emergency SOS" accessibilityHint="Press and hold for one second to alert your group">
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.dangerSoft} strokeWidth={10} fill={c.dangerSoft} />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={c.danger}
            strokeWidth={10}
            fill="none"
            strokeDasharray={`${circ} ${circ}`}
            animatedProps={props}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <Txt v="hero" color={c.danger} style={{ fontSize: size * 0.24, lineHeight: size * 0.26 }}>
          SOS
        </Txt>
        <Txt v="label" caps color={c.danger}>
          {label}
        </Txt>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- delivery

export function DeliveryChip({ status, delivered, recipients, via }: { status: string; delivered: number; recipients: number; via: string[] }) {
  const map: Record<string, { label: string; tone: LedTone }> = {
    SENDING: { label: via.includes('outbox') && via.length === 1 ? 'Not delivered · queued' : 'Sending…', tone: 'warn' },
    DELIVERED: { label: `Delivered to ${delivered} of ${recipients}`, tone: 'live' },
    ACKNOWLEDGED: { label: 'Acknowledged', tone: 'live' },
    FAILED: { label: 'Failed', tone: 'danger' },
  };
  const m = map[status] ?? map.SENDING;
  return <StatusTag label={m.label} tone={m.tone} />;
}
