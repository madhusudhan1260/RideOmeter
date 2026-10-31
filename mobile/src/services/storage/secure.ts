import * as Keychain from 'react-native-keychain';

/**
 * Secrets live in the Android Keystore / iOS Keychain, never in SQLite:
 *  - auth refresh token
 *  - per-ride offline keys (for Nearby peer authentication)
 */
const AUTH = 'ridewave.auth';
const offlineService = (rideId: string) => `ridewave.offline.${rideId}`;

export type StoredAuth = { accessToken: string; refreshToken: string; expiresAt: number };

export async function saveAuth(a: StoredAuth) {
  await Keychain.setGenericPassword('session', JSON.stringify(a), {
    service: AUTH,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function loadAuth(): Promise<StoredAuth | null> {
  const c = await Keychain.getGenericPassword({ service: AUTH });
  if (!c) return null;
  try {
    return JSON.parse(c.password) as StoredAuth;
  } catch {
    return null;
  }
}

export async function clearAuth() {
  await Keychain.resetGenericPassword({ service: AUTH });
}

export async function saveOfflineKey(rideId: string, key: string) {
  await Keychain.setGenericPassword(rideId, key, {
    service: offlineService(rideId),
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function loadOfflineKey(rideId: string): Promise<string | null> {
  const c = await Keychain.getGenericPassword({ service: offlineService(rideId) });
  return c ? c.password : null;
}

export async function clearOfflineKey(rideId: string) {
  await Keychain.resetGenericPassword({ service: offlineService(rideId) });
}
