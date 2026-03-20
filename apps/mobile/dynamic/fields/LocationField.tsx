import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { FieldProps } from "./index";

interface LocationValue {
  latitude: number;
  longitude: number;
}

/**
 * Location field stub. Shows a "Capture Location" button and displays
 * coordinates when captured. Full implementation will use expo-location.
 */
export function LocationField({
  definition,
  value,
  onChange,
  error,
}: FieldProps) {
  const location = value as LocationValue | undefined;

  function handleCapture() {
    // Stub: set placeholder coordinates
    onChange({ latitude: 51.5074, longitude: -0.1278 });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{definition.label}</Text>
      {location ? (
        <View style={styles.coordBox}>
          <Text style={styles.coordText}>
            Lat: {location.latitude.toFixed(4)}
          </Text>
          <Text style={styles.coordText}>
            Lng: {location.longitude.toFixed(4)}
          </Text>
        </View>
      ) : null}
      <Pressable
        style={styles.button}
        onPress={handleCapture}
        accessibilityRole="button"
        accessibilityLabel="Capture Location"
        testID={`field-${definition.key}`}
      >
        <Text style={styles.buttonText}>
          {location ? "Recapture Location" : "Capture Location"}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: spacing.xs,
  },
  coordBox: {
    backgroundColor: colors.surface2,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  coordText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: "monospace",
  },
  button: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
  },
  buttonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
