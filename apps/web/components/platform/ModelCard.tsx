"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerDimensionEval } from "@/lib/actions/endpoint-performance";
import type { DiscoveredModelRow, ModelProfileRow } from "@/lib/ai-provider-types";

// EP-INF-006: Routing profile data merged into ModelCard
type RoutingProfileData = {
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowingScore: number;
  structuredOutputScore: number;
  conversational: number;
  contextRetention: number;
  profileSource: string;
  profileConfidence: string;
  evalCount: number;
  lastEvalAt: string | null;
  modelStatus: string;
};

type Props = {
  model: DiscoveredModelRow;
  profile: ModelProfileRow | null;
  isStale: boolean;
  profilingFailed: boolean;
  canWrite: boolean;
  hasActiveProvider: boolean;
  onProfile: (modelId: string) => void;
  // EP-INF-006: Merged routing profile data
  routingProfile?: RoutingProfileData | null;
  endpointId?: string;
  onRunEval?: (modelId: string) => void;
};

// ── Model class colours ──────────────────────────────────────────────────────

const MODEL_CLASS_COLOURS: Record<string, string> = {
  chat:      "#38bdf8", // blue
  reasoning: "#a78bfa", // purple
  embedding: "#4ade80", // green
  image_gen: "#fb923c", // orange
  code:      "#2dd4bf", // teal
};

function modelClassColour(cls: string): string {
  return MODEL_CLASS_COLOURS[cls] ?? "#8888a0";
}

// ── Metadata confidence colours ──────────────────────────────────────────────

const CONFIDENCE_COLOURS: Record<string, string> = {
  high:   "#4ade80",
  medium: "#fbbf24",
  low:    "#f87171",
};

// ── Token formatting ─────────────────────────────────────────────────────────

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M tokens`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K tokens`;
  }
  return `${tokens} tokens`;
}

// ── Pricing formatting ───────────────────────────────────────────────────────

function formatPricing(pricing: Record<string, unknown> | undefined): string | null {
  if (!pricing) return null;
  const input = pricing.inputPerMToken;
  const output = pricing.outputPerMToken;
  if (typeof input === "number" && typeof output === "number") {
    return `$${input} / $${output} per M tokens`;
  }
  return null;
}

// ── Capability badges ────────────────────────────────────────────────────────

type CapBadge = { label: string; key: string };

const CAPABILITY_BADGE_MAP: { key: string; label: string }[] = [
  { key: "toolUse",          label: "Tools" },
  { key: "thinking",         label: "Thinking" },
  { key: "imageInput",       label: "Vision" },
  { key: "structuredOutput", label: "Structured Output" },
  { key: "codeExecution",    label: "Code Exec" },
];

function getCapabilityBadges(capabilities: Record<string, unknown> | undefined): CapBadge[] {
  if (!capabilities) return [];
  return CAPABILITY_BADGE_MAP.filter((c) => capabilities[c.key] === true);
}

// ── Shared components ────────────────────────────────────────────────────────

function Badge({ label, colour }: { label: string; colour: string }) {
  return (
    <span
      style={{
        background: `${colour}20`,
        color: colour,
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 3,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ── Routing dimension bars ──────────────────────────────────────────────────

const DIMENSIONS: Array<{ key: keyof RoutingProfileData; label: string }> = [
  { key: "reasoning",                 label: "Reasoning" },
  { key: "codegen",                   label: "Code Gen" },
  { key: "toolFidelity",              label: "Tool Fidelity" },
  { key: "instructionFollowingScore", label: "Instruction Following" },
  { key: "structuredOutputScore",     label: "Structured Output" },
  { key: "conversational",            label: "Conversational" },
  { key: "contextRetention",          label: "Context Retention" },
];

const SOURCE_LABELS: Record<string, string> = {
  seed:       "Seed data",
  evaluated:  "Evaluated",
  production: "Production observations",
};

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 50) return "#fbbf24";
  return "#ef4444";
}

function DimensionBar({ label, score }: { label: string; score: number }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <div style={{ width: 130, fontSize: 11, color: "var(--dpf-muted)", flexShrink: 0 }}>{label}</div>
      <div style={{
        flex: 1,
        height: 6,
        borderRadius: 3,
        background: "var(--dpf-bg)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          borderRadius: 3,
          background: color,
          width: `${score}%`,
          transition: "width 0.3s ease",
        }} />
      </div>
      <div style={{ width: 28, fontSize: 11, fontFamily: "monospace", color, textAlign: "right", flexShrink: 0 }}>
        {score}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  title,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "4px 12px",
        background: primary ? "var(--dpf-surface-2)" : "transparent",
        border: `1px solid ${primary ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
        color: primary ? "var(--dpf-accent)" : "var(--dpf-text)",
        borderRadius: 4,
        fontSize: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}

export function ModelCard({ model, profile, isStale, profilingFailed, canWrite, hasActiveProvider, onProfile, routingProfile, endpointId, onRunEval }: Props) {
  const router = useRouter();
  const [showScores, setShowScores] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [evalMessage, setEvalMessage] = useState<string | null>(null);

  const cardStyle: React.CSSProperties = {
    background: "var(--dpf-surface-1)",
    border: "1px solid var(--dpf-border)",
    borderRadius: 6,
    padding: "12px 14px",
    opacity: isStale ? 0.7 : 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  function handleRunEval() {
    if (!endpointId) return;
    setEvalMessage(null);
    startTransition(async () => {
      try {
        const result = await triggerDimensionEval(endpointId, model.modelId) as {
          dimensions: Array<{ inconclusive: boolean; newScore: number }>;
          hasDrift: boolean;
          hasSevereDrift: boolean;
          firstError?: string | null;
        };
        const updated = result.dimensions.filter((d) => !d.inconclusive).length;
        const total = result.dimensions.length;
        if (updated === 0) {
          setEvalMessage(result.firstError
            ? `Inconclusive — ${result.firstError}`
            : "Inconclusive — all tests failed. Check provider connectivity or API key.");
        } else {
          const avg = Math.round(
            result.dimensions.filter((d) => !d.inconclusive).reduce((s, d) => s + d.newScore, 0) / updated,
          );
          const drift = result.hasSevereDrift
            ? " — severe drift detected"
            : result.hasDrift
            ? " — drift detected"
            : "";
          setEvalMessage(`${updated}/${total} dimensions updated, avg score ${avg}${drift}`);
        }
        router.refresh();
      } catch (err) {
        setEvalMessage(err instanceof Error ? err.message : "Failed to run evaluation.");
      }
    });
  }

  // ── Profiled ──────────────────────────────────────────────────────────────
  if (profile !== null) {
    const caps = profile.capabilities as Record<string, unknown> | undefined;
    const pricingData = profile.pricing as Record<string, unknown> | undefined;
    const classLabel = profile.modelClass ?? "chat";
    const classColour = modelClassColour(classLabel);
    const pricingStr = formatPricing(pricingData);
    const capBadges = getCapabilityBadges(caps);
    const confidenceColour = CONFIDENCE_COLOURS[profile.metadataConfidence ?? "low"] ?? "#f87171";
    const hasRouting = routingProfile != null;
    const sourceLabel = hasRouting ? (SOURCE_LABELS[routingProfile.profileSource] ?? routingProfile.profileSource) : null;
    const isRetired = hasRouting && routingProfile.modelStatus === "retired";

    return (
      <div style={cardStyle}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--dpf-text)", fontSize: 12, fontWeight: 600, lineHeight: 1.3, wordBreak: "break-all" }}>
              {profile.friendlyName}
            </div>
            <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginTop: 2, wordBreak: "break-all" }}>
              {model.modelId}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {/* Metadata confidence dot */}
            <span
              title={`Metadata confidence: ${profile.metadataConfidence ?? "low"}`}
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: confidenceColour,
                flexShrink: 0,
              }}
            />
            {isStale && (
              <span style={{ color: "#fbbf24", fontSize: 10, whiteSpace: "nowrap" }}>
                Last seen: {model.lastSeenAt.toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Model class + pricing row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          <Badge label={classLabel} colour={classColour} />
          <span style={{ color: "var(--dpf-muted)", fontSize: 10 }}>
            {pricingStr ?? "Pricing unknown"}
          </span>
        </div>

        {/* Context window */}
        {profile.maxInputTokens != null && (
          <div style={{ color: "var(--dpf-muted)", fontSize: 10 }}>
            Context: {formatTokenCount(profile.maxInputTokens)}
          </div>
        )}

        {/* Capability badges */}
        {capBadges.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {capBadges.map((b) => (
              <Badge key={b.key} label={b.label} colour="var(--dpf-muted)" />
            ))}
          </div>
        )}

        {/* EP-INF-006: Collapsible routing scores section */}
        {hasRouting && (
          <div style={{ marginTop: 4 }}>
            <button
              onClick={() => setShowScores(!showScores)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--dpf-muted)",
                fontSize: 10,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {showScores ? "Routing Scores \u25BE" : "Routing Scores \u25B8"}
            </button>

            {showScores && (
              <div style={{ marginTop: 8 }}>
                {/* Dimension bars */}
                {DIMENSIONS.map((d) => (
                  <DimensionBar
                    key={d.key}
                    label={d.label}
                    score={routingProfile[d.key] as number}
                  />
                ))}

                {/* Meta row */}
                <div style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  paddingTop: 8,
                  borderTop: "1px solid var(--dpf-border)",
                  fontSize: 10,
                  color: "var(--dpf-muted)",
                  marginTop: 4,
                }}>
                  <span>Source: {sourceLabel}</span>
                  <span>Evals: {routingProfile.evalCount}</span>
                  {routingProfile.lastEvalAt && (
                    <span>Last eval: {new Date(routingProfile.lastEvalAt).toLocaleDateString()}</span>
                  )}
                </div>

                {/* Run Eval button */}
                {endpointId && !isRetired && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={handleRunEval}
                      disabled={isPending}
                      style={{
                        padding: "3px 10px",
                        fontSize: 11,
                        borderRadius: 4,
                        border: "1px solid #7c8cf8",
                        background: isPending ? "#2a2a40" : "rgba(124,140,248,0.12)",
                        color: isPending ? "#8888a0" : "#7c8cf8",
                        cursor: isPending ? "not-allowed" : "pointer",
                      }}
                    >
                      {isPending ? "Running..." : "Run Eval"}
                    </button>
                  </div>
                )}

                {/* Eval feedback message */}
                {evalMessage && (
                  <div style={{
                    marginTop: 6,
                    fontSize: 10,
                    color: evalMessage.startsWith("Failed") || evalMessage.startsWith("Inconclusive")
                      ? "#ef4444" : "#4ade80",
                    padding: "4px 8px",
                    background: "var(--dpf-bg)",
                    borderRadius: 4,
                  }}>
                    {evalMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Metadata sync happens automatically during discovery — no manual button needed */}
      </div>
    );
  }

  // ── Failed ────────────────────────────────────────────────────────────────
  if (profilingFailed) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--dpf-text)", fontSize: 11, fontFamily: "monospace", wordBreak: "break-all" }}>
              {model.modelId}
            </div>
            <div style={{ color: "#f87171", fontSize: 10, marginTop: 4 }}>
              Profiling failed
            </div>
          </div>
          {isStale && (
            <span style={{ color: "#fbbf24", fontSize: 10, flexShrink: 0, whiteSpace: "nowrap" }}>
              Last seen: {model.lastSeenAt.toLocaleDateString()}
            </span>
          )}
        </div>

        {canWrite && (
          <div>
            <ActionButton
              label="Retry"
              onClick={() => onProfile(model.modelId)}
              disabled={!hasActiveProvider}
              title="Retry metadata extraction from provider API"
              {...(!hasActiveProvider && { title: "No active provider" })}
              primary
            />
          </div>
        )}
      </div>
    );
  }

  // ── Unprofiled ──────────────────────────────────────────────────────────────
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--dpf-text)", fontSize: 11, fontFamily: "monospace", wordBreak: "break-all" }}>
            {model.modelId}
          </div>
          <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginTop: 4 }}>
            Awaiting discovery
          </div>
        </div>
        {isStale && (
          <span style={{ color: "#fbbf24", fontSize: 10, flexShrink: 0, whiteSpace: "nowrap" }}>
            Last seen: {model.lastSeenAt.toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
