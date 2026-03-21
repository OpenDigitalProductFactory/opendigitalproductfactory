"use client";

import type { DiscoveredModelRow, ModelProfileRow } from "@/lib/ai-provider-types";

type Props = {
  model: DiscoveredModelRow;
  profile: ModelProfileRow | null;
  isStale: boolean;
  profilingFailed: boolean;
  canWrite: boolean;
  hasActiveProvider: boolean;
  onProfile: (modelId: string) => void;
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

export function ModelCard({ model, profile, isStale, profilingFailed, canWrite, hasActiveProvider, onProfile }: Props) {
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

  // ── Profiled ──────────────────────────────────────────────────────────────
  if (profile !== null) {
    const caps = profile.capabilities as Record<string, unknown> | undefined;
    const pricingData = profile.pricing as Record<string, unknown> | undefined;
    const classLabel = profile.modelClass ?? "chat";
    const classColour = modelClassColour(classLabel);
    const pricingStr = formatPricing(pricingData);
    const capBadges = getCapabilityBadges(caps);
    const confidenceColour = CONFIDENCE_COLOURS[profile.metadataConfidence ?? "low"] ?? "#f87171";

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

        {/* Re-sync button */}
        {canWrite && (
          <div>
            <ActionButton
              label="Re-sync"
              onClick={() => onProfile(model.modelId)}
              disabled={!hasActiveProvider}
              {...(!hasActiveProvider && { title: "No active provider — cannot sync" })}
            />
          </div>
        )}
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
              label="Re-profile"
              onClick={() => onProfile(model.modelId)}
              disabled={!hasActiveProvider}
              {...(!hasActiveProvider && { title: "No active provider — cannot profile" })}
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
            Not yet profiled
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
            label="Profile Now"
            onClick={() => onProfile(model.modelId)}
            disabled={!hasActiveProvider}
            {...(!hasActiveProvider && { title: "No active provider — cannot profile" })}
            primary
          />
        </div>
      )}
    </div>
  );
}
