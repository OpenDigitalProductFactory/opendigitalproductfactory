import React from "react";
import { Text, Pressable, StyleSheet, View } from "react-native";
import { colors, spacing } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import type { BadgeStatus } from "@/src/components/ui/StatusBadge";
import type { BacklogItem } from "@dpf/types";

export interface BacklogItemCardProps {
  item: BacklogItem;
  onPress?: (item: BacklogItem) => void;
}

export function BacklogItemCard({ item, onPress }: BacklogItemCardProps) {
  const status = (item.status ?? "open") as BadgeStatus;
  const epicName = item.epic?.title ?? "No epic";

  return (
    <Pressable
      onPress={() => onPress?.(item)}
      style={({ pressed }) => [pressed && onPress && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Backlog item: ${item.title}`}
    >
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <StatusBadge status={status} />
        </View>
        <View style={styles.meta}>
          {item.priority != null ? (
            <Text style={styles.priority}>P{item.priority}</Text>
          ) : null}
          <Text style={styles.epicName} numberOfLines={1}>
            {epicName}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
    marginRight: spacing.sm,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  priority: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    marginRight: spacing.sm,
  },
  epicName: {
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
