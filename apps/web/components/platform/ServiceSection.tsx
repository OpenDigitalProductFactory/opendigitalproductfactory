"use client";

import { useState } from "react";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";

const STATUS_COLORS = {
  active:       "var(--dpf-success)",
  unconfigured: "var(--dpf-warning)",
  inactive:     "var(--dpf-muted)",
} as const;

type Props = {
  endpointType: string;
  displayName: string;
  providers: ProviderWithCredential[];
  children: React.ReactNode;
};

export function ServiceSection({ endpointType, displayName, providers, children }: Props) {
  const activeCount       = providers.filter((pw) => pw.provider.status === "active").length;
  const unconfiguredCount = providers.filter((pw) => pw.provider.status === "unconfigured").length;
  const inactiveCount     = providers.filter((pw) => pw.provider.status === "inactive").length;

  const [expanded, setExpanded] = useState(activeCount > 0);

  const typeLabel = endpointType === "service" ? "MCP" : "LLM";

  return (
    <div
      style={{
        marginBottom: 8,
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* Header bar */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: "var(--dpf-surface-2)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* Expand/collapse arrow */}
        <span
          style={{
            color: "var(--dpf-muted)",
            fontSize: 10,
            transition: "transform 0.15s",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
            lineHeight: 1,
          }}
        >
          ▶
        </span>

        {/* Type badge */}
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: endpointType === "service" ? "var(--dpf-accent)" : "var(--dpf-accent)",
            background: endpointType === "service" ? "color-mix(in srgb, var(--dpf-accent) 9%, transparent)" : "color-mix(in srgb, var(--dpf-accent) 9%, transparent)",
            padding: "1px 5px",
            borderRadius: 3,
            textTransform: "uppercase",
          }}
        >
          {typeLabel}
        </span>

        {/* Display name */}
        <span style={{ color: "var(--dpf-text)", fontSize: 11, fontWeight: 600, flex: 1 }}>
          {displayName}
        </span>

        {/* Status counts */}
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
          {activeCount > 0 && (
            <span style={{ color: STATUS_COLORS.active }}>
              {activeCount} active
            </span>
          )}
          {unconfiguredCount > 0 && (
            <span style={{ color: STATUS_COLORS.unconfigured }}>
              {unconfiguredCount} unconfigured
            </span>
          )}
          {inactiveCount > 0 && (
            <span style={{ color: STATUS_COLORS.inactive }}>
              {inactiveCount} inactive
            </span>
          )}
        </span>
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div style={{ background: "var(--dpf-surface-1)" }}>
          {children}
        </div>
      )}
    </div>
  );
}
