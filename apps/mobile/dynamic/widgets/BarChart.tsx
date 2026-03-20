import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Card } from "@/src/components/ui/Card";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { WidgetProps } from "./index";

interface ChartItem {
  label: string;
  value: number;
}

/**
 * Simple text-based bar chart. Renders horizontal bars sized as a
 * percentage of the maximum value. No chart library dependency.
 */
export function BarChart({ definition, data }: WidgetProps) {
  const raw = data[definition.dataKey];
  const items: ChartItem[] = Array.isArray(raw) ? raw : [];
  const maxValue = items.reduce(
    (max, item) => Math.max(max, item.value),
    1,
  );

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{definition.label}</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>No data</Text>
      ) : (
        items.map((item, i) => {
          const pct = Math.round((item.value / maxValue) * 100);
          return (
            <View key={i} style={styles.row}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${pct}%`,
                      backgroundColor:
                        definition.color ?? colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={styles.rowValue}>{item.value}</Text>
            </View>
          );
        })
      )}
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
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    padding: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 13,
    width: 80,
  },
  barTrack: {
    flex: 1,
    height: 16,
    backgroundColor: colors.surface1,
    borderRadius: borderRadius.sm,
    overflow: "hidden",
    marginHorizontal: spacing.sm,
  },
  barFill: {
    height: "100%",
    borderRadius: borderRadius.sm,
  },
  rowValue: {
    color: colors.textMuted,
    fontSize: 13,
    width: 40,
    textAlign: "right",
  },
});
