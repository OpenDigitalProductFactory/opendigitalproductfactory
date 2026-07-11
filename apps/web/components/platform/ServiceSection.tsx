"use client";

import { useState } from "react";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";
import type { RoutingEligibility } from "@/lib/routing/provider-routing-eligibility";
import { intentStyle } from "@/components/ui/report-kit/statusColors";

type Props = {
  endpointType: string;
  displayName: string;
  providers: ProviderWithCredential[];
  /** Per-provider routing eligibility, keyed by providerId. Drives the counts. */
  eligibilityById: Record<string, RoutingEligibility>;
  /** F11: a provider in this group would resolve a blocked phase — open it so the badge shows. */
  hasResolver?: boolean;
  children: React.ReactNode;
};

export function ServiceSection({ endpointType, displayName, providers, eligibilityById, hasResolver, children }: Props) {
  // Summarize by routing eligibility (the operator question), not raw lifecycle.
  const states = providers.map(
    (pw) => eligibilityById[pw.provider.providerId]?.state ?? "unconfigured",
  );
  const routableCount  = states.filter((s) => s === "routable").length;
  const attentionCount = states.filter(
    (s) => s === "needs_credentials" || s === "no_models" || s === "rate_limited",
  ).length;
  const offCount = states.filter(
    (s) => s === "disabled" || s === "unconfigured" || s === "not_routable",
  ).length;

  // Open the section when something is usable or needs attention.
  const [expanded, setExpanded] = useState(routableCount > 0 || attentionCount > 0 || !!hasResolver);

  const typeLabel = endpointType === "service"
    ? "MCP"
    : endpointType === "responses"
      ? "Responses"
      : endpointType === "transcription"
        ? "Speech"
        : endpointType === "router"
          ? "Router"
          : "LLM";

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
            color: "var(--dpf-accent)",
            background: "color-mix(in srgb, var(--dpf-accent) 9%, transparent)",
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

        {/* Eligibility counts */}
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
          {routableCount > 0 && (
            <span style={{ color: intentStyle("success").fg }}>
              {routableCount} routable
            </span>
          )}
          {attentionCount > 0 && (
            <span style={{ color: intentStyle("warning").fg }}>
              {attentionCount} need attention
            </span>
          )}
          {offCount > 0 && (
            <span style={{ color: intentStyle("neutral").fg }}>
              {offCount} off
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
