import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParams = {
  Home: undefined;
  Rides: undefined;
  Intercom: undefined;
  Music: undefined;
  Profile: undefined;
};

export type RootParams = {
  Welcome: undefined;
  Permissions: undefined;
  DeviceSetup: { fromOnboarding?: boolean } | undefined;
  Login: undefined;
  Register: undefined;
  Forgot: undefined;
  Main: NavigatorScreenParams<TabParams> | undefined;
  CreateRide: undefined;
  RideInvite: { rideId: string };
  JoinRide: { code?: string } | undefined;
  ScanQR: undefined;
  ActiveRide: { rideId: string };
  Team: undefined;
  GroupMap: undefined;
  Emergency: undefined;
  EditProfile: undefined;
  Settings: undefined;
  MusicLibrary: undefined;
  RideHistory: { rideId: string };
};

export type RootScreen<K extends keyof RootParams> = NativeStackScreenProps<RootParams, K>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootParams {}
  }
}
