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

const CAPABILITY_COLOURS: Record<string, string> = {
  "deep-thinker": "#7c8cf8",
  "fast-worker":  "#4ade80",
  "specialist":   "#38bdf8",
  "budget":       "#fbbf24",
  "embedding":    "#a78bfa",
};

const COST_COLOURS: Record<string, string> = {
  "$":    "#4ade80",
  "$$":   "#38bdf8",
  "$$$":  "#fbbf24",
  "$$$$": "#f87171",
};

function capabilityColour(tier: string): string {
  return CAPABILITY_COLOURS[tier] ?? "#8888a0";
}

function costColour(tier: string): string {
  return COST_COLOURS[tier] ?? "#8888a0";
}

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
    const cColour = costColour(profile.costTier);
    const capColour = capabilityColour(profile.capabilityTier);

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
          {isStale && (
            <span style={{ color: "#fbbf24", fontSize: 10, flexShrink: 0, whiteSpace: "nowrap" }}>
              Last seen: {model.lastSeenAt.toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Cost / capability badges */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <Badge label={`Cost: ${profile.costTier}`}             colour={cColour} />
          <Badge label={`Capability: ${profile.capabilityTier}`} colour={capColour} />
        </div>

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

  // ── Unprofiled ────────────────────────────────────────────────────────────
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
