import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { Devices } from '../api/endpoints';
import { Nearby } from '../native/RideWaveNearby';

/** Register this installation (no push token until Firebase is configured). */
export async function registerDevice() {
  const nearby = await Nearby.available();
  await Devices.register({
    install_id: (await DeviceInfo.getUniqueId()).replace(/[^A-Za-z0-9\-_]/g, '').slice(0, 64).padEnd(8, '0'),
    platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    model: DeviceInfo.getModel(),
    os_version: DeviceInfo.getSystemVersion(),
    app_version: DeviceInfo.getVersion(),
    push_token: null,
    supports_nearby: nearby.available,
  });
}
