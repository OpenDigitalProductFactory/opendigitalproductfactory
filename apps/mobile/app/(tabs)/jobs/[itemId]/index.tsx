import React, { useEffect, useMemo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useJobsStore } from "@/src/features/jobs/jobs.store";
import { useInvoicesStore } from "@/src/features/invoices/invoices.store";
import type { WorkItemStatus } from "@dpf/types";

// Field check-in/out actions available from each status (server enforces too).
const ACTIONS: Record<WorkItemStatus, { label: string; to: WorkItemStatus }[]> = {
  queued: [{ label: "Accept job", to: "claimed" }],
  claimed: [
    { label: "Check in / start", to: "in-progress" },
    { label: "Release", to: "queued" },
  ],
  "in-progress": [
    { label: "Complete", to: "completed" },
    { label: "Pause", to: "claimed" },
  ],
  completed: [],
};

export default function JobDetailScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const router = useRouter();
  const { detail, isLoading, isUpdating, error, fetchDetail, updateStatus } =
    useJobsStore();
  const beginInvoiceDraft = useInvoicesStore((s) => s.beginDraft);

  useEffect(() => {
    if (itemId) fetchDetail(itemId);
  }, [itemId, fetchDetail]);

  if (isLoading && !detail) {
    return (
      <ActivityIndicator
        size="large"
        color={colors.primary}
        style={styles.loader}
        testID="job-loading"
      />
    );
  }

  if (!detail) {
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>{error ?? "Job not found"}</Text>
      </View>
    );
  }

  const actions = ACTIONS[detail.status] ?? [];

  // Once a job is completed, the field tech bills the customer. Seed the
  // draft with the job title as a single line so the tech only has to set
  // the price; the invoice screen lets them refine before submit. When the
  // server resolved the customer from the job's source row, pre-fill the
  // accountId so the tech doesn't type it.
  const goToInvoice = (): void => {
    beginInvoiceDraft({
      workItemId: detail.itemId,
      accountId: detail.account?.accountId,
      seedLines: [{ description: detail.title, quantity: 1, unitPrice: 0 }],
    });
    router.push(`/jobs/${encodeURIComponent(detail.itemId)}/invoice`);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{detail.title}</Text>
      <Text style={styles.status}>{detail.status}</Text>
      <Text style={styles.meta}>Urgency: {detail.urgency}</Text>
      {detail.account ? (
        <Text style={styles.meta} testID="job-customer">
          Customer: {detail.account.name}
        </Text>
      ) : null}
      {detail.dueAt ? (
        <Text style={styles.meta}>
          Due {new Date(detail.dueAt).toLocaleString()}
        </Text>
      ) : null}
      {detail.description ? (
        <Text style={styles.desc}>{detail.description}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {actions.length === 0 && detail.status !== "completed" ? (
          <Text style={styles.meta}>No further actions.</Text>
        ) : null}
        {actions.map((a) => (
          <Pressable
            key={a.to}
            style={[styles.button, isUpdating && styles.buttonDisabled]}
            disabled={isUpdating}
            onPress={() => updateStatus(detail.itemId, a.to)}
            accessibilityRole="button"
            testID={`action-${a.to}`}
          >
            <Text style={styles.buttonText}>{a.label}</Text>
          </Pressable>
        ))}
        {detail.status === "completed" ? (
          <Pressable
            style={styles.button}
            onPress={goToInvoice}
            accessibilityRole="button"
            testID="action-draft-invoice"
          >
            <Text style={styles.buttonText}>Draft invoice</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    title: { color: colors.text, fontSize: 22, fontWeight: "700" },
    status: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      marginTop: spacing.xs,
    },
    meta: { color: colors.textMuted, fontSize: 14, marginTop: spacing.xs },
    desc: { color: colors.text, fontSize: 15, marginTop: spacing.md, lineHeight: 22 },
    error: { color: colors.error, fontSize: 13, marginTop: spacing.md },
    actions: { marginTop: spacing.xl, gap: spacing.sm },
    button: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: colors.white, fontSize: 16, fontWeight: "600" },
    loader: { marginTop: spacing.xl },
  });
}
