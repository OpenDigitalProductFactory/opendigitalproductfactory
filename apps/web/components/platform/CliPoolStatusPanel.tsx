// apps/web/components/platform/CliPoolStatusPanel.tsx
//
// EP-COST Phase 4: Surfaces CLI pool rate-limit state on Admin > AI Providers.
// Shows a banner only when at least one pool is exhausted; hidden when all
// pools are healthy. No persistent exhaustion rows means no banner.

import { LocalTime } from "@/components/ui/LocalTime";
import type { CliPoolState } from "@/lib/routing/cli-pool-status";

interface Props {
  statuses: CliPoolState[];
}

const ADAPTER_LABELS: Record<string, string> = {
  "claude-cli": "Claude Code CLI (subscription)",
  "codex-cli": "Codex CLI (OpenAI subscription)",
};

function formatResetTime(resetAt: Date | null, secondsUntilReset: number | null): string {
  if (!resetAt) return "unknown";
  if (secondsUntilReset != null && secondsUntilReset <= 0) return "any moment";
  if (secondsUntilReset != null && secondsUntilReset < 60) return `~${secondsUntilReset}s`;
  if (secondsUntilReset != null) return `~${Math.ceil(secondsUntilReset / 60)}min`;
  return new Date(resetAt).toLocaleTimeString();
}

export function CliPoolStatusPanel({ statuses }: Props) {
  const exhausted = statuses.filter((s) => s.isExhausted);
  const recentlyLimited = statuses.filter((s) => !s.isExhausted && s.rateLimitedAt);

  if (statuses.length === 0) {
    // No 429 events recorded — healthy state, nothing to show.
    return null;
  }

  return (
    <div
      style={{
        marginBottom: 16,
        border: `1px solid ${exhausted.length > 0 ? "var(--dpf-warning, #f59e0b)" : "var(--dpf-border)"}`,
        borderRadius: 8,
        padding: "12px 14px",
        background: exhausted.length > 0
          ? "var(--dpf-warning-surface, #fffbeb)"
          : "var(--dpf-surface-1)",
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          fontSize: 12,
          fontWeight: 600,
          color: exhausted.length > 0 ? "var(--dpf-warning-text, #92400e)" : "var(--dpf-text)",
        }}
      >
        CLI Pool Status
        {exhausted.length > 0 && (
          <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--dpf-warning-text, #92400e)" }}>
            — {exhausted.length} pool{exhausted.length !== 1 ? "s" : ""} rate-limited
          </span>
        )}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {statuses.map((s) => (
          <div
            key={s.adapterType}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--dpf-text)",
            }}
          >
            {/* Status dot */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                background: s.isExhausted
                  ? "var(--dpf-warning, #f59e0b)"
                  : "var(--dpf-success, #10b981)",
              }}
            />

            {/* Adapter name */}
            <span style={{ minWidth: 200, fontWeight: 500 }}>
              {ADAPTER_LABELS[s.adapterType] ?? s.adapterType}
            </span>

            {/* State */}
            {s.isExhausted ? (
              <span style={{ color: "var(--dpf-warning-text, #92400e)" }}>
                Rate-limited · resets {formatResetTime(s.resetAt, s.secondsUntilReset)}
              </span>
            ) : (
              <span style={{ color: "var(--dpf-muted)" }}>
                Previously limited <LocalTime value={s.rateLimitedAt} mode="time" /> · pool recovered
              </span>
            )}

            {/* Error snippet */}
            {s.errorSnippet && (
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "monospace",
                  fontSize: 10,
                  color: "var(--dpf-muted)",
                  maxWidth: 260,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={s.errorSnippet}
              >
                {s.errorSnippet.slice(0, 80)}
              </span>
            )}
          </div>
        ))}
      </div>

      {recentlyLimited.length > 0 && exhausted.length === 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 10, color: "var(--dpf-muted)" }}>
          All pools healthy. Historical events shown; rows clear automatically on the next successful call.
        </p>
      )}
    </div>
  );
}
