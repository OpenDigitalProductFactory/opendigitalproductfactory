import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Card } from "@/src/components/ui/Card";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { WidgetProps } from "./index";

/**
 * Map widget placeholder. Shows "Map view" with marker count.
 * Full implementation will use react-native-maps.
 */
export function MapWidget({ definition, data }: WidgetProps) {
  const raw = data[definition.dataKey];
  const markers = Array.isArray(raw) ? raw.length : 0;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{definition.label}</Text>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Map View</Text>
        <Text style={styles.markerCount}>
          {markers} marker{markers !== 1 ? "s" : ""}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  placeholder: {
    height: 180,
    backgroundColor: colors.surface1,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: "600",
  },
  markerCount: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: spacing.xs,
  },
});
