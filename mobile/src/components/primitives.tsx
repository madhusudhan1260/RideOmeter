import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  TextInputProps,
  TextProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, touch, type as T, TypeVariant } from '../theme/tokens';
import { Icon, IconName } from './Icon';

// ---------------------------------------------------------------- text

type TxtProps = TextProps & { v?: TypeVariant; color?: string; dim?: boolean; faint?: boolean; caps?: boolean; center?: boolean };

export function Txt({ v = 'body', color, dim, faint, caps, center, style, ...rest }: TxtProps) {
  const { c } = useTheme();
  const col = color ?? (faint ? c.textFaint : dim ? c.textDim : c.text);
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={1.4}
      style={[T[v], { color: col }, caps && { textTransform: 'uppercase' }, center && { textAlign: 'center' }, style]}
      {...rest}
    />
  );
}

/** The small caps legend used above every cluster readout. */
export const Label = (p: Omit<TxtProps, 'v'>) => <Txt v="label" caps faint {...p} />;

// ---------------------------------------------------------------- layout

export function Screen({ children, scroll = true, pad = true, style }: { children: React.ReactNode; scroll?: boolean; pad?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  // Edge-to-edge: keep content clear of the system navigation bar.
  const insets = useSafeAreaInsets();
  const inner = [pad && { paddingHorizontal: space.lg }, { paddingBottom: space.xxl + insets.bottom }, style];
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** A bezel: matte panel with a hairline border. Not a floating card — no shadow. */
export function Bezel({ children, style, tone, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'accent' | 'danger'; onPress?: () => void }) {
  const { c } = useTheme();
  const border = tone === 'accent' ? c.accent : tone === 'danger' ? c.danger : c.bezel;
  const body = (
    <View style={[{ backgroundColor: c.surface, borderColor: border, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.lg, padding: space.lg }, style]}>
      {children}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    body
  );
}

export const Row = ({ children, gap = space.md, style, center = true }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle>; center?: boolean }) => (
  <View style={[{ flexDirection: 'row', alignItems: center ? 'center' : 'flex-start', gap }, style]}>{children}</View>
);

export const Gap = ({ h = space.lg }: { h?: number }) => <View style={{ height: h }} />;

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.bezel, marginVertical: space.md }} />;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { c } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md }}>
      <Label>{title}</Label>
      {action ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Txt v="label" caps color={c.accent}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </Row>
  );
}

// ---------------------------------------------------------------- controls

type BtnProps = Omit<PressableProps, 'style'> & {
  title: string;
  kind?: 'primary' | 'ghost' | 'danger' | 'quiet';
  icon?: IconName;
  loading?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, kind = 'primary', icon, loading, size = 'md', disabled, style, ...rest }: BtnProps) {
  const { c } = useTheme();
  const bg = { primary: c.accent, danger: c.danger, ghost: 'transparent', quiet: c.surfaceRaised }[kind];
  const fg = { primary: c.accentInk, danger: '#FFFFFF', ghost: c.text, quiet: c.text }[kind];
  const h = size === 'lg' ? touch.ride : touch.min + 4;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          height: h,
          borderRadius: radius.md,
          backgroundColor: bg,
          borderWidth: kind === 'ghost' ? 1 : 0,
          borderColor: c.bezelStrong,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space.sm,
          paddingHorizontal: space.xl,
          opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
      {...rest}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={22} /> : null}
      <Txt v="bodyStrong" color={fg} style={{ letterSpacing: 0.6, fontSize: size === 'lg' ? 18 : 16 }}>
        {title}
      </Txt>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, tone, size = touch.min }: { icon: IconName; onPress?: () => void; label: string; tone?: 'accent' | 'danger'; size?: number }) {
  const { c } = useTheme();
  const col = tone === 'accent' ? c.accent : tone === 'danger' ? c.danger : c.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.surfaceRaised : c.surface,
        borderWidth: 1,
        borderColor: c.bezel,
      })}>
      <Icon name={icon} color={col} size={size * 0.46} />
    </Pressable>
  );
}

export function Field({ label, error, hint, style, ...rest }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const { c } = useTheme();
  const [focus, setFocus] = React.useState(false);
  return (
    <View style={[{ marginBottom: space.lg }, style as any]}>
      <Label style={{ marginBottom: space.xs }}>{label}</Label>
      <TextInput
        placeholderTextColor={c.textFaint}
        selectionColor={c.accent}
        onFocus={e => {
          setFocus(true);
          rest.onFocus?.(e);
        }}
        onBlur={e => {
          setFocus(false);
          rest.onBlur?.(e);
        }}
        accessibilityLabel={label}
        style={[
          T.body,
          {
            color: c.text,
            height: touch.min + 6,
            borderRadius: radius.md,
            paddingHorizontal: space.lg,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: error ? c.danger : focus ? c.accent : c.bezel,
          },
          rest.multiline && { height: 96, paddingTop: space.md, textAlignVertical: 'top' },
        ]}
        {...rest}
      />
      {error ? (
        <Txt v="small" color={c.danger} style={{ marginTop: space.xs }}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt v="small" faint style={{ marginTop: space.xs }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} style={{ minHeight: touch.min, justifyContent: 'center' }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Txt>{label}</Txt>
          {hint ? (
            <Txt v="small" faint>
              {hint}
            </Txt>
          ) : null}
        </View>
        <Switch value={value} onValueChange={onChange} trackColor={{ true: c.accent, false: c.bezelStrong }} thumbColor={value ? '#FFFFFF' : c.textDim} />
      </Row>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.bezel, padding: 3 }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, height: touch.min - 6, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentSoft : 'transparent' }}>
            <Txt v="label" caps color={on ? c.accent : c.textDim}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ListRow({ icon, title, subtitle, right, onPress, tone }: { icon?: IconName; title: string; subtitle?: string | null; right?: React.ReactNode; onPress?: () => void; tone?: 'danger' }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({ minHeight: touch.min + 12, flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: pressed ? 0.7 : 1 })}>
      {icon ? (
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} color={tone === 'danger' ? c.danger : c.textDim} size={22} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Txt color={tone === 'danger' ? c.danger : undefined}>{title}</Txt>
        {subtitle ? (
          <Txt v="small" dim numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevronRight" color={c.textFaint} size={20} /> : null)}
    </Pressable>
  );
}

// ---------------------------------------------------------------- states

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingVertical: space.xxxl, alignItems: 'center', gap: space.md }}>
      <ActivityIndicator color={c.accent} size="large" />
      <Label>{label}</Label>
    </View>
  );
}

export function EmptyState({ icon, title, body, action, onAction }: { icon: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingVertical: space.xxl, alignItems: 'center', gap: space.sm }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: c.bezel, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={c.textFaint} size={30} />
      </View>
      <Txt v="heading" center>
        {title}
      </Txt>
      {body ? (
        <Txt dim center style={{ maxWidth: 300 }}>
          {body}
        </Txt>
      ) : null}
      {action ? <Button title={action} kind="ghost" onPress={onAction} style={{ marginTop: space.md }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = (error as any)?.detail ?? (error as any)?.message ?? 'Something went wrong';
  const offline = (error as any)?.status === 0;
  return (
    <EmptyState
      icon={offline ? 'wifiOff' : 'sos'}
      title={offline ? 'You are offline' : 'Could not load'}
      body={offline ? 'RideWave cannot reach the server. Ride features that work offline are still available.' : msg}
      action={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
    />
  );
}

export function InlineError({ message }: { message?: string | null }) {
  const { c } = useTheme();
  if (!message) return null;
  return (
    <View style={{ backgroundColor: c.dangerSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.lg }}>
      <Txt v="small" color={c.danger}>
        {message}
      </Txt>
    </View>
  );
}
