// apps/web/components/platform/RecipePanel.tsx
"use client";

import { useState } from "react";
import type { RecipeGridRow } from "@/lib/ai-provider-types";

const STATUS_COLORS: Record<string, string> = {
  champion:   "var(--dpf-success)",
  challenger: "var(--dpf-warning)",
  retired:    "var(--dpf-muted)",
};

const ADAPTER_LABELS: Record<string, string> = {
  chat:          "Chat",
  embedding:     "Embedding",
  image_gen:     "Image Gen",
  transcription: "Transcription",
  async:         "Async",
};

type Props = {
  recipes: RecipeGridRow[];
};

export function RecipePanel({ recipes }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (recipes.length === 0) return null;

  const championCount = recipes.filter((r) => r.status === "champion").length;
  const challengerCount = recipes.filter((r) => r.status === "challenger").length;

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        marginTop: 16,
        overflow: "hidden",
      }}
    >
      {/* Header (toggle) */}
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
            Execution Recipes
          </span>
          <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
            {recipes.length} recipe{recipes.length !== 1 ? "s" : ""}
            {championCount > 0 && ` · ${championCount} champion`}
            {challengerCount > 0 && ` · ${challengerCount} challenger`}
          </span>
        </div>
        <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Table */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--dpf-border)", overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 11,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                {["Contract Family", "Model", "Adapter", "Status", "Ver", "Origin"].map((h) => (
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
              {recipes.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid var(--dpf-border)" }}
                >
                  <td style={{ padding: "6px 10px", color: "var(--dpf-text)", fontFamily: "monospace" }}>
                    {r.contractFamily}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {r.modelId}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {ADAPTER_LABELS[r.executionAdapter] ?? r.executionAdapter}
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: STATUS_COLORS[r.status] ?? "var(--dpf-muted)",
                        background: `color-mix(in srgb, ${STATUS_COLORS[r.status] ?? "var(--dpf-muted)"} 9%, transparent)`,
                        padding: "1px 5px",
                        borderRadius: 3,
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)", textAlign: "center" }}>
                    v{r.version}
                  </td>
                  <td style={{ padding: "6px 10px", color: "var(--dpf-muted)" }}>
                    {r.origin}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
