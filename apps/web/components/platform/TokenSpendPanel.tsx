"use client";

import { useState } from "react";
import type { SpendByProvider, SpendByAgent } from "@/lib/ai-provider-types";

// Month selector (switching between months) is deferred to a later phase —
// TokenUsage will be empty in Phase 7A. Current month is fixed server-side.

type Props = {
  initialMonth: { year: number; month: number };
  byProvider: SpendByProvider[];
  byAgent: SpendByAgent[];
};

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function TokenSpendPanel({ initialMonth, byProvider, byAgent }: Props) {
  const [tab, setTab] = useState<"provider" | "agent">("provider");
  const totalCost = byProvider.reduce((s, r) => s + r.totalCostUsd, 0);
  const monthLabel = `${MONTH_NAMES[(initialMonth.month - 1) % 12]} ${initialMonth.year}`;

  const isEmpty = byProvider.length === 0 && byAgent.length === 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Token Spend — {monthLabel}
          </div>
          {!isEmpty && (
            <div style={{ color: "var(--dpf-text)", fontSize: 18, fontWeight: 700, marginTop: 2 }}>
              {formatCost(totalCost)} total
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["provider", "agent"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 3, cursor: "pointer",
                background: tab === t ? "#2a2a50" : "transparent",
                border: `1px solid ${tab === t ? "#7c8cf8" : "#2a2a40"}`,
                color: tab === t ? "#7c8cf8" : "#8888a0",
              }}
            >
              {t === "provider" ? "By Provider" : "By Agent"}
            </button>
          ))}
        </div>
      </div>

      {isEmpty && (
        <p style={{ color: "var(--dpf-muted)", fontSize: 11 }}>No spend data yet — token usage will appear here once agents are active.</p>
      )}

      {!isEmpty && tab === "provider" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {byProvider.map((r) => {
            const pct = totalCost > 0 ? Math.round((r.totalCostUsd / totalCost) * 100) : 0;
            return (
              <div key={r.providerId} style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 6, padding: 10 }}>
                <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginBottom: 2 }}>{r.providerId}</div>
                <div style={{ color: "var(--dpf-text)", fontSize: 16, fontWeight: 700 }}>{formatCost(r.totalCostUsd)}</div>
                <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginTop: 2 }}>
                  {formatTokens(r.totalInputTokens)} in · {formatTokens(r.totalOutputTokens)} out
                </div>
                <div style={{ height: 4, background: "var(--dpf-border)", borderRadius: 2, marginTop: 6 }}>
                  <div style={{ height: 4, background: "#4ade80", borderRadius: 2, width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isEmpty && tab === "agent" && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ color: "var(--dpf-muted)", textAlign: "left" }}>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Agent</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Input</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Output</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {byAgent.map((r) => (
              <tr key={r.agentId} style={{ borderTop: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}>
                <td style={{ padding: "6px 8px" }}>{r.agentName}</td>
                <td style={{ padding: "6px 8px", color: "var(--dpf-muted)" }}>{formatTokens(r.totalInputTokens)}</td>
                <td style={{ padding: "6px 8px", color: "var(--dpf-muted)" }}>{formatTokens(r.totalOutputTokens)}</td>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{formatCost(r.totalCostUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
