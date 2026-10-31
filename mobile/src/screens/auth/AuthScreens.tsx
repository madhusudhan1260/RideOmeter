import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { apiBaseUrl, setApiBaseUrl } from '../../api/client';
import { Auth } from '../../api/endpoints';
import { Button, Field, Gap, InlineError, Label, Screen, Txt } from '../../components/primitives';
import type { RootScreen } from '../../navigation/types';
import { useAuth } from '../../store/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { BrandMark } from '../onboarding/Welcome';

const msg = (e: any) => e?.detail ?? e?.message ?? 'Something went wrong';

function ServerField() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(apiBaseUrl());
  const { c } = useTheme();
  if (!open)
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={10} style={{ alignSelf: 'center', marginTop: space.lg }}>
        <Txt v="small" faint>
          Server: {apiBaseUrl()} <Txt v="small" color={c.accent}>change</Txt>
        </Txt>
      </Pressable>
    );
  return (
    <>
      <Gap />
      <Field label="Server address" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" hint="Your laptop's LAN address, e.g. http://192.168.1.10:8030" />
      <Button
        title="Save server"
        kind="quiet"
        onPress={() => {
          setApiBaseUrl(url.trim());
          setOpen(false);
        }}
      />
    </>
  );
}

export function LoginScreen({ navigation }: RootScreen<'Login'>) {
  const { c } = useTheme();
  const login = useAuth(s => s.login);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await login(id.trim(), pw);
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Gap h={space.xxxl} />
        <BrandMark size={72} />
        <Gap h={space.lg} />
        <Label color={c.accent}>RIDEOMETER</Label>
        <Txt v="title">Welcome back</Txt>
        <Gap h={space.xl} />
        <InlineError message={err} />
        <Field label="Email or username" value={id} onChangeText={setId} autoCapitalize="none" autoComplete="username" textContentType="username" />
        <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} returnKeyType="go" />
        <Button title="Sign in" size="lg" loading={busy} disabled={!id || !pw} onPress={submit} />
        <Gap h={space.md} />
        <Button title="Forgot password" kind="ghost" onPress={() => navigation.navigate('Forgot')} />
        <Gap h={space.md} />
        <Button title="Create an account" kind="quiet" onPress={() => navigation.navigate('Register')} />
        <ServerField />
      </Screen>
    </KeyboardAvoidingView>
  );
}

export function RegisterScreen({ navigation }: RootScreen<'Register'>) {
  const register = useAuth(s => s.register);
  const [f, setF] = useState({ display_name: '', username: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  const pwWeak = f.password.length > 0 && (f.password.length < 8 || !/\d/.test(f.password) || !/[a-z]/i.test(f.password));
  const userBad = f.username.length > 0 && !/^[a-zA-Z0-9_.]{3,32}$/.test(f.username);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await register({ ...f, email: f.email.trim(), username: f.username.trim() });
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Gap h={space.xxl} />
        <Txt v="title">Create your rider profile</Txt>
        <Txt dim style={{ marginTop: space.xs }}>
          Your name is what the group hears in announcements.
        </Txt>
        <Gap h={space.xl} />
        <InlineError message={err} />
        <Field label="Rider name" value={f.display_name} onChangeText={set('display_name')} placeholder="e.g. Arjun" />
        <Field label="Username" value={f.username} onChangeText={set('username')} autoCapitalize="none" error={userBad ? '3–32 letters, digits, _ or .' : null} />
        <Field label="Email" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Password" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" error={pwWeak ? 'At least 8 characters with letters and numbers' : null} />
        <Button title="Create account" size="lg" loading={busy} disabled={!f.display_name || !f.username || !f.email || !f.password || pwWeak || userBad} onPress={submit} />
        <Gap h={space.md} />
        <Button title="I have an account" kind="ghost" onPress={() => navigation.navigate('Login')} />
        <ServerField />
      </Screen>
    </KeyboardAvoidingView>
  );
}

export function ForgotScreen({ navigation }: RootScreen<'Forgot'>) {
  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [pw, setPw] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestReset = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await Auth.forgot(email.trim());
      setInfo(r.detail);
      // Local development only: the server returns the token because no e-mail sender is configured.
      if (r.dev_reset_token) setToken(r.dev_reset_token);
      setStep('reset');
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setErr(null);
    try {
      await Auth.reset(token.trim(), pw);
      setStep('done');
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Gap h={space.xxl} />
      <Txt v="title">Reset password</Txt>
      <Gap h={space.xl} />
      <InlineError message={err} />
      {step === 'email' && (
        <>
          <Field label="Account email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Button title="Send reset code" size="lg" loading={busy} disabled={!email} onPress={requestReset} />
        </>
      )}
      {step === 'reset' && (
        <>
          {info ? (
            <Txt dim style={{ marginBottom: space.lg }}>
              {info}
            </Txt>
          ) : null}
          <Field label="Reset code" value={token} onChangeText={setToken} autoCapitalize="none" hint="From the reset e-mail" />
          <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry />
          <Button title="Set new password" size="lg" loading={busy} disabled={!token || pw.length < 8} onPress={reset} />
        </>
      )}
      {step === 'done' && (
        <>
          <Txt>Password updated. All other sessions were signed out.</Txt>
          <Gap />
          <Button title="Sign in" size="lg" onPress={() => navigation.navigate('Login')} />
        </>
      )}
    </Screen>
  );
}
