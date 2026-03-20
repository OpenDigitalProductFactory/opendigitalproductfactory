import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";

export type BadgeStatus = "open" | "in-progress" | "done" | "deferred";

export interface StatusBadgeProps {
  status: BadgeStatus;
}

const statusColors: Record<BadgeStatus, string> = {
  open: colors.primary,
  "in-progress": colors.warning,
  done: colors.success,
  deferred: colors.textMuted,
};

const statusLabels: Record<BadgeStatus, string> = {
  open: "Open",
  "in-progress": "In Progress",
  done: "Done",
  deferred: "Deferred",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const bg = statusColors[status];

  return (
    <View style={[styles.badge, { backgroundColor: bg + "22" }]}>
      <View style={[styles.dot, { backgroundColor: bg }]} />
      <Text style={[styles.label, { color: bg }]}>
        {statusLabels[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
