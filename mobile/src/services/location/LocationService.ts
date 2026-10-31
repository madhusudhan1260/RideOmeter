import Geolocation, { GeolocationResponse } from '@react-native-community/geolocation';
import DeviceInfo from 'react-native-device-info';
import { PermissionsAndroid, Platform } from 'react-native';

export type Fix = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  battery_pct: number | null;
  recorded_at: string;
};

export type LocationStatus = 'off' | 'permission_denied' | 'searching' | 'tracking' | 'error';

/** Real GPS only. If there is no fix, there is no position — never a placeholder. */
class Service {
  private watchId: number | null = null;
  private lastSent = 0;
  private last: Fix | null = null;
  status: LocationStatus = 'off';

  async ensurePermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const fine = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return fine === PermissionsAndroid.RESULTS.GRANTED;
  }

  async start(intervalSec: number, onFix: (f: Fix) => void, onStatus: (s: LocationStatus, detail?: string) => void) {
    this.stop();
    if (!(await this.ensurePermission())) {
      this.status = 'permission_denied';
      onStatus(this.status);
      return;
    }
    Geolocation.setRNConfiguration({ skipPermissionRequests: true, locationProvider: 'playServices' });
    this.status = 'searching';
    onStatus(this.status);
    const intervalMs = intervalSec * 1000;
    this.watchId = Geolocation.watchPosition(
      async (pos: GeolocationResponse) => {
        const fix = await this.toFix(pos);
        this.last = fix;
        if (this.status !== 'tracking') {
          this.status = 'tracking';
          onStatus(this.status);
        }
        const now = Date.now();
        if (now - this.lastSent >= intervalMs * 0.9) {
          this.lastSent = now;
          onFix(fix);
        }
      },
      err => {
        this.status = err.code === 1 ? 'permission_denied' : 'error';
        onStatus(this.status, err.message);
      },
      { enableHighAccuracy: true, distanceFilter: 5, interval: intervalMs, fastestInterval: Math.min(intervalMs, 5000), maximumAge: 2000 },
    );
  }

  stop() {
    if (this.watchId != null) Geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.status = 'off';
  }

  /** Last real fix this phone obtained — may be old; caller shows its age. */
  lastKnown(): Fix | null {
    return this.last;
  }

  async current(timeoutMs = 8000): Promise<Fix | null> {
    return new Promise(resolve => {
      Geolocation.getCurrentPosition(
        async p => resolve(await this.toFix(p)),
        () => resolve(this.last),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
      );
    });
  }

  private async toFix(p: GeolocationResponse): Promise<Fix> {
    let battery: number | null = null;
    try {
      const b = await DeviceInfo.getBatteryLevel();
      battery = b >= 0 ? Math.round(b * 100) : null;
    } catch {
      battery = null;
    }
    return {
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      accuracy_m: p.coords.accuracy ?? null,
      speed_mps: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed : null,
      heading: p.coords.heading != null && p.coords.heading >= 0 && p.coords.heading < 360 ? p.coords.heading : null,
      battery_pct: battery,
      recorded_at: new Date(p.timestamp).toISOString(),
    };
  }
}

export const LocationService = new Service();
