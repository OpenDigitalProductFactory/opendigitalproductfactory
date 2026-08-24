import React, { useCallback, useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@/src/lib/theme";
import {
  MILEAGE_POLICY_VERSION,
  useMileageStore,
} from "@/src/features/mileage/mileage.store";
import type { MileageClassification, MileageTripSummary } from "@dpf/types";

const METRES_PER_MILE = 1609.344;

const CHOICES: ReadonlyArray<{
  value: Exclude<MileageClassification, "unclassified">;
  label: string;
}> = [
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
  { value: "commute", label: "Commute" },
];

function miles(metres: number): string {
  return (metres / METRES_PER_MILE).toFixed(1);
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function route(trip: MileageTripSummary): string {
  return trip.startPlaceLabel && trip.endPlaceLabel
    ? `${trip.startPlaceLabel} → ${trip.endPlaceLabel}`
    : "Drive";
}

export default function MileageScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);

  const { trips, consent, isLoading, isClassifying, error, fetchTrips, fetchConsent, grantConsent, classify } =
    useMileageStore();

  const refresh = useCallback(async () => {
    await Promise.all([fetchConsent(), fetchTrips()]);
  }, [fetchConsent, fetchTrips]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const granted = consent?.consentStatus === "granted";

  // Consent is the gate, so it is the first thing the driver sees when it is
  // missing. Capture must never start from a screen that did not ask.
  const header = (
    <View style={styles.header}>
      {error ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!granted ? (
        <View style={styles.consentCard}>
          <Text style={styles.consentTitle}>Turn on mileage capture</Text>
          <Text style={styles.consentBody}>
            We record your drives so you can claim them. You choose which are business.
            Personal drives stay yours. Turn it off any time.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => void grantConsent()}
            accessibilityRole="button"
            testID="mileage-grant-consent"
          >
            <Text style={styles.primaryButtonText}>Turn on capture</Text>
          </Pressable>
          <Text style={styles.consentMeta}>Disclosure {MILEAGE_POLICY_VERSION}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList<MileageTripSummary>
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={trips}
      keyExtractor={(t) => t.tripId}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={() => void refresh()} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        ) : (
          <Text style={styles.empty}>
            {granted ? "No drives yet." : "No drives yet. Turn on capture to start."}
          </Text>
        )
      }
      renderItem={({ item }) => (
        <View style={styles.card} testID={`trip-${item.tripId}`}>
          <View style={styles.cardTop}>
            <Text style={styles.cardDate}>{when(item.startedAt)}</Text>
            <Text style={styles.cardMiles}>{miles(item.distanceMetres)} mi</Text>
          </View>
          <Text style={styles.cardRoute} numberOfLines={1}>
            {route(item)}
          </Text>

          {item.claimed ? (
            // A claimed drive priced a reimbursement — it is accounting
            // evidence, so it is shown settled rather than offered for change.
            <Text style={styles.settled}>{item.classification} · claimed</Text>
          ) : (
            <View style={styles.choices}>
              {CHOICES.map((choice) => {
                const active = item.classification === choice.value;
                return (
                  <Pressable
                    key={choice.value}
                    disabled={isClassifying === item.tripId}
                    onPress={() => void classify(item.tripId, choice.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: isClassifying === item.tripId }}
                    style={[styles.choice, active ? styles.choiceActive : null]}
                    testID={`classify-${item.tripId}-${choice.value}`}
                  >
                    <Text style={[styles.choiceText, active ? styles.choiceTextActive : null]}>
                      {choice.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Text style={styles.amount}>
            {/* Null is not zero: an unpriced drive must not read as nothing owed. */}
            {item.reimbursableAmount === null
              ? "Not priced yet"
              : `${item.currency} ${item.reimbursableAmount.toFixed(2)}`}
          </Text>
        </View>
      )}
    />
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  const { colors } = theme;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    content: { padding: 16, gap: 12 },
    header: { gap: 12 },
    errorBox: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      padding: 12,
    },
    errorText: { color: colors.error, fontSize: 14 },
    consentCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      padding: 16,
      gap: 8,
    },
    consentTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
    consentBody: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    consentMeta: { color: colors.textMuted, fontSize: 12 },
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    primaryButtonText: { color: colors.white, fontWeight: "600" },
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      padding: 14,
      gap: 8,
    },
    cardTop: { flexDirection: "row", justifyContent: "space-between" },
    cardDate: { color: colors.text, fontWeight: "600" },
    cardMiles: { color: colors.text, fontVariant: ["tabular-nums"] },
    cardRoute: { color: colors.textMuted, fontSize: 14 },
    choices: { flexDirection: "row", gap: 8 },
    choice: {
      flex: 1,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 8,
      alignItems: "center",
    },
    choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    choiceText: { color: colors.textMuted, fontSize: 13, fontWeight: "500" },
    choiceTextActive: { color: colors.white },
    settled: { color: colors.textMuted, fontSize: 13 },
    amount: { color: colors.text, fontSize: 14, fontWeight: "600" },
    empty: { color: colors.textMuted, textAlign: "center", paddingVertical: 24 },
    spinner: { paddingVertical: 24 },
  });
}
