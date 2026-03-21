"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProviderWithCredential, ProviderModelSummary } from "@/lib/ai-provider-types";
import { getBillingLabel } from "@/lib/ai-provider-types";
import { ModelClassBadges } from "./ModelClassBadge";
import { ProviderStatusToggle } from "./ProviderStatusToggle";

const STATUS_COLORS: Record<string, string> = {
  active:       "#4ade80",
  unconfigured: "#fbbf24",
  inactive:     "#8888a0",
};

const ROUTING_DIMENSION_LABELS: Record<string, string> = {
  reasoning:            "Reasoning",
  codegen:              "Codegen",
  toolFidelity:         "Tools",
  instructionFollowing: "Instruct",
  structuredOutput:     "Structure",
  conversational:       "Convo",
  contextRetention:     "Context",
};

function scoreColor(score: number): string {
  if (score >= 80) return "rgba(74, 222, 128, 0.15)";
  if (score >= 50) return "rgba(251, 191, 36, 0.15)";
  return "rgba(239, 68, 68, 0.15)";
}

function scoreTextColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 50) return "#fbbf24";
  return "#ef4444";
}

type RoutingScorePillsProps = {
  provider: ProviderWithCredential["provider"];
};

function RoutingScorePills({ provider }: RoutingScorePillsProps) {
  const dimensions = Object.keys(ROUTING_DIMENSION_LABELS) as (keyof typeof ROUTING_DIMENSION_LABELS)[];
  const scored = dimensions
    .map((key) => ({ key, label: ROUTING_DIMENSION_LABELS[key], score: provider[key as keyof typeof provider] as number }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return (
    <span className="hidden sm:flex" style={{ display: "flex", gap: 3, flexShrink: 0, alignItems: "center" }}>
      {scored.map(({ key, label, score }) => (
        <span
          key={key}
          title={`${label}: ${score}/100`}
          style={{
            fontSize: 10,
            fontFamily: "monospace",
            background: scoreColor(score),
            color: scoreTextColor(score),
            padding: "1px 5px",
            borderRadius: 3,
            whiteSpace: "nowrap",
          }}
        >
          {label}: {score}
        </span>
      ))}
    </span>
  );
}

const SENSITIVITY_ABBR: Record<string, string> = {
  public:       "pub",
  internal:     "int",
  confidential: "con",
  restricted:   "res",
};

type Props = {
  pw: ProviderWithCredential;
  modelSummary?: ProviderModelSummary;
};

export function ServiceRow({ pw, modelSummary }: Props) {
  const { provider, credential } = pw;
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const statusColor = STATUS_COLORS[provider.status] ?? "#8888a0";
  const typeLabel   = provider.endpointType === "service" ? "MCP" : "LLM";
  const billingLabel = getBillingLabel(provider);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--dpf-border, #2a2a40)",
      }}
    >
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          cursor: "pointer",
          background: hovered ? "var(--dpf-surface-2, #1a1a2e)" : "transparent",
          transition: "background 0.1s",
        }}
      >
        {/* Status dot */}
        <span
          title={provider.status}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: statusColor,
            flexShrink: 0,
          }}
        />

        {/* Name */}
        <span
          style={{
            color: "var(--dpf-text)",
            fontSize: 11,
            fontWeight: 600,
            flex: "1 1 0",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {provider.name}
        </span>

        {/* Type badge */}
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: provider.endpointType === "service" ? "#a78bfa" : "#7c8cf8",
            background: provider.endpointType === "service" ? "#a78bfa18" : "#7c8cf818",
            padding: "1px 5px",
            borderRadius: 3,
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {typeLabel}
        </span>

        {/* Model count — LLM only */}
        {provider.endpointType === "llm" && modelSummary && (
          <span
            style={{
              fontSize: 10,
              color: "var(--dpf-muted)",
              flexShrink: 0,
              fontFamily: "monospace",
            }}
          >
            {modelSummary.activeModels}/{modelSummary.totalModels} models
          </span>
        )}

        {/* Non-chat capability badges — LLM only */}
        {provider.endpointType === "llm" && modelSummary && modelSummary.nonChatClasses.length > 0 && (
          <span className="hidden sm:inline" style={{ flexShrink: 0 }}>
            <ModelClassBadges classes={modelSummary.nonChatClasses} />
          </span>
        )}

        {/* Sensitivity clearance badges — hidden on small screens */}
        {provider.sensitivityClearance.length > 0 && (
          <span
            className="hidden sm:flex"
            style={{ display: "flex", gap: 3, flexShrink: 0 }}
          >
            {provider.sensitivityClearance.map((s) => (
              <span
                key={s}
                style={{
                  fontSize: 9,
                  color: "var(--dpf-muted)",
                  background: "#ffffff0f",
                  padding: "1px 4px",
                  borderRadius: 2,
                }}
              >
                {SENSITIVITY_ABBR[s] ?? s}
              </span>
            ))}
          </span>
        )}

        {/* Routing dimension scores — LLM only, hidden on small screens */}
        {provider.endpointType === "llm" && (
          <RoutingScorePills provider={provider} />
        )}

        {/* Capability tier — hidden on small screens */}
        {provider.capabilityTier && (
          <span
            className="hidden sm:inline"
            style={{ color: "var(--dpf-muted)", fontSize: 10, flexShrink: 0 }}
          >
            {provider.capabilityTier}
          </span>
        )}

        {/* Cost band — hidden on small screens */}
        {provider.costBand && (
          <span
            className="hidden sm:inline"
            style={{ color: "var(--dpf-muted)", fontSize: 10, flexShrink: 0 }}
          >
            {provider.costBand}
          </span>
        )}

        {/* Status toggle */}
        <span
          style={{ flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <ProviderStatusToggle
            providerId={provider.providerId}
            initialStatus={provider.status}
          />
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            padding: "10px 14px 12px 26px",
            background: "var(--dpf-surface-1, #13131f)",
            borderTop: "1px solid var(--dpf-border, #2a2a40)",
          }}
        >
          {/* Detail grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "6px 16px",
              marginBottom: 10,
            }}
          >
            <DetailItem label="Endpoint URL"     value={provider.baseUrl ?? provider.endpoint ?? "—"} mono />
            <DetailItem label="Auth method"      value={provider.authMethod} />
            {provider.endpointType === "service" && (
              <DetailItem label="Transport" value={provider.mcpTransport ?? "—"} />
            )}
            <DetailItem label="Sensitivity"      value={provider.sensitivityClearance.join(", ") || "—"} />
            <DetailItem label="Capability Tier"  value={provider.capabilityTier || "—"} />
            <DetailItem label="Cost Band"        value={provider.costBand || "—"} />
          </div>

          {/* Task tags */}
          {provider.taskTags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              <span style={{ color: "var(--dpf-muted)", fontSize: 10, marginRight: 4, alignSelf: "center" }}>Tasks:</span>
              {provider.taskTags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 10,
                    color: "#a0a0c0",
                    background: "#ffffff0a",
                    border: "1px solid var(--dpf-border)",
                    padding: "1px 6px",
                    borderRadius: 3,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Model families (LLM only) */}
          {provider.endpointType !== "mcp" && provider.families.length > 0 && (
            <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginBottom: 8 }}>
              <span style={{ marginRight: 4 }}>Models:</span>
              {provider.families.join(" · ")}
            </div>
          )}

          {/* Billing label */}
          {billingLabel && (
            <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginBottom: 8 }}>
              {billingLabel}
            </div>
          )}

          {/* Credential hint */}
          {credential?.secretHint && (
            <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginBottom: 8 }}>
              API key: <span style={{ fontFamily: "monospace" }}>{credential.secretHint}</span>
            </div>
          )}

          {/* Links */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Link
              href={`/platform/ai/providers/${provider.providerId}`}
              style={{ color: "var(--dpf-accent)", fontSize: 10 }}
            >
              Configure →
            </Link>
            {provider.docsUrl && (
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--dpf-muted)", fontSize: 10 }}
              >
                Docs
              </a>
            )}
            {provider.consoleUrl && (
              <a
                href={provider.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--dpf-muted)", fontSize: 10 }}
              >
                Console
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: "var(--dpf-muted)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          color: "var(--dpf-muted)",
          fontSize: 10,
          fontFamily: mono ? "monospace" : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
