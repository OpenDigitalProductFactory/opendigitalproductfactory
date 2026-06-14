import { useEffect } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { useAuthStore } from "@/src/features/auth/auth.store";
import { useDeepLink } from "@/src/hooks/useDeepLink";
import { AgentFAB } from "@/src/components/AgentFAB";
import { loadServerUrl } from "@/src/lib/serverConfig";
import { loadAndApplyAppConfig } from "@/src/lib/appConfig";
import { useOfflineQueueStore } from "@/src/stores/offlineQueue";
import { sqliteQueueStorage } from "@/src/stores/queueStorage";
import { useOfflineSync } from "@/src/hooks/useOfflineSync";

function useProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthRoute = segments[0] === "login";

    if (!isAuthenticated && !inAuthRoute) {
      router.replace("/login");
    } else if (isAuthenticated && inAuthRoute) {
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, isLoading, segments, router]);
}

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    // Hydrate install URL → authenticate → absorb the install manifest (theme + capabilities).
    void (async () => {
      await loadServerUrl();
      await initialize();
      await loadAndApplyAppConfig();
    })();
  }, [initialize]);

  useEffect(() => {
    // Wire durable storage for the offline mutation queue and restore any
    // pending mutations from a previous (offline) session.
    const store = useOfflineQueueStore.getState();
    store.configureStorage(sqliteQueueStorage);
    store.hydrate();
  }, []);

  useProtectedRoute();
  useDeepLink();
  useOfflineSync();

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#818cf8" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      {isAuthenticated ? <AgentFAB /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splash: {
    flex: 1,
    backgroundColor: "#1e1e2e",
    alignItems: "center",
    justifyContent: "center",
  },
});
