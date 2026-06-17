/**
 * Field-tech "Collect payment" screen.
 *
 * Opens after the invoice screen creates an invoice; the tech picks the
 * payment method (cash, cheque, card, bank transfer) and records what was
 * actually taken on site. Cash is the common HVAC-on-site case; card/Stripe
 * integration is owner-action P0 (Apple merchant + processor) per the spec.
 *
 * Substrate: POST /api/v1/finance/payments (existing) with
 * `direction: "inbound"` and `invoiceId` so the server allocates it
 * against the freshly-created invoice automatically.
 */
import React, { useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useInvoicesStore } from "@/src/features/invoices/invoices.store";
import type { PaymentMethod } from "@dpf/types";

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "cheque", label: "Cheque" },
  { key: "card", label: "Card (manual)" },
  { key: "bank_transfer", label: "Bank transfer" },
];

export default function RecordPaymentScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const router = useRouter();
  const { invoice, payment, isSubmitting, error, recordPayment } =
    useInvoicesStore();

  // Defaults: full balance on the invoice + cash (the field tech's common case).
  const owed = invoice ? invoice.amountDue || invoice.totalAmount : 0;
  const [amount, setAmount] = useState<string>(owed.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState<string>("");
  const [paymentNotes, setPaymentNotes] = useState<string>("");

  const onRecord = async (): Promise<void> => {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) return;
    const result = await recordPayment({
      method,
      amount: amt,
      reference: reference.trim() || undefined,
      notes: paymentNotes.trim() || undefined,
    });
    if (result) {
      router.replace("/jobs");
    }
  };

  if (!invoice) {
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>
          No invoice in this session — create one first.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h1}>Collect payment</Text>

      <View style={styles.invoiceCard}>
        <Text style={styles.invoiceRef}>{invoice.invoiceRef}</Text>
        <Text style={styles.invoiceMeta}>
          {invoice.currency} · Total {invoice.totalAmount.toFixed(2)} · Due{" "}
          {invoice.amountDue.toFixed(2)}
        </Text>
        {invoice.account?.name ? (
          <Text style={styles.invoiceMeta}>For {invoice.account.name}</Text>
        ) : null}
      </View>

      {payment ? (
        <Text style={styles.success} testID="payment-success">
          Recorded {payment.amount.toFixed(2)} via {payment.method}.
        </Text>
      ) : null}

      <Text style={styles.label}>Method</Text>
      <View style={styles.methodRow}>
        {METHODS.map((m) => {
          const selected = m.key === method;
          return (
            <Pressable
              key={m.key}
              onPress={() => setMethod(m.key)}
              style={[styles.methodChip, selected && styles.methodChipSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`payment-method-${m.key}`}
            >
              <Text
                style={[
                  styles.methodChipText,
                  selected && styles.methodChipTextSelected,
                ]}
              >
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Amount ({invoice.currency})</Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        style={styles.input}
        keyboardType="decimal-pad"
        testID="payment-amount"
      />

      <Text style={styles.label}>Reference (optional)</Text>
      <TextInput
        value={reference}
        onChangeText={setReference}
        style={styles.input}
        placeholder="cheque #, card last-4, etc"
        placeholderTextColor={theme.colors.textMuted}
        testID="payment-reference"
      />

      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput
        value={paymentNotes}
        onChangeText={setPaymentNotes}
        style={[styles.input, styles.multiline]}
        multiline
        testID="payment-notes"
      />

      {error ? (
        <Text style={styles.error} testID="payment-error">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={[styles.primary, isSubmitting && styles.disabled]}
        disabled={isSubmitting}
        onPress={onRecord}
        accessibilityRole="button"
        testID="payment-submit"
      >
        <Text style={styles.primaryText}>
          {isSubmitting ? "Recording…" : "Record payment"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    h1: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: spacing.md },
    invoiceCard: {
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    invoiceRef: { color: colors.text, fontSize: 16, fontWeight: "700" },
    invoiceMeta: { color: colors.textMuted, fontSize: 13 },
    label: {
      color: colors.textMuted,
      fontSize: 12,
      textTransform: "uppercase",
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
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
    methodRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    methodChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.lg,
      borderColor: colors.border,
      borderWidth: 1,
      backgroundColor: colors.surface2,
    },
    methodChipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    methodChipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
    methodChipTextSelected: { color: colors.white },
    error: { color: colors.error, marginTop: spacing.sm, fontSize: 13 },
    success: { color: colors.success, marginTop: spacing.sm, fontSize: 14 },
    primary: {
      marginTop: spacing.xl,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
    },
    disabled: { opacity: 0.5 },
    primaryText: { color: colors.white, fontSize: 16, fontWeight: "600" },
  });
}
