import React, { useCallback, useEffect } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  RefreshControl,
  ActivityIndicator,
  View,
} from "react-native";
import { colors, spacing } from "@/src/lib/theme";
import { ApprovalCard } from "@/src/components/ApprovalCard";
import { useGovernanceStore } from "@/src/features/governance/governance.store";
import type { AgentActionProposal } from "@dpf/types";

export default function ApprovalsScreen() {
  const { approvals, isLoading, error, fetchApprovals, decide } =
    useGovernanceStore();

  const refresh = useCallback(() => {
    return fetchApprovals();
  }, [fetchApprovals]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDecide = useCallback(
    (id: string, decision: "approve" | "reject", rationale?: string) => {
      decide(id, decision, rationale);
    },
    [decide],
  );

  return (
    <FlatList<AgentActionProposal>
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={approvals}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ApprovalCard approval={item} onDecide={handleDecide} />
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
        <View>
          <Text style={styles.heading}>Approvals</Text>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !isLoading ? (
          <Text style={styles.emptyText}>
            No pending approvals. All caught up!
          </Text>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface1,
  },
  content: {
    paddingBottom: spacing.xl,
  },
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  errorBanner: {
    backgroundColor: colors.error + "22",
    padding: spacing.md,
    margin: spacing.md,
    borderRadius: 8,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: "center",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  loader: {
    marginTop: spacing.xl,
  },
});
