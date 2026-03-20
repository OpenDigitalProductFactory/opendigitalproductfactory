import React, { useState } from "react";
import { Text, View, StyleSheet, TextInput } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import type { AgentActionProposal } from "@dpf/types";

export interface ApprovalCardProps {
  approval: AgentActionProposal;
  onDecide: (
    id: string,
    decision: "approve" | "reject",
    rationale?: string,
  ) => void;
}

export function ApprovalCard({ approval, onDecide }: ApprovalCardProps) {
  const [rationale, setRationale] = useState("");
  const params = approval.parameters as Record<string, unknown>;
  const paramSummary = Object.entries(params ?? {})
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.actionType}>{approval.actionType}</Text>
        <Text style={styles.status}>{approval.status}</Text>
      </View>

      {paramSummary ? (
        <Text style={styles.params} numberOfLines={2}>
          {paramSummary}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.agent}>Agent: {approval.agentId}</Text>
        <Text style={styles.date}>
          {new Date(approval.proposedAt).toLocaleDateString()}
        </Text>
      </View>

      <TextInput
        style={styles.rationaleInput}
        value={rationale}
        onChangeText={setRationale}
        placeholder="Rationale (optional)"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Rationale"
      />

      <View style={styles.actions}>
        <Button
          title="Approve"
          onPress={() =>
            onDecide(approval.id, "approve", rationale || undefined)
          }
          variant="primary"
        />
        <Button
          title="Reject"
          onPress={() =>
            onDecide(approval.id, "reject", rationale || undefined)
          }
          variant="secondary"
        />
      </View>
    </Card>
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
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  actionType: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  status: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  params: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  agent: {
    color: colors.textMuted,
    fontSize: 12,
  },
  date: {
    color: colors.textMuted,
    fontSize: 12,
  },
  rationaleInput: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
});
