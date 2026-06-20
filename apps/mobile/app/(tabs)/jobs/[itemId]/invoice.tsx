/**
 * Field-tech "Draft invoice" screen.
 *
 * After completing a job the tech bills the customer here: edit line items
 * (qty + unit price + optional tax/discount), enter the customer account id,
 * and submit. On success we navigate to the payment screen with the just-
 * created invoice id, so the tech can collect cash/cheque/etc on site.
 *
 * Substrate: POST /api/v1/finance/invoices (existing) via the shared
 * @dpf/api-client, mirroring the createInvoiceSchema in finance-validation.ts.
 * Server is authoritative for totals; the local total is a running figure
 * for the tech only.
 */
import React, { useMemo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useInvoicesStore } from "@/src/features/invoices/invoices.store";

export default function DraftInvoiceScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();

  const {
    accountId,
    dueDate,
    notes,
    lineItems,
    isSubmitting,
    error,
    setAccountId,
    setDueDate,
    setNotes,
    addLineItem,
    updateLineItem,
    removeLineItem,
    draftTotal,
    createInvoice,
  } = useInvoicesStore();

  const total = draftTotal();

  const onCreate = async (): Promise<void> => {
    const invoice = await createInvoice();
    if (invoice) {
      router.replace(
        `/jobs/${encodeURIComponent(itemId)}/payment?invoiceId=${encodeURIComponent(
          invoice.id,
        )}`,
      );
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h1}>New invoice</Text>

      <Text style={styles.label}>Customer account id</Text>
      {accountId ? (
        // Server resolved the account from the WorkItem source — show it as
        // a read-only confirmation instead of asking the tech to retype it.
        // Long-press to override (the few legitimate cases: tech notices the
        // resolved account is wrong, or the source link is stale).
        <Pressable
          onLongPress={() => setAccountId("")}
          accessibilityRole="button"
          testID="invoice-accountId-readonly"
          style={[styles.input, styles.readonlyAccount]}
        >
          <Text style={styles.readonlyAccountText}>{accountId}</Text>
          <Text style={styles.readonlyAccountHint}>long-press to change</Text>
        </Pressable>
      ) : (
        <TextInput
          value={accountId}
          onChangeText={setAccountId}
          style={styles.input}
          placeholder="ACC-…"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="characters"
          testID="invoice-accountId"
        />
      )}

      <Text style={styles.label}>Due date (YYYY-MM-DD)</Text>
      <TextInput
        value={dueDate}
        onChangeText={setDueDate}
        style={styles.input}
        placeholder="2026-07-16"
        placeholderTextColor={theme.colors.textMuted}
        keyboardType="numbers-and-punctuation"
        testID="invoice-dueDate"
      />

      <Text style={[styles.h2, { marginTop: theme.spacing.lg }]}>Line items</Text>
      {lineItems.map((li, idx) => (
        <View key={li.key} style={styles.lineRow} testID={`line-${idx}`}>
          <TextInput
            value={li.description}
            onChangeText={(v) => updateLineItem(li.key, { description: v })}
            placeholder="Service / part / labor"
            placeholderTextColor={theme.colors.textMuted}
            style={[styles.input, styles.lineDesc]}
            testID={`line-${idx}-description`}
          />
          <View style={styles.lineNumRow}>
            <View style={styles.numCol}>
              <Text style={styles.smallLabel}>Qty</Text>
              <TextInput
                value={String(li.quantity)}
                onChangeText={(v) =>
                  updateLineItem(li.key, { quantity: parseFloat(v) || 0 })
                }
                style={styles.input}
                keyboardType="decimal-pad"
                testID={`line-${idx}-quantity`}
              />
            </View>
            <View style={styles.numCol}>
              <Text style={styles.smallLabel}>Unit price</Text>
              <TextInput
                value={String(li.unitPrice)}
                onChangeText={(v) =>
                  updateLineItem(li.key, { unitPrice: parseFloat(v) || 0 })
                }
                style={styles.input}
                keyboardType="decimal-pad"
                testID={`line-${idx}-unitPrice`}
              />
            </View>
            <View style={styles.numCol}>
              <Text style={styles.smallLabel}>Tax %</Text>
              <TextInput
                value={li.taxRate != null ? String(li.taxRate) : ""}
                onChangeText={(v) =>
                  updateLineItem(li.key, {
                    taxRate: v.length === 0 ? undefined : parseFloat(v) || 0,
                  })
                }
                style={styles.input}
                keyboardType="decimal-pad"
                testID={`line-${idx}-taxRate`}
              />
            </View>
          </View>
          {lineItems.length > 1 ? (
            <Pressable
              onPress={() => removeLineItem(li.key)}
              accessibilityRole="button"
              testID={`line-${idx}-remove`}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <Pressable
        style={styles.secondary}
        onPress={() => addLineItem()}
        accessibilityRole="button"
        testID="invoice-add-line"
      >
        <Text style={styles.secondaryText}>+ Add line</Text>
      </Pressable>

      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        style={[styles.input, styles.multiline]}
        multiline
        placeholder="Anything the customer should see on the invoice"
        placeholderTextColor={theme.colors.textMuted}
        testID="invoice-notes"
      />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Estimated total</Text>
        <Text style={styles.totalValue} testID="invoice-total">
          {total.toFixed(2)}
        </Text>
      </View>

      {error ? (
        <Text style={styles.error} testID="invoice-error">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={[styles.primary, isSubmitting && styles.disabled]}
        disabled={isSubmitting}
        onPress={onCreate}
        accessibilityRole="button"
        testID="invoice-submit"
      >
        <Text style={styles.primaryText}>
          {isSubmitting ? "Creating…" : "Create invoice"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
    h1: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: spacing.md },
    h2: { color: colors.text, fontSize: 16, fontWeight: "600", marginBottom: spacing.xs },
    label: {
      color: colors.textMuted,
      fontSize: 12,
      textTransform: "uppercase",
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    smallLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
    input: {
      backgroundColor: colors.surface2,
      color: colors.text,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
      fontSize: 15,
    },
    multiline: { minHeight: 70, textAlignVertical: "top" },
    readonlyAccount: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    readonlyAccountText: { color: colors.text, fontSize: 15, fontWeight: "600" },
    readonlyAccountHint: { color: colors.textMuted, fontSize: 11 },
    lineRow: {
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.sm,
      marginBottom: spacing.sm,
      gap: spacing.xs,
    },
    lineDesc: { backgroundColor: colors.surface1 },
    lineNumRow: { flexDirection: "row", gap: spacing.xs },
    numCol: { flex: 1 },
    removeText: {
      color: colors.error,
      fontSize: 13,
      textAlign: "right",
      marginTop: spacing.xs,
    },
    secondary: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
      marginTop: spacing.xs,
    },
    secondaryText: { color: colors.text, fontSize: 14, fontWeight: "600" },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: spacing.lg,
      paddingTop: spacing.sm,
      borderTopColor: colors.border,
      borderTopWidth: 1,
    },
    totalLabel: { color: colors.textMuted, fontSize: 13, textTransform: "uppercase" },
    totalValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
    error: { color: colors.error, marginTop: spacing.sm, fontSize: 13 },
    primary: {
      marginTop: spacing.lg,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
    },
    disabled: { opacity: 0.5 },
    primaryText: { color: colors.white, fontSize: 16, fontWeight: "600" },
  });
}
