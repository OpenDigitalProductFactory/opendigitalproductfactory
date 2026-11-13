/**
 * Anonymous menu view — a walk-up visitor browses one business's menu,
 * grouped by category, with no login, and builds a client-only cart.
 * Checkout is a later phase (a hint marks where it will land).
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useVisitorStore } from "@/src/features/visitor/visitor.store";
import {
  MAX_QUANTITY_PER_LINE,
  cartItemCount,
  cartTotalMinor,
  currencyExponent,
  toMinorUnits,
  type CartErrorCode,
  type Result,
} from "@/src/features/visitor/cart";

const CART_MESSAGES: Record<CartErrorCode, string> = {
  PRICE_INVALID: "This item can't be ordered right now.",
  PRICE_NOT_POSITIVE: "This item can't be ordered right now.",
  PRICE_TOO_SMALL: "This item can't be ordered right now.",
  UNIT_PRICE_TOO_LARGE: "This item can't be ordered right now.",
  CURRENCY_INVALID: "This item can't be ordered right now.",
  CURRENCY_MISMATCH: "Your cart can only hold items priced in one currency from one business.",
  QUANTITY_INVALID: "That quantity isn't valid.",
  QUANTITY_LIMIT: `You can order at most ${MAX_QUANTITY_PER_LINE} of one item.`,
  LINE_LIMIT: "Your cart has reached its limit of different items.",
  CART_TOTAL_TOO_LARGE: "Your cart total has reached its limit.",
  MENU_MISSING: "The menu isn't loaded. Please try again.",
  ITEM_NOT_FOUND: "That item is no longer on the menu.",
  LINE_NOT_FOUND: "That item isn't in your cart.",
};

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

/** Format integer minor units (e.g. cents) in the given currency. */
function minorPrice(minor: number, currency: string): string {
  const exponent = currencyExponent(currency) ?? 2;
  return price(minor / 10 ** exponent, currency);
}

export default function NearbyMenuScreen(): React.JSX.Element {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  // expo-router types a dynamic segment as string | string[] at runtime.
  const { slug: rawSlug } = useLocalSearchParams<{ slug: string | string[] }>();
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const {
    menu,
    isLoadingMenu,
    menuError,
    fetchMenu,
    cart,
    addItem,
    increaseItem,
    decreaseItem,
  } = useVisitorStore();
  const [cartMessage, setCartMessage] = useState<string | null>(null);

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
        <Pressable
          style={styles.retry}
          onPress={() => {
            if (slug) void fetchMenu(slug);
          }}
          accessibilityRole="button"
          testID="menu-retry"
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
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

  const run = (action: (id: string) => Result<unknown>, id: string) => {
    const res = action(id);
    setCartMessage(res.ok ? null : CART_MESSAGES[res.code]);
  };

  const cartCurrency =
    cart.currency ??
    menu.categories.find((c) => c.items.length > 0)?.items[0].currency ??
    "USD";
  const count = cartItemCount(cart);
  const countText = `${count} ${count === 1 ? "item" : "items"}`;
  const totalText = minorPrice(cartTotalMinor(cart), cartCurrency);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{menu.name}</Text>
      {menu.categories.length === 0 ? (
        <Text style={styles.muted}>Nothing on the menu yet.</Text>
      ) : (
        menu.categories.map((cat, ci) => (
          <View key={cat.category ?? `uncategorised-${ci}`} style={styles.section}>
            <Text style={styles.category}>{cat.category ?? "More"}</Text>
            {cat.items.map((item) => {
              const orderable = toMinorUnits(item.price, item.currency).ok;
              const qty = cart.lines.find((l) => l.itemId === item.id)?.quantity ?? 0;
              return (
                <View key={item.id} style={styles.item} testID={`menu-item-${item.id}`}>
                  <View style={styles.itemLeft}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    {item.description ? (
                      <Text style={styles.itemDesc}>{item.description}</Text>
                    ) : null}
                    {orderable ? null : (
                      <Text style={styles.itemDesc}>Unavailable to order</Text>
                    )}
                  </View>
                  <View style={styles.itemRight}>
                    <Text style={styles.itemPrice}>{price(item.price, item.currency)}</Text>
                    {!orderable ? (
                      <Pressable
                        disabled
                        style={[styles.control, styles.controlDisabled]}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${item.name} to cart, unavailable to order`}
                        accessibilityState={{ disabled: true }}
                        testID={`cart-add-${item.id}`}
                      >
                        <Text style={styles.controlText}>Add</Text>
                      </Pressable>
                    ) : qty === 0 ? (
                      <Pressable
                        style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
                        onPress={() => run(addItem, item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${item.name} to cart`}
                        testID={`cart-add-${item.id}`}
                      >
                        <Text style={styles.controlText}>Add</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.stepper}>
                        <Pressable
                          style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
                          onPress={() => run(decreaseItem, item.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Decrease quantity of ${item.name}`}
                          testID={`cart-decrease-${item.id}`}
                        >
                          <Text style={styles.controlText}>−</Text>
                        </Pressable>
                        <Text
                          style={styles.qty}
                          accessibilityLabel={`Quantity of ${item.name}: ${qty}`}
                          testID={`cart-qty-${item.id}`}
                        >
                          {qty}
                        </Text>
                        <Pressable
                          style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
                          onPress={() => run(increaseItem, item.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Increase quantity of ${item.name}`}
                          testID={`cart-increase-${item.id}`}
                        >
                          <Text style={styles.controlText}>+</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ))
      )}

      {cartMessage ? (
        <Text
          style={styles.error}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          testID="cart-message"
        >
          {cartMessage}
        </Text>
      ) : null}

      <View
        style={styles.summary}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Cart: ${countText}, total ${totalText}`}
        testID="cart-summary"
      >
        <Text style={styles.summaryText}>
          {countText} · {totalText}
        </Text>
      </View>

      <View style={styles.phase2}>
        <Text style={styles.phase2Text}>
          Checkout comes soon — for now you can build your cart.
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
    itemRight: { alignItems: "flex-end" },
    itemName: { color: colors.text, fontSize: 15 },
    itemDesc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    itemPrice: { color: colors.textMuted, fontSize: 14 },
    stepper: { flexDirection: "row", alignItems: "center" },
    control: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.sm,
      marginTop: spacing.xs,
    },
    controlPressed: { opacity: 0.7 },
    controlDisabled: { opacity: 0.4 },
    controlText: { color: colors.white, fontSize: 18, fontWeight: "700" },
    qty: { color: colors.text, fontSize: 16, minWidth: 32, textAlign: "center", marginTop: spacing.xs },
    summary: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
    },
    summaryText: { color: colors.text, fontSize: 16, fontWeight: "600" },
    error: { color: colors.error, fontSize: 13, textAlign: "center" },
    muted: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
    retry: { backgroundColor: colors.primary, borderRadius: borderRadius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md },
    retryText: { color: colors.white, fontSize: 15, fontWeight: "600" },
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
