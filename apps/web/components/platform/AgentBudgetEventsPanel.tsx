// apps/web/components/platform/AgentBudgetEventsPanel.tsx
//
// EP-COST-001 Phase 2: surfaces AgentBudgetEvent threshold crossings on
// Admin > AI Providers so operators can see which agents are near or over
// their daily token budgets.
//
// Only warning_95 and rejected events are shown (routine inference events
// are filtered out in the data layer). The panel is hidden when there are
// no qualifying events in the last 7 days.

import type { BudgetEventRow } from "@/lib/inference/budget-events-data";

interface Props {
  events: BudgetEventRow[];
  recentRejections: number;
}

const KIND_LABELS: Record<string, string> = {
  warning_95: "95% of limit",
  rejected: "Budget exceeded",
};

const KIND_COLOR: Record<string, string> = {
  warning_95: "var(--dpf-warning, #f59e0b)",
  rejected: "var(--dpf-error, #ef4444)",
};

function formatTokens(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatUsd(s: string): string {
  const n = parseFloat(s);
  if (isNaN(n)) return "—";
  return `$${n.toFixed(4)}`;
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

export function AgentBudgetEventsPanel({ events, recentRejections }: Props) {
  if (events.length === 0) return null;

  const hasRejections = recentRejections > 0;

  return (
    <div
      style={{
        marginBottom: 16,
        border: `1px solid ${hasRejections ? "var(--dpf-error, #ef4444)" : "var(--dpf-warning, #f59e0b)"}`,
        borderRadius: 8,
        padding: "12px 14px",
        background: hasRejections
          ? "var(--dpf-error-surface, #fef2f2)"
          : "var(--dpf-warning-surface, #fffbeb)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 600,
            color: hasRejections ? "var(--dpf-error-text, #991b1b)" : "var(--dpf-warning-text, #92400e)",
          }}
        >
          Agent Budget Events
          {hasRejections && (
            <span style={{ marginLeft: 8, fontWeight: 400 }}>
              — {recentRejections} rejection{recentRejections !== 1 ? "s" : ""} in the last 24h
            </span>
          )}
        </p>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>Last 7 days</span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ color: "var(--dpf-muted)" }}>
            <th style={{ textAlign: "left", padding: "2px 6px 4px 0", fontWeight: 500 }}>Agent</th>
            <th style={{ textAlign: "left", padding: "2px 6px 4px", fontWeight: 500 }}>Event</th>
            <th style={{ textAlign: "right", padding: "2px 0 4px 6px", fontWeight: 500 }}>Tokens</th>
            <th style={{ textAlign: "right", padding: "2px 0 4px 6px", fontWeight: 500 }}>Est. cost</th>
            <th style={{ textAlign: "right", padding: "2px 0 4px 6px", fontWeight: 500 }}>When</th>
          </tr>
        </thead>
        <tbody>
          {events.map((evt) => (
            <tr
              key={evt.id}
              style={{ borderTop: "1px solid var(--dpf-border-subtle, rgba(0,0,0,0.05))" }}
            >
              <td style={{ padding: "3px 6px 3px 0", color: "var(--dpf-text)", fontFamily: "monospace", fontSize: 10 }}>
                {evt.agentId.length > 30 ? `${evt.agentId.slice(0, 28)}…` : evt.agentId}
              </td>
              <td style={{ padding: "3px 6px" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "1px 6px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    background: KIND_COLOR[evt.eventKind] ?? "var(--dpf-muted)",
                    color: "#fff",
                    whiteSpace: "nowrap",
                  }}
                >
                  {KIND_LABELS[evt.eventKind] ?? evt.eventKind}
                </span>
              </td>
              <td style={{ textAlign: "right", padding: "3px 0 3px 6px", color: "var(--dpf-text)", fontVariantNumeric: "tabular-nums" }}>
                {formatTokens(evt.tokensTotal)}
              </td>
              <td style={{ textAlign: "right", padding: "3px 0 3px 6px", color: "var(--dpf-muted)", fontVariantNumeric: "tabular-nums" }}>
                {formatUsd(evt.amountUsd)}
              </td>
              <td style={{ textAlign: "right", padding: "3px 0 3px 6px", color: "var(--dpf-muted)", whiteSpace: "nowrap" }}>
                {relativeTime(evt.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ margin: "6px 0 0", fontSize: 10, color: "var(--dpf-muted)" }}>
        Budget limits are configured per-agent in{" "}
        <code style={{ fontFamily: "monospace" }}>agent_registry.json</code> → <code style={{ fontFamily: "monospace" }}>token_budget.daily_limit</code>.
        Rejected events halt inference for that agent for the remainder of the UTC day.
      </p>
    </div>
  );
}
