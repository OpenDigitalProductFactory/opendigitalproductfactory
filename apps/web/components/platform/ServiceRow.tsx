"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProviderWithCredential, ProviderModelSummary } from "@/lib/ai-provider-types";
import { buildProviderCostView } from "@/lib/inference/ai-provider-cost-view";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { ModelClassBadges } from "./ModelClassBadge";
import { ProviderStatusToggle } from "./ProviderStatusToggle";

const STATUS_COLORS: Record<string, string> = {
  active:       "var(--dpf-success)",
  unconfigured: "var(--dpf-warning)",
  inactive:     "var(--dpf-muted)",
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
  if (score >= 80) return "color-mix(in srgb, var(--dpf-success) 15%, transparent)";
  if (score >= 50) return "color-mix(in srgb, var(--dpf-warning) 15%, transparent)";
  return "color-mix(in srgb, var(--dpf-error) 15%, transparent)";
}

function scoreTextColor(score: number): string {
  if (score >= 80) return "var(--dpf-success)";
  if (score >= 50) return "var(--dpf-warning)";
  return "var(--dpf-error)";
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

  // Show actual readiness, not just the DB status field.
  // A provider marked "active" but with no credential is NOT ready.
  const needsCredential = provider.authMethod !== "none" && !credential;
  const effectiveStatus = (provider.status === "active" && needsCredential) ? "needs-credentials" : provider.status;

  // D25 (2026-05-23): prefer the tier derived from actually-discovered models
  // over the seeded provider.capabilityTier. The seed value is frequently
  // stale — e.g. a freshly discovered Sonnet 4.x model under Anthropic OAuth
  // shouldn't render as "basic" because the provider seed never updated.
  const displayedTier = modelSummary?.derivedTier ?? provider.capabilityTier ?? null;

  const STATUS_COLORS_EXT: Record<string, string> = {
    ...STATUS_COLORS,
    "needs-credentials": "var(--dpf-warning)",
  };
  const statusColor = STATUS_COLORS_EXT[effectiveStatus] ?? "var(--dpf-muted)";
  const typeLabel   = provider.endpointType === "service" ? "MCP" : "LLM";
  const costView = buildProviderCostView({ provider, financeProfile: null, internalUsage: null });

  return (
    <div
      style={{
        borderBottom: "1px solid var(--dpf-border)",
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
          background: hovered ? "var(--dpf-surface-2)" : "transparent",
          transition: "background 0.1s",
        }}
      >
        {/* Status dot */}
        <span
          title={effectiveStatus === "needs-credentials" ? "Active but missing credentials — configure to use" : provider.status}
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
            color: "var(--dpf-accent)",
            background: "color-mix(in srgb, var(--dpf-accent) 10%, transparent)",
            padding: "1px 5px",
            borderRadius: 3,
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {typeLabel}
        </span>

        {/* Credential warning */}
        {needsCredential && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "var(--dpf-warning)",
              background: "color-mix(in srgb, var(--dpf-warning) 10%, transparent)",
              padding: "1px 5px",
              borderRadius: 3,
              flexShrink: 0,
            }}
          >
            needs credentials
          </span>
        )}

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
                  background: "color-mix(in srgb, var(--dpf-text) 6%, transparent)",
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

        {/* Capability tier — hidden on small screens. Prefers derived tier (D25). */}
        {displayedTier && (
          <span
            className="hidden sm:inline"
            style={{ color: "var(--dpf-muted)", fontSize: 10, flexShrink: 0 }}
            title={modelSummary?.derivedTier
              ? "Derived from discovered models"
              : "From provider seed (no models discovered yet)"}
          >
            {displayedTier}
          </span>
        )}

        <span className="hidden sm:inline" style={{ color: "var(--dpf-muted)", fontSize: 10, flexShrink: 0 }}>
          {costView.externalProviderBilling.value}
        </span>

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
            background: "var(--dpf-surface-1)",
            borderTop: "1px solid var(--dpf-border)",
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
            <DetailItem label="Capability Tier"  value={displayedTier ?? "—"} />
            <DetailItem label={costView.routingCostBand.label} value={costView.routingCostBand.value} />
            <DetailItem label={costView.catalogPricing.label} value={costView.catalogPricing.value} />
            <DetailItem label={costView.externalProviderBilling.label} value={costView.externalProviderBilling.value} />
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
                    color: "var(--dpf-muted)",
                    background: "color-mix(in srgb, var(--dpf-text) 4%, transparent)",
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

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>{costView.catalogPricing.label}</span>
              <DataSourceBadge compact provenance={costView.catalogPricing.provenance} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>{costView.externalProviderBilling.label}</span>
              <DataSourceBadge compact provenance={costView.externalProviderBilling.provenance} />
            </div>
          </div>

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
