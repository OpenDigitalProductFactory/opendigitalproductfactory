import React from "react";
import { Text, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import type { BadgeStatus } from "@/src/components/ui/StatusBadge";
import type { Epic } from "@dpf/types";

export interface EpicCardProps {
  epic: Epic;
}

export function EpicCard({ epic }: EpicCardProps) {
  const router = useRouter();
  const itemCount = epic.items?.length ?? 0;
  const status = (epic.status ?? "open") as BadgeStatus;

  return (
    <Pressable
      onPress={() => router.push(`/ops/${epic.id}`)}
      style={({ pressed }) => [pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Epic: ${epic.title}`}
    >
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {epic.title}
          </Text>
          <StatusBadge status={status} />
        </View>
        <Text style={styles.itemCount}>
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </Text>
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
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: spacing.sm,
  },
  itemCount: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
});
