import DeviceInfo from 'react-native-device-info';
import { kv } from '../services/storage/db';
import type { TokenPair } from './types';

/**
 * Emulator: 10.0.2.2 is the host's loopback. USB phone: localhost works once
 * `adb reverse tcp:8030 tcp:8030` is set (npm run android does this). Over Wi-Fi,
 * set the laptop's LAN IP in Settings → Server.
 */
export const DEFAULT_API_URL = DeviceInfo.isEmulatorSync() ? 'http://10.0.2.2:8030' : 'http://localhost:8030';

export class ApiError extends Error {
  constructor(public status: number, public detail: string, public body?: any) {
    super(detail);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

type TokenSource = {
  access: () => string | null;
  refresh: () => Promise<TokenPair | null>;
  onSignedOut: () => void;
};

let tokens: TokenSource | null = null;
let refreshing: Promise<TokenPair | null> | null = null;

export function bindTokens(src: TokenSource) {
  tokens = src;
}

export function apiBaseUrl(): string {
  try {
    return kv.get('api_url') || DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}

export function setApiBaseUrl(url: string) {
  kv.set('api_url', url.replace(/\/+$/, ''));
}

export function wsUrl(path: string): string {
  return apiBaseUrl().replace(/^http/, 'ws') + path;
}

type Options = { auth?: boolean; timeoutMs?: number; form?: FormData };

export async function request<T>(method: string, path: string, body?: unknown, opts: Options = {}): Promise<T> {
  const { auth = true, timeoutMs = 12_000 } = opts;
  const attempt = async (): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    const access = auth ? tokens?.access() : null;
    if (access) headers.Authorization = `Bearer ${access}`;
    let payload: FormData | string | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    try {
      return await fetch(apiBaseUrl() + path, { method, headers, body: payload, signal: ctrl.signal });
    } catch (e: any) {
      throw new ApiError(0, e?.name === 'AbortError' ? 'Server did not respond in time' : 'Cannot reach the RideWave server');
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await attempt();
  if (res.status === 401 && auth && tokens) {
    refreshing ??= tokens.refresh().finally(() => {
      refreshing = null;
    });
    const fresh = await refreshing;
    if (!fresh) {
      tokens.onSignedOut();
      throw new ApiError(401, 'Session expired, please sign in again');
    }
    res = await attempt();
  }

  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = typeof json?.detail === 'string' ? json.detail : `Request failed (${res.status})`;
    throw new ApiError(res.status, json?.errors?.[0]?.msg ? `${detail}: ${json.errors[0].msg}` : detail, json);
  }
  return json as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(p: string, o?: Options) => request<T>('GET', p, undefined, o),
  post: <T>(p: string, b?: unknown, o?: Options) => request<T>('POST', p, b, o),
  put: <T>(p: string, b?: unknown, o?: Options) => request<T>('PUT', p, b, o),
  patch: <T>(p: string, b?: unknown, o?: Options) => request<T>('PATCH', p, b, o),
  del: <T>(p: string, o?: Options) => request<T>('DELETE', p, undefined, o),
};
