/**
 * Anonymous menu view — a walk-up visitor browses one business's menu,
 * grouped by category, with no login. First cut (BI-9FEB61B8): read-only.
 * Ordering is phase 2 (a disabled hint marks where it will land).
 */
import React, { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useVisitorStore } from "@/src/features/visitor/visitor.store";

function price(amount: number | null, currency: string): string {
  if (amount === null) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount}`;
  }
}

export default function NearbyMenuScreen(): React.JSX.Element {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { menu, isLoadingMenu, menuError, fetchMenu } = useVisitorStore();

  useEffect(() => {
    if (slug) void fetchMenu(slug);
  }, [slug, fetchMenu]);

  if (isLoadingMenu && !menu) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} testID="menu-loading" />
      </View>
    );
  }

  if (menuError) {
    return (
      <View style={styles.centre}>
        <Text style={styles.error} testID="menu-error">
          {menuError}
        </Text>
      </View>
    );
  }

  if (!menu) {
    return (
      <View style={styles.centre}>
        <Text style={styles.muted}>Menu unavailable.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{menu.name}</Text>
      {menu.categories.length === 0 ? (
        <Text style={styles.muted}>Nothing on the menu yet.</Text>
      ) : (
        menu.categories.map((cat, ci) => (
          <View key={cat.category ?? `uncategorised-${ci}`} style={styles.section}>
            <Text style={styles.category}>{cat.category ?? "More"}</Text>
            {cat.items.map((item) => (
              <View key={item.id} style={styles.item} testID={`menu-item-${item.id}`}>
                <View style={styles.itemLeft}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.description ? (
                    <Text style={styles.itemDesc}>{item.description}</Text>
                  ) : null}
                </View>
                <Text style={styles.itemPrice}>
                  {price(item.price, item.currency)}
                </Text>
              </View>
            ))}
          </View>
        ))
      )}

      <View style={styles.phase2}>
        <Text style={styles.phase2Text}>
          Ordering comes soon — for now you're browsing.
        </Text>
      </View>
    </ScrollView>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: colors.surface1 },
    h1: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: spacing.md },
    section: { marginBottom: spacing.md },
    category: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      marginBottom: spacing.xs,
    },
    item: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: spacing.sm,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    itemLeft: { flex: 1, marginRight: spacing.sm },
    itemName: { color: colors.text, fontSize: 15 },
    itemDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    itemPrice: { color: colors.textMuted, fontSize: 14 },
    error: { color: colors.error, fontSize: 13, textAlign: "center" },
    muted: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
    phase2: {
      marginTop: spacing.lg,
      padding: spacing.md,
      borderColor: colors.border,
      borderWidth: 1,
      borderStyle: "dashed",
      borderRadius: borderRadius.md,
    },
    phase2Text: { color: colors.textMuted, fontSize: 12, textAlign: "center" },
  });
}
