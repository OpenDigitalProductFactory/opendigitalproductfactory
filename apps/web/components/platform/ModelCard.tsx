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

const TIER_COLOURS: Record<string, string> = {
  premium:    "#7c8cf8",
  standard:   "#4ade80",
  economy:    "#fbbf24",
  unknown:    "#555566",
};

function tierColour(tier: string): string {
  return TIER_COLOURS[tier.toLowerCase()] ?? "#555566";
}

function Badge({ label, colour }: { label: string; colour: string }) {
  return (
    <span
      style={{
        background: `${colour}20`,
        color: colour,
        fontSize: 9,
        padding: "2px 6px",
        borderRadius: 3,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function Chip({ label, variant }: { label: string; variant: "best" | "avoid" }) {
  const colour = variant === "best" ? "#4ade80" : "#f87171";
  return (
    <span
      style={{
        background: `${colour}15`,
        color: colour,
        fontSize: 9,
        padding: "2px 7px",
        borderRadius: 10,
        border: `1px solid ${colour}40`,
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
        background: primary ? "#2a2a50" : "transparent",
        border: `1px solid ${primary ? "#7c8cf8" : "#2a2a40"}`,
        color: primary ? "#7c8cf8" : "#e0e0ff",
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
    background: "#1a1a2e",
    border: "1px solid #2a2a40",
    borderRadius: 6,
    padding: "12px 14px",
    opacity: isStale ? 0.5 : 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  // ── Profiled ──────────────────────────────────────────────────────────────
  if (profile !== null) {
    const costColour  = tierColour(profile.costTier);
    const capColour   = tierColour(profile.capabilityTier);

    return (
      <div style={cardStyle}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#e0e0ff", fontSize: 12, fontWeight: 600, lineHeight: 1.3, wordBreak: "break-all" }}>
              {profile.friendlyName}
            </div>
            <div style={{ color: "#555566", fontSize: 9, marginTop: 2, wordBreak: "break-all" }}>
              {model.modelId}
            </div>
          </div>
          {isStale && (
            <span style={{ color: "#fbbf24", fontSize: 9, flexShrink: 0, whiteSpace: "nowrap" }}>
              Last seen: {model.lastSeenAt.toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Summary */}
        {profile.summary && (
          <div style={{ color: "#e0e0ff", fontSize: 10, lineHeight: 1.5, opacity: 0.8 }}>
            {profile.summary}
          </div>
        )}

        {/* Cost / speed / context badges */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <Badge label={`Cost: ${profile.costTier}`}         colour={costColour} />
          <Badge label={`Capability: ${profile.capabilityTier}`} colour={capColour} />
          {profile.speedRating   && <Badge label={`Speed: ${profile.speedRating}`}     colour="#38bdf8" />}
          {profile.contextWindow && <Badge label={`Context: ${profile.contextWindow}`} colour="#a78bfa" />}
        </div>

        {/* Best-for chips */}
        {profile.bestFor.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {profile.bestFor.map((tag) => (
              <Chip key={tag} label={tag} variant="best" />
            ))}
          </div>
        )}

        {/* Avoid-for chips */}
        {profile.avoidFor.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {profile.avoidFor.map((tag) => (
              <Chip key={tag} label={tag} variant="avoid" />
            ))}
          </div>
        )}

        {/* Re-profile button */}
        {canWrite && (
          <div>
            <ActionButton
              label="Re-profile"
              onClick={() => onProfile(model.modelId)}
              disabled={!hasActiveProvider}
              {...(!hasActiveProvider && { title: "No active provider — cannot profile" })}
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
            <div style={{ color: "#e0e0ff", fontSize: 11, fontFamily: "monospace", wordBreak: "break-all" }}>
              {model.modelId}
            </div>
            <div style={{ color: "#f87171", fontSize: 9, marginTop: 4 }}>
              Profiling failed
            </div>
          </div>
          {isStale && (
            <span style={{ color: "#fbbf24", fontSize: 9, flexShrink: 0, whiteSpace: "nowrap" }}>
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
          <div style={{ color: "#e0e0ff", fontSize: 11, fontFamily: "monospace", wordBreak: "break-all" }}>
            {model.modelId}
          </div>
          <div style={{ color: "#555566", fontSize: 9, marginTop: 4 }}>
            Not yet profiled
          </div>
        </div>
        {isStale && (
          <span style={{ color: "#fbbf24", fontSize: 9, flexShrink: 0, whiteSpace: "nowrap" }}>
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
