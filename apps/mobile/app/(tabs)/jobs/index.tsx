import React, { useCallback, useEffect, useMemo } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useJobsStore } from "@/src/features/jobs/jobs.store";
import type { WorkItemSummary, WorkItemStatus } from "@dpf/types";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export default function JobsScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const router = useRouter();
  const { jobs, isLoading, error, fetchJobs } = useJobsStore();

  const refresh = useCallback(() => fetchJobs(), [fetchJobs]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <FlatList<WorkItemSummary>
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={jobs}
      keyExtractor={(j) => j.itemId}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() => router.push(`/jobs/${item.itemId}`)}
          accessibilityRole="button"
          testID={`job-${item.itemId}`}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.status, { color: statusColor(item.status, colors) }]}>
              {item.status}
            </Text>
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.meta}>{item.urgency}</Text>
            {item.dueAt ? (
              <Text style={styles.meta}>Due {formatDate(item.dueAt)}</Text>
            ) : null}
          </View>
        </Pressable>
      )}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={refresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={
        error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        !isLoading ? (
          <Text style={styles.empty}>No jobs assigned</Text>
        ) : (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={styles.loader}
          />
        )
      }
    />
  );
}

function statusColor(
  status: WorkItemStatus,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  switch (status) {
    case "completed":
      return colors.success;
    case "in-progress":
      return colors.primary;
    case "claimed":
      return colors.warning;
    default:
      return colors.textMuted;
  }
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    card: {
      backgroundColor: colors.surface2,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600", flex: 1 },
    status: { fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
    cardMeta: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
    meta: { color: colors.textMuted, fontSize: 13 },
    errorBanner: {
      backgroundColor: colors.error + "22",
      padding: spacing.md,
      borderRadius: borderRadius.sm,
      marginBottom: spacing.sm,
    },
    errorText: { color: colors.error, fontSize: 13, textAlign: "center" },
    empty: { color: colors.textMuted, fontSize: 14, textAlign: "center", marginTop: spacing.lg },
    loader: { marginTop: spacing.xl },
  });
}
