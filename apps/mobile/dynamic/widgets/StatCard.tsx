import React from "react";
import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { Card } from "@/src/components/ui/Card";
import { colors, spacing } from "@/src/lib/theme";
import type { WidgetProps } from "./index";

export function StatCard({ definition, data }: WidgetProps) {
  const value = data[definition.dataKey];
  const displayValue = value != null ? String(value) : "--";
  const cardStyle: ViewStyle = {
    ...styles.card,
    ...(definition.color ? { borderLeftColor: definition.color, borderLeftWidth: 3 } : undefined),
  };

  return (
    <Card style={cardStyle}>
      <Text style={styles.value} testID={`stat-${definition.dataKey}`}>
        {displayValue}
      </Text>
      <Text style={styles.label}>{definition.label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  value: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "700",
  },
  label: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: spacing.xs,
  },
});
