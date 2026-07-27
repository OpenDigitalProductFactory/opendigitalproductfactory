"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProviderWithCredential, ProviderModelSummary } from "@/lib/ai-provider-types";
import { recommendedActionFor, type RoutingEligibility } from "@/lib/routing/provider-routing-eligibility";
import { buildProviderCostView } from "@/lib/inference/ai-provider-cost-view";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { intentStyle, resolveIntent } from "@/components/ui/report-kit/statusColors";
import { ModelClassBadges } from "./ModelClassBadge";
import { ProviderStatusToggle } from "./ProviderStatusToggle";

const ROUTING_DIMS = [
  { key: "reasoning", label: "Reasoning" },
  { key: "codegen", label: "Codegen" },
  { key: "toolFidelity", label: "Tools" },
] as const;

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

/** Compact "just now / Xm / Xh / Xd / Xmo ago" for an ISO eval timestamp. */
function evalAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * BI-1B46967D: render the CALIBRATED per-model routing scores rolled up from
 * `ModelProfile` (via `getProviderModelSummaries`) plus evaluation freshness —
 * NOT the dead `ModelProvider` seed columns the routing pipeline ignores. A
 * provider with no measured model reads "not measured" instead of a misleading
 * 50/50/50, so flat placeholders no longer masquerade as real capability.
 */
function RoutingScorePills({ summary }: { summary?: ProviderModelSummary }) {
  const scores = summary?.routingScores ?? null;

  if (!scores) {
    return (
      <span
        className="hidden sm:inline-flex"
        title="No model evaluated yet — provider capability is unmeasured. Routing ranks on per-model scores, not this placeholder."
        style={{
          fontSize: 10,
          fontFamily: "monospace",
          color: "var(--dpf-muted)",
          background: "color-mix(in srgb, var(--dpf-warning) 12%, transparent)",
          padding: "1px 6px",
          borderRadius: 3,
          whiteSpace: "nowrap",
          flexShrink: 0,
          alignItems: "center",
        }}
      >
        not measured
      </span>
    );
  }

  const rep = summary?.representativeModelId;
  const fresh = summary?.lastEvalAt ? `eval ${evalAgo(summary.lastEvalAt)}` : "baseline";
  const freshTitle = summary?.lastEvalAt
    ? `Most recent evaluation ${evalAgo(summary.lastEvalAt)}${rep ? ` · strongest model: ${rep}` : ""}`
    : "Curated family baseline — no DPF evaluation has run yet";

  return (
    <span className="hidden sm:flex" style={{ display: "flex", gap: 3, flexShrink: 0, alignItems: "center" }}>
      {ROUTING_DIMS.map(({ key, label }) => {
        const score = scores[key];
        return (
          <span
            key={key}
            title={`${label}: ${score}/100${rep ? ` (${rep})` : ""}`}
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
        );
      })}
      <span title={freshTitle} style={{ fontSize: 9, color: "var(--dpf-muted)", whiteSpace: "nowrap" }}>
        {fresh}
      </span>
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
  /**
   * The single, mutually-exclusive "can routing use this now?" answer, derived
   * server-side by deriveRoutingEligibility(). Replaces the old muddle of a
   * status dot + "needs credentials" badge + a billing "Not connected" label.
   */
  eligibility: RoutingEligibility;
  /**
   * F11 (BI-1A75E068): labels of the currently-blocked build phase(s) this
   * (disabled) provider would resolve if enabled — computed by the SAME
   * phase-eligibility resolver runtime-health uses. Renders a "Resolves …" badge
   * so the operator can see, on the providers list, which one to turn on.
   */
  resolvesPhases?: string[];
  /**
   * BI-779FA953: operator-facing weekly subscription allocation hint for a CLI-
   * backed provider — "63% weekly left · resets ~2d 4h" — from the real quota
   * snapshot. Informational (not a routing state); shown regardless of the 429
   * gate so the operator can see remaining allocation. Null when no fresh reading.
   */
  weeklyAllocationHint?: string | null;
};

export function ServiceRow({ pw, modelSummary, eligibility, resolvesPhases, weeklyAllocationHint }: Props) {
  const { provider, credential } = pw;
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  // D25 (2026-05-23): prefer the tier derived from actually-discovered models
  // over the seeded provider.capabilityTier. The seed value is frequently
  // stale — e.g. a freshly discovered Sonnet 4.x model under Anthropic OAuth
  // shouldn't render as "basic" because the provider seed never updated.
  const displayedTier = modelSummary?.derivedTier ?? provider.capabilityTier ?? null;

  // The status dot mirrors the eligibility badge intent so a quick scan down the
  // left edge of the list reads the same yes/no as the badge text.
  const statusColor = intentStyle(resolveIntent("routingEligibility", eligibility.state)).fg;
  // The concrete next step for a blocked provider, surfaced in the eligibility
  // tooltip so the operator sees what to do, not just the status (null = no action).
  const recommendedAction = recommendedActionFor(eligibility);
  const eligibilityTitle = recommendedAction
    ? `${eligibility.reason} — Recommended: ${recommendedAction}`
    : eligibility.reason;
  const typeLabel   = provider.endpointType === "service" ? "MCP" : "LLM";
  const costView = buildProviderCostView({ provider, financeProfile: null, internalUsage: null });
  const detailId = `provider-${provider.providerId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-details`;

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
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${provider.name}: ${eligibility.label}`}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
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
        {/* Status dot — colored by routing eligibility */}
        <span
          title={eligibilityTitle}
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

        {/* Routing eligibility — the single "can routing use this now?" answer */}
        <span title={eligibilityTitle} style={{ flexShrink: 0, display: "inline-flex" }}>
          <StatusBadge
            domain="routingEligibility"
            status={eligibility.state}
            label={eligibility.label}
            variant="soft"
            uppercase={false}
          />
        </span>

        {/* F11: "would resolve a blocked phase if enabled" badge */}
        {resolvesPhases && resolvesPhases.length > 0 && (
          <span
            title={`Enabling this provider would resolve the currently-blocked ${resolvesPhases.join(
              ", ",
            )} phase${resolvesPhases.length > 1 ? "s" : ""}.`}
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--dpf-success)",
              background: "color-mix(in srgb, var(--dpf-success) 14%, transparent)",
              padding: "1px 6px",
              borderRadius: 3,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            Resolves {resolvesPhases.join(", ")}
          </span>
        )}

        {recommendedAction && (
          <span
            title={recommendedAction}
            style={{
              color: "var(--dpf-muted)",
              fontSize: 10,
              flexShrink: 1,
              minWidth: 0,
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {recommendedAction}
          </span>
        )}

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

        {/* External-billing reconciliation status lives in the expanded detail
            below (clearly labeled), NOT here — it is a finance signal, not a
            connectivity one, and rendering it beside the toggle made every
            provider read "Not connected" (BI-1C4AAE1E). */}

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
          id={detailId}
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
            {weeklyAllocationHint && (
              <DetailItem label="Weekly allocation" value={weeklyAllocationHint} />
            )}
            {provider.endpointType === "llm" && modelSummary && (
              <DetailItem label="Active models" value={`${modelSummary.activeModels}/${modelSummary.totalModels}`} />
            )}
          </div>

          {provider.endpointType === "llm" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>Routing diagnostics:</span>
              <RoutingScorePills summary={modelSummary} />
              {modelSummary && modelSummary.nonChatClasses.length > 0 && (
                <ModelClassBadges classes={modelSummary.nonChatClasses} />
              )}
              {displayedTier && (
                <span
                  style={{ color: "var(--dpf-muted)", fontSize: 10, flexShrink: 0 }}
                  title={modelSummary?.derivedTier
                    ? "Derived from discovered models"
                    : "From provider seed (no models discovered yet)"}
                >
                  {displayedTier}
                </span>
              )}
            </div>
          )}

          {provider.sensitivityClearance.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              <span style={{ color: "var(--dpf-muted)", fontSize: 10, marginRight: 4, alignSelf: "center" }}>Sensitivity:</span>
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
            </div>
          )}

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
