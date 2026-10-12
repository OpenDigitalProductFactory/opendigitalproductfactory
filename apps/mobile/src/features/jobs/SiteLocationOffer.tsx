/**
 * The offer shown after check-in to set the site's location from the phone
 * (BI-C318C227 §2.2). Location is read only when "Use my location" is tapped.
 */
import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { WorkItemSite } from "@dpf/types";
import { useTheme } from "@/src/lib/theme";
import { farQuestion, offerQuestion } from "./site-location";
import { useSiteLocationStore } from "./site-location.store";

export function SiteLocationOffer() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const { offer, phase, locateAndConfirm, confirmFar, notNow } = useSiteLocationStore();

  if (phase.kind === "done") {
    return (
      <View style={styles.card} testID="site-location-done" accessibilityLiveRegion="polite">
        <Text style={styles.text}>Location of {phase.site.name} saved.</Text>
      </View>
    );
  }
  if (phase.kind === "message") {
    return (
      <View style={styles.card} testID="site-location-message" accessibilityLiveRegion="polite">
        <Text style={styles.text}>{phase.text}</Text>
      </View>
    );
  }
  if (phase.kind === "far") {
    return (
      <View style={styles.card} testID="site-location-far">
        <Text style={styles.text}>{farQuestion(phase.distanceMeters)}</Text>
        <Choice styles={styles} label="Yes, I'm at the site" onPress={() => confirmFar(phase.site)} testID="site-location-far-yes" />
        <Choice styles={styles} label="No" secondary onPress={() => notNow([phase.site.id])} testID="site-location-far-no" />
      </View>
    );
  }
  if (offer.kind === "none") return null;
  if (phase.kind === "working") {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Saving the site's location" />
      </View>
    );
  }

  const sites: WorkItemSite[] = offer.kind === "one" ? [offer.site] : offer.sites;
  return (
    <View style={styles.card} testID="site-location-offer">
      {offer.kind === "one" ? (
        <Text style={styles.text}>{offerQuestion(offer.site)}</Text>
      ) : (
        <Text style={styles.text}>
          Which site are you at? Your phone's location is used once, to set that site's location only.
        </Text>
      )}
      {sites.map((site) => (
        <Choice
          key={site.id}
          styles={styles}
          label={offer.kind === "one" ? "Use my location" : `I'm at ${site.name}`}
          onPress={() => locateAndConfirm(site)}
          testID={`site-location-use-${site.id}`}
        />
      ))}
      <Choice styles={styles} label="Not now" secondary onPress={() => notNow(sites.map((s) => s.id))} testID="site-location-not-now" />
    </View>
  );
}

function Choice({
  styles,
  label,
  onPress,
  secondary,
  testID,
}: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  onPress: () => void;
  secondary?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      style={secondary ? styles.secondary : styles.primary}
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
    >
      <Text style={secondary ? styles.secondaryText : styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    card: {
      marginTop: spacing.md,
      padding: spacing.md,
      gap: spacing.sm,
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
    },
    text: { color: colors.text, fontSize: 15, lineHeight: 22 },
    primary: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
    },
    primaryText: { color: colors.white, fontSize: 16, fontWeight: "600" },
    secondary: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
    },
    secondaryText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  });
}
