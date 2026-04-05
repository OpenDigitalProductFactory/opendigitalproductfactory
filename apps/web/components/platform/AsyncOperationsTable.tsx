// apps/web/components/platform/AsyncOperationsTable.tsx
"use client";

import type { AsyncOpRow } from "@/lib/ai-provider-types";

const STATUS_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  pending:   { emoji: "⏳", color: "var(--dpf-muted)", label: "Pending" },
  running:   { emoji: "🔵", color: "#3b82f6", label: "Running" },
  completed: { emoji: "✅", color: "var(--dpf-success)", label: "Completed" },
  failed:    { emoji: "❌", color: "var(--dpf-error)", label: "Failed" },
  expired:   { emoji: "⏰", color: "var(--dpf-warning)", label: "Expired" },
  cancelled: { emoji: "🚫", color: "var(--dpf-muted)", label: "Cancelled" },
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
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
              const cfg = STATUS_CONFIG[op.status] ?? STATUS_CONFIG["pending"] ?? { emoji: "⏳", color: "var(--dpf-muted)", label: "Pending" };
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
                    <span style={{ color: cfg.color }}>
                      {cfg.emoji} {cfg.label}
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    {op.status === "running" && op.progressPct != null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 4, background: "var(--dpf-border)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${op.progressPct}%`, height: "100%", background: "#3b82f6", borderRadius: 2 }} />
                        </div>
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
