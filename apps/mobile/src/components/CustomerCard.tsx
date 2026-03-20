import React from "react";
import { Text, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import type { CustomerAccount } from "@dpf/types";

export interface CustomerCardProps {
  customer: CustomerAccount;
}

export function CustomerCard({ customer }: CustomerCardProps) {
  const router = useRouter();
  const contactCount = customer.contacts?.length ?? 0;

  return (
    <Pressable
      onPress={() => router.push(`/customers/${customer.id}`)}
      style={({ pressed }) => [pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Customer: ${customer.name}`}
    >
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={2}>
            {customer.name}
          </Text>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{customer.status}</Text>
          </View>
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaText}>
            {contactCount} {contactCount === 1 ? "contact" : "contacts"}
          </Text>
          {customer.accountId ? (
            <Text style={styles.accountId}>{customer.accountId}</Text>
          ) : null}
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
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: spacing.sm,
  },
  statusBadge: {
    backgroundColor: colors.primary + "22",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
  },
  statusText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 13,
    marginRight: spacing.md,
  },
  accountId: {
    color: colors.textMuted,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.7,
  },
});
