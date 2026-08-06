/**
 * "Right here" — the anonymous walk-up home. Gets the device location once,
 * lists nearby businesses, and taps through to a menu. No login. First cut
 * (BI-9FEB61B8): ordering/identity are phase 2.
 */
import React, { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useGeolocation } from "@/src/hooks/useGeolocation";
import { useAuthStore } from "@/src/features/auth/auth.store";
import { orderForDisplay, useVisitorStore } from "@/src/features/visitor/visitor.store";
import type { NearbyBusiness } from "@dpf/types";

function distanceLabel(m: number | null): string {
  if (m === null) return "";
  if (m < 950) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export default function NearbyScreen(): React.JSX.Element {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const router = useRouter();
  const { latitude, longitude, permission, isFetching, error: geoError, refresh } =
    useGeolocation();
  const { businesses, isLoadingNearby, nearbyError, fetchNearby } =
    useVisitorStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (latitude !== null && longitude !== null) {
      void fetchNearby({ latitude, longitude });
    }
  }, [latitude, longitude, fetchNearby]);

  const ordered = useMemo(() => orderForDisplay(businesses), [businesses]);

  if (permission === "denied") {
    return (
      <View style={styles.centre}>
        <Text style={styles.muted}>
          Turn on location to see what's around you.
        </Text>
        <Pressable style={styles.cta} onPress={refresh} testID="nearby-grant">
          <Text style={styles.ctaText}>Enable location</Text>
        </Pressable>
      </View>
    );
  }

  if ((isFetching || isLoadingNearby) && ordered.length === 0) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} testID="nearby-loading" />
      </View>
    );
  }

  const err = geoError ?? nearbyError;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={ordered}
      keyExtractor={(b) => b.slug}
      ListHeaderComponent={
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.h1}>Right here</Text>
            {/* Sign in stays reachable but is never required to browse. Only an
                anonymous visitor sees it; pushed (not replaced) so they can
                back out and keep looking. */}
            {!isAuthenticated ? (
              <Pressable
                onPress={() => router.push("/login")}
                accessibilityRole="button"
                testID="nearby-signin"
                hitSlop={8}
              >
                <Text style={styles.signIn}>Sign in</Text>
              </Pressable>
            ) : null}
          </View>
          {err ? (
            <Text style={styles.error} testID="nearby-error">
              {err}
            </Text>
          ) : null}
        </View>
      }
      renderItem={({ item }: { item: NearbyBusiness }) => (
        <Pressable
          style={styles.row}
          disabled={!item.hasMenu}
          onPress={() =>
            router.push(`/nearby/${encodeURIComponent(item.slug)}`)
          }
          accessibilityRole="button"
          testID={`nearby-row-${item.slug}`}
        >
          <View style={styles.rowLeft}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>
              {[item.category ?? "Business", distanceLabel(item.distanceMeters)]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {item.addressLine ? (
              <Text style={styles.address}>{item.addressLine}</Text>
            ) : null}
          </View>
          {item.hasMenu ? (
            <Text style={styles.see}>See menu ›</Text>
          ) : (
            <Text style={styles.metaMuted}>No menu yet</Text>
          )}
        </Pressable>
      )}
      ListEmptyComponent={
        !isLoadingNearby ? (
          <Text style={styles.muted}>No businesses found near you yet.</Text>
        ) : null
      }
      ListFooterComponent={
        <Text style={styles.footer}>No account — just looking</Text>
      }
    />
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface1 },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    h1: { color: colors.text, fontSize: 22, fontWeight: "700" },
    signIn: { color: colors.primary, fontSize: 15, fontWeight: "600" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    rowLeft: { flex: 1, marginRight: spacing.sm },
    name: { color: colors.text, fontSize: 16, fontWeight: "600" },
    meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    metaMuted: { color: colors.textMuted, fontSize: 12 },
    address: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    see: { color: colors.primary, fontSize: 14, fontWeight: "600" },
    error: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },
    muted: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
    cta: { backgroundColor: colors.primary, borderRadius: borderRadius.md, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.lg },
    ctaText: { color: colors.white, fontSize: 15, fontWeight: "600" },
    footer: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: spacing.md },
  });
}
