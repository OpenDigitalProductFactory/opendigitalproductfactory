import React, { useState } from "react";
import { Text, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import type { Portfolio } from "@dpf/types";

export interface PortfolioNodeProps {
  portfolio: Portfolio;
}

export function PortfolioNode({ portfolio }: PortfolioNodeProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const productCount = portfolio.products?.length ?? 0;

  return (
    <View>
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        onLongPress={() => router.push(`/portfolio/${portfolio.id}`)}
        style={({ pressed }) => [pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Portfolio: ${portfolio.name}`}
      >
        <Card style={styles.card}>
          <View style={styles.header}>
            <Ionicons
              name={expanded ? "chevron-down" : "chevron-forward"}
              size={16}
              color={colors.textMuted}
              style={styles.chevron}
            />
            <Text style={styles.name} numberOfLines={2}>
              {portfolio.name}
            </Text>
            <Pressable
              onPress={() => router.push(`/portfolio/${portfolio.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`View ${portfolio.name} details`}
              hitSlop={8}
            >
              <Ionicons
                name="arrow-forward-circle-outline"
                size={22}
                color={colors.primary}
              />
            </Pressable>
          </View>
          <Text style={styles.meta}>
            {productCount} {productCount === 1 ? "product" : "products"}
          </Text>
        </Card>
      </Pressable>

      {expanded && portfolio.description ? (
        <View style={styles.expandedContent}>
          <Text style={styles.description}>{portfolio.description}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  chevron: {
    marginRight: spacing.sm,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: spacing.sm,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.sm,
    marginLeft: spacing.lg,
  },
  expandedContent: {
    marginHorizontal: spacing.md + spacing.lg,
    marginBottom: spacing.xs,
  },
  description: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.7,
  },
});
