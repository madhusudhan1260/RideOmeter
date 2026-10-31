import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { Announcer } from './src/services/announce/AnnouncementEngine';
import { HelmetMonitor } from './src/services/audio/HelmetMonitor';
import { registerDevice } from './src/services/device';
import { useAuth } from './src/store/auth';
import { ThemeProvider } from './src/theme/ThemeProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Don't hammer a dead server; screens show offline states instead.
      retry: (count, err: any) => err?.status !== 401 && err?.status !== 404 && count < 2,
    },
  },
});

function Shell() {
  const status = useAuth(s => s.status);
  useEffect(() => {
    useAuth.getState().bootstrap();
    Announcer.init();
    HelmetMonitor.start();
  }, []);
  useEffect(() => {
    if (status === 'signedIn') registerDevice().catch(() => undefined);
  }, [status]);
  return (
    <>
      <StatusBar barStyle="light-content" />
      <RootNavigator />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Shell />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
