// apps/web/components/platform/RecipePanel.tsx
"use client";

import { useState } from "react";
import type { RecipeGridRow } from "@/lib/ai-provider-types";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";

const STATUS_COLORS: Record<string, string> = {
  champion: "var(--dpf-success)",
  challenger: "var(--dpf-warning)",
  retired: "var(--dpf-muted)",
};

const ADAPTER_LABELS: Record<string, string> = {
  chat: "Chat",
  embedding: "Embedding",
  image_gen: "Image Gen",
  transcription: "Transcription",
  async: "Async",
};

type Props = {
  recipes: RecipeGridRow[];
};

const columns: Column<RecipeGridRow>[] = [
  {
    key: "family",
    header: "Contract Family",
    mono: true,
    cell: (r) => r.contractFamily,
  },
  {
    key: "model",
    header: "Model",
    cell: (r) => r.modelId,
  },
  {
    key: "adapter",
    header: "Adapter",
    cell: (r) => ADAPTER_LABELS[r.executionAdapter] ?? r.executionAdapter,
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => (
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
    ),
  },
  {
    key: "version",
    header: "Ver",
    align: "center",
    cell: (r) => `v${r.version}`,
  },
  {
    key: "origin",
    header: "Origin",
    cell: (r) => r.origin,
  },
];

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
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v);
        }}
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

      {expanded && (
        <div style={{ borderTop: "1px solid var(--dpf-border)" }}>
          <DataTable
            columns={columns}
            dense
            getRowKey={(r) => r.id}
            rows={recipes}
          />
        </div>
      )}
    </div>
  );
}
