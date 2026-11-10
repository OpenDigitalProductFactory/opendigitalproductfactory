// apps/web/components/platform/AsyncOperationsTable.tsx
"use client";

import type { AsyncOpRow } from "@/lib/ai-provider-types";
import type { AsyncInferenceOperationStatus } from "@/lib/inference/async-operation-contract";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusBadge } from "@/components/ui/report-kit";

const STATUS_LABEL: Record<AsyncInferenceOperationStatus, string> = {
  pending: "Pending",
  start_indeterminate: "Start needs reconciliation",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled",
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / 60_000);
  const hours = Math.floor(minutes / 60);
  const elapsed = hours > 24
    ? `${Math.floor(hours / 24)}d`
    : hours > 0
      ? `${hours}h`
      : minutes > 0
        ? `${minutes}m`
        : null;
  if (!elapsed) return diff < 0 ? "in less than a minute" : "just now";
  return diff < 0 ? `in ${elapsed}` : `${elapsed} ago`;
}

type Props = {
  operations: AsyncOpRow[];
};

export function AsyncOperationsTable({ operations }: Props) {
  if (operations.length === 0) {
    return (
      <div style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        padding: "20px 16px",
        textAlign: "center",
      }}>
        <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: 0 }}>
          No async operations recorded yet. Deep Research and other long-running operations will appear here.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
              {["ID", "Provider", "Model", "Status", "Progress", "Created", "Completed/Expires"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 10px",
                    textAlign: "left",
                    color: "var(--dpf-muted)",
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => {
              return (
                <tr key={op.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)", fontFamily: "monospace", fontSize: 10 }}>
                    {op.id.slice(0, 8)}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-text)" }}>
                    {op.providerId}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {op.modelId}
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <StatusBadge
                      domain="asyncInferenceOperation"
                      status={op.status}
                      label={STATUS_LABEL[op.status]}
                      uppercase={false}
                    />
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    {op.status === "running" && op.progressPct != null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <ProgressBar
                          value={op.progressPct}
                          label={`Progress for ${op.id}`}
                          size="sm"
                        />
                        <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{op.progressPct}%</span>
                      </div>
                    ) : op.progressMessage ? (
                      <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>{op.progressMessage}</span>
                    ) : op.status === "failed" && op.errorMessage ? (
                      <span style={{ color: "var(--dpf-error)", fontSize: 10 }} title={op.errorMessage}>
                        {op.errorMessage.slice(0, 50)}{op.errorMessage.length > 50 ? "..." : ""}
                      </span>
                    ) : (
                      <span style={{ color: "var(--dpf-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {formatRelative(op.createdAt)}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {op.completedAt
                      ? formatRelative(op.completedAt)
                      : `expires ${formatRelative(op.expiresAt)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
