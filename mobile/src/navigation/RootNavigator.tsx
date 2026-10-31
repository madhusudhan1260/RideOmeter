import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, LinkingOptions, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { View } from 'react-native';
import { AlertBanner } from '../components/AlertBanner';
import { Icon, IconName } from '../components/Icon';
import { LoadingState } from '../components/primitives';
import { useAuth } from '../store/auth';
import { useRide } from '../store/ride';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/tokens';
import { ForgotScreen, LoginScreen, RegisterScreen } from '../screens/auth/AuthScreens';
import { EmergencyScreen } from '../screens/emergency/Emergency';
import { HomeScreen } from '../screens/home/Home';
import { IntercomScreen } from '../screens/intercom/Intercom';
import { GroupMapScreen } from '../screens/map/GroupMap';
import { MusicLibraryScreen } from '../screens/music/MusicLibrary';
import { MusicPlayerScreen } from '../screens/music/MusicPlayer';
import { DeviceSetupScreen } from '../screens/onboarding/DeviceSetup';
import { PermissionsScreen } from '../screens/onboarding/Permissions';
import { WelcomeScreen } from '../screens/onboarding/Welcome';
import { EditProfileScreen, ProfileScreen, RideHistoryScreen, SettingsScreen } from '../screens/profile/Profile';
import { ActiveRideScreen } from '../screens/rides/ActiveRide';
import { CreateRideScreen } from '../screens/rides/CreateRide';
import { JoinRideScreen, RideInviteScreen, ScanQRScreen } from '../screens/rides/InviteJoin';
import { RideListScreen } from '../screens/rides/RideList';
import { TeamScreen } from '../screens/rides/Team';
import type { RootParams, TabParams } from './types';

const Stack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator<TabParams>();
export const navRef = createNavigationContainerRef<RootParams>();

const TAB_ICONS: Record<keyof TabParams, IconName> = { Home: 'home', Rides: 'rides', Intercom: 'intercom', Music: 'music', Profile: 'profile' };

function MainTabs() {
  const { c } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textFaint,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.bezel, height: 72, paddingTop: 8 },
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
        tabBarIcon: ({ color, focused }) => (
          <View style={{ alignItems: 'center' }}>
            <View style={{ height: 3, width: 22, borderRadius: 2, backgroundColor: focused ? c.accent : 'transparent', marginBottom: 5 }} />
            <Icon name={TAB_ICONS[route.name]} color={color} size={24} />
          </View>
        ),
      })}>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Rides" component={RideListScreen} />
      <Tabs.Screen name="Intercom" component={IntercomScreen} />
      <Tabs.Screen name="Music" component={MusicPlayerScreen} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}

const linking: LinkingOptions<RootParams> = {
  prefixes: ['ridewave://'],
  config: { screens: { JoinRide: 'join/:code' } },
};

export function RootNavigator() {
  const { c } = useTheme();
  const status = useAuth(s => s.status);
  const onboarded = useSettings(s => s.onboarded);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}>
        <LoadingState label="Starting RideWave" />
      </View>
    );
  }

  const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: c.bg, card: c.surface, text: c.text, border: c.bezel, primary: c.accent } };
  const header = { headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerShadowVisible: false, headerTitle: '', headerBackButtonDisplayMode: 'minimal' as const };

  return (
    <NavigationContainer ref={navRef} theme={theme} linking={linking}>
      <Stack.Navigator screenOptions={{ ...header, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
        {status !== 'signedIn' ? (
          <>
            {!onboarded && <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />}
            {!onboarded && <Stack.Screen name="Permissions" component={PermissionsScreen} />}
            {!onboarded && <Stack.Screen name="DeviceSetup" component={DeviceSetupScreen} />}
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="Forgot" component={ForgotScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="CreateRide" component={CreateRideScreen} />
            <Stack.Screen name="RideInvite" component={RideInviteScreen} />
            <Stack.Screen name="JoinRide" component={JoinRideScreen} />
            <Stack.Screen name="ScanQR" component={ScanQRScreen} options={{ headerTransparent: true }} />
            <Stack.Screen name="ActiveRide" component={ActiveRideScreen} />
            <Stack.Screen name="Team" component={TeamScreen} />
            <Stack.Screen name="GroupMap" component={GroupMapScreen} options={{ headerTransparent: true }} />
            <Stack.Screen name="Emergency" component={EmergencyScreen} options={{ animation: 'fade_from_bottom' }} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="MusicLibrary" component={MusicLibraryScreen} />
            <Stack.Screen name="DeviceSetup" component={DeviceSetupScreen} />
            <Stack.Screen name="Permissions" component={PermissionsScreen} />
            <Stack.Screen name="RideHistory" component={RideHistoryScreen} />
          </>
        )}
      </Stack.Navigator>
      {status === 'signedIn' && (
        <AlertBanner
          onOpen={id => {
            const r = useRide.getState();
            if (r.emergencies[id] && navRef.isReady()) navRef.navigate('Emergency');
            else if (r.ride && navRef.isReady()) navRef.navigate('ActiveRide', { rideId: r.ride.id });
          }}
        />
      )}
    </NavigationContainer>
  );
}
