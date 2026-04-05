// apps/web/components/platform/ToolInventoryPanel.tsx
"use client";

import { useState } from "react";
import type { ToolInventoryItem } from "@/lib/ai-provider-types";

type Props = {
  tools: ToolInventoryItem[];
};

export function ToolInventoryPanel({ tools }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");

  const platformCount = tools.filter((t) => t.type === "platform").length;
  const mcpCount = tools.filter((t) => t.type === "mcp").length;

  const filtered = filter
    ? tools.filter(
        (t) =>
          t.name.toLowerCase().includes(filter.toLowerCase()) ||
          t.source.toLowerCase().includes(filter.toLowerCase()),
      )
    : tools;

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}>
            Agent Tool Inventory
          </span>
          <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
            {platformCount} platform · {mcpCount} MCP · {tools.length} total
          </span>
        </div>
        <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--dpf-border)" }}>
          {/* Search */}
          <div style={{ padding: "8px 16px" }}>
            <input
              type="text"
              placeholder="Filter tools..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "4px 8px",
                fontSize: 11,
                background: "var(--dpf-bg)",
                border: "1px solid var(--dpf-border)",
                borderRadius: 4,
                color: "var(--dpf-text)",
                outline: "none",
              }}
            />
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  {["Tool Name", "Source", "Type", "Enabled", "Gating"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "6px 10px",
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
                {filtered.map((t) => (
                  <tr key={t.name} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ color: "var(--dpf-text)", fontFamily: "monospace", fontSize: 10 }}>
                        {t.name}
                      </span>
                      {t.originalName && (
                        <span style={{ color: "var(--dpf-muted)", fontSize: 9, marginLeft: 6 }}>
                          ({t.originalName})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                      {t.source}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: t.type === "platform" ? "var(--dpf-accent)" : "var(--dpf-accent)",
                          background: t.type === "platform" ? "color-mix(in srgb, var(--dpf-accent) 9%, transparent)" : "color-mix(in srgb, var(--dpf-accent) 9%, transparent)",
                          padding: "1px 5px",
                          borderRadius: 3,
                          textTransform: "uppercase",
                        }}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ color: t.enabled ? "var(--dpf-success)" : "var(--dpf-muted)", fontSize: 10 }}>
                        {t.enabled ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px", color: "var(--dpf-muted)", fontSize: 10 }}>
                      {t.gating ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div style={{ padding: "12px 16px", textAlign: "center", color: "var(--dpf-muted)", fontSize: 11 }}>
              No tools match filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
