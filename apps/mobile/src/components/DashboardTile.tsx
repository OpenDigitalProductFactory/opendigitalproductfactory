import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import type { DashboardTile as DashboardTileType } from "@dpf/types";

export interface DashboardTileProps {
  tile: DashboardTileType;
}

const trendSymbols: Record<string, string> = {
  up: "\u2191",
  down: "\u2193",
  stable: "\u2192",
};

const trendColors: Record<string, string> = {
  up: colors.success,
  down: colors.error,
  stable: colors.textMuted,
};

export function DashboardTile({ tile }: DashboardTileProps) {
  const trend = tile.trend;
  const trendSymbol = trend ? trendSymbols[trend] : null;
  const trendColor = trend ? trendColors[trend] : undefined;

  return (
    <Card style={styles.card}>
      <Text style={styles.area}>{tile.area}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, tile.color ? { color: tile.color } : null]}>
          {tile.value}
        </Text>
        {trendSymbol ? (
          <Text style={[styles.trend, { color: trendColor }]}>
            {trendSymbol}
          </Text>
        ) : null}
      </View>
      <Text style={styles.label}>{tile.label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: spacing.xs,
    minHeight: 100,
  },
  area: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: spacing.sm,
  },
  value: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "700",
  },
  trend: {
    fontSize: 20,
    fontWeight: "600",
    marginLeft: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.xs,
  },
});
