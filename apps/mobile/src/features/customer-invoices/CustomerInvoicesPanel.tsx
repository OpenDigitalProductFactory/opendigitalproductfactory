/**
 * Customer-mode home panel: "My invoices" — the signed-in customer's open
 * balances, with a tap-through to the in-platform Pay flow on the install.
 *
 * Renders only when the install manifest tells us this is the customer
 * surface; on the operator/employee/admin shell it stays absent and the
 * existing operator home is untouched.
 */
import React, { useEffect, useMemo } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/src/lib/theme";
import { getServerUrl } from "@/src/lib/serverConfig";
import {
  selectOpenInvoices,
  useCustomerInvoicesStore,
} from "./customer-invoices.store";
import type { InvoiceDetail } from "@dpf/types";

interface Row {
  invoice: InvoiceDetail;
}

function payUrlFor(invoice: InvoiceDetail): string {
  // Customer-facing pay portal already exists at the install (Phase 1
  // e-signature + cash/card etc). We open it in the system browser to keep
  // App Store 3.1.3(e) / 3.1.1 happy on physical-service IAP exemption — and
  // because Apple/Google merchant onboarding is owner-action P0 work the
  // app itself doesn't yet drive. Deep link by invoiceRef.
  return `${getServerUrl()}/pay/${encodeURIComponent(invoice.invoiceRef)}`;
}

function InvoiceRow({ invoice }: Row): React.JSX.Element {
  const { colors, spacing, borderRadius } = useTheme();
  const styles = useMemo(
    () => makeRowStyles({ colors, spacing, borderRadius }),
    [colors, spacing, borderRadius],
  );
  const onPress = (): void => {
    Linking.openURL(payUrlFor(invoice)).catch(() => undefined);
  };
  return (
    <Pressable
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      testID={`customer-invoice-${invoice.invoiceRef}`}
    >
      <View style={styles.left}>
        <Text style={styles.ref}>{invoice.invoiceRef}</Text>
        <Text style={styles.meta}>
          {invoice.status === "overdue" ? "Overdue" : "Due"}
          {invoice.dueDate
            ? ` ${new Date(invoice.dueDate).toLocaleDateString()}`
            : ""}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.amount}>
          {invoice.currency} {invoice.amountDue.toFixed(2)}
        </Text>
        <Text style={styles.pay}>Pay →</Text>
      </View>
    </Pressable>
  );
}

export function CustomerInvoicesPanel(): React.JSX.Element {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const { invoices, isLoading, error, fetch } = useCustomerInvoicesStore();

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const open = useMemo(() => selectOpenInvoices(invoices), [invoices]);

  return (
    <View style={styles.panel}>
      <Text style={styles.h1}>My invoices</Text>
      {error ? (
        <Text style={styles.error} testID="customer-invoices-error">
          {error}
        </Text>
      ) : null}
      {isLoading && open.length === 0 ? (
        <ActivityIndicator
          color={theme.colors.primary}
          testID="customer-invoices-loading"
        />
      ) : open.length === 0 ? (
        <Text style={styles.empty}>You're all paid up.</Text>
      ) : (
        <FlatList
          data={open}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <InvoiceRow invoice={item} />}
          scrollEnabled={false}
        />
      )}
    </View>
  );
}

function makeStyles({ colors, spacing }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    panel: { padding: spacing.md, gap: spacing.sm },
    h1: { color: colors.text, fontSize: 20, fontWeight: "700" },
    empty: { color: colors.textMuted, fontSize: 14, marginTop: spacing.sm },
    error: { color: colors.error, fontSize: 13 },
  });
}

function makeRowStyles({
  colors,
  spacing,
  borderRadius,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  borderRadius: ReturnType<typeof useTheme>["borderRadius"];
}) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginVertical: spacing.xs,
    },
    left: { flex: 1 },
    right: { alignItems: "flex-end" },
    ref: { color: colors.text, fontSize: 15, fontWeight: "700" },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    amount: { color: colors.text, fontSize: 16, fontWeight: "700" },
    pay: { color: colors.primary, fontSize: 13, fontWeight: "600", marginTop: 2 },
  });
}
