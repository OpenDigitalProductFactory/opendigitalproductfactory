/**
 * Customer-mode "Nearby" home panel — geo-discovery for the founder's
 * "3 businesses in one app" community vision. Asks for the device's
 * location once, queries the install's `/api/v1/directory/nearby`, and
 * lists each returned business with a tap-through to connect.
 *
 * Today the directory is install-local (just THIS install when its
 * lat/long falls in radius) — the same shape composes onto the Town
 * M5 hosted federation directory in a follow-up.
 */
import React, { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useGeolocation } from "@/src/hooks/useGeolocation";
import { useNearbyStore } from "./nearby.store";
import { useSpacesStore } from "@/src/stores/spaces";
import { fetchInstanceDescriptor } from "@/src/lib/serverConfig";

export function NearbyPanel(): React.JSX.Element {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const router = useRouter();

  const geo = useGeolocation();
  const { results, isLoading, error, fetch } = useNearbyStore();
  const addSpace = useSpacesStore((s) => s.addSpace);

  useEffect(() => {
    if (geo.latitude != null && geo.longitude != null) {
      void fetch({ latitude: geo.latitude, longitude: geo.longitude });
    }
  }, [geo.latitude, geo.longitude, fetch]);

  const onPick = async (url: string): Promise<void> => {
    try {
      const descriptor = await fetchInstanceDescriptor(url);
      addSpace({ url, descriptor });
      router.push("/login");
    } catch {
      // Fall back to the manual connect flow if the descriptor lookup fails.
      router.push("/connect");
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.h1}>Nearby businesses</Text>

      {geo.permission === "denied" ? (
        <View style={styles.note}>
          <Text style={styles.noteText}>
            Location permission is needed to see businesses near you.
          </Text>
          <Pressable
            onPress={() => geo.refresh()}
            accessibilityRole="button"
            testID="nearby-grant"
          >
            <Text style={styles.noteAction}>Grant access</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} testID="nearby-error">
          {error}
        </Text>
      ) : null}

      {(isLoading || geo.isFetching) && results.length === 0 ? (
        <ActivityIndicator
          color={theme.colors.primary}
          testID="nearby-loading"
        />
      ) : results.length === 0 ? (
        <Text style={styles.empty}>
          No DPF-powered businesses in your area yet.
        </Text>
      ) : (
        results.map((row) => (
          <Pressable
            key={row.instanceId}
            style={styles.row}
            onPress={() => onPick(row.url)}
            accessibilityRole="button"
            testID={`nearby-row-${row.instanceId}`}
          >
            <View style={styles.left}>
              <Text style={styles.name}>{row.orgName}</Text>
              {row.locality ? (
                <Text style={styles.meta}>{row.locality}</Text>
              ) : null}
              {row.archetype ? (
                <Text style={styles.archetype}>{row.archetype}</Text>
              ) : null}
            </View>
            <Text style={styles.distance}>{row.distanceKm} km</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    panel: { padding: spacing.md, gap: spacing.sm },
    h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
    note: {
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    noteText: { color: colors.text, fontSize: 14 },
    noteAction: { color: colors.primary, fontSize: 14, fontWeight: "700" },
    empty: { color: colors.textMuted, fontSize: 14, marginTop: spacing.sm },
    error: { color: colors.error, fontSize: 13 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginVertical: spacing.xs,
    },
    left: { flex: 1 },
    name: { color: colors.text, fontSize: 15, fontWeight: "700" },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    archetype: { color: colors.primary, fontSize: 11, marginTop: 2 },
    distance: { color: colors.text, fontSize: 14, fontWeight: "700" },
  });
}
