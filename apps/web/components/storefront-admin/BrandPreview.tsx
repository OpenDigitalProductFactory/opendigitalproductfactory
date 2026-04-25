"use client";

import type { BrandDesignSystem } from "@/lib/brand/types";

type Props = {
  system: BrandDesignSystem;
  onApply?: () => void;
  applying?: boolean;
  applyError?: string | null;
  appliedAt?: Date | null;
};

const SCALE_KEYS: Array<keyof BrandDesignSystem["typography"]["scale"]> = [
  "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl",
];

const EXTRACTED_AT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatExtractedAt(value: string) {
  return EXTRACTED_AT_FORMATTER.format(new Date(value));
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? "#10b981" : value >= 0.5 ? "#f59e0b" : "#ef4444";
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 4,
        background: `${color}22`,
        color,
        fontWeight: 600,
        marginLeft: 8,
      }}
    >
      {pct}%
    </span>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: color,
          border: "1px solid var(--dpf-border)",
        }}
      />
      <div>
        <div style={{ fontWeight: 600, color: "var(--dpf-text)" }}>{label}</div>
        <div style={{ fontFamily: "monospace", color: "var(--dpf-muted)" }}>{color}</div>
      </div>
    </div>
  );
}

export function BrandPreview({ system, onApply, applying = false, applyError = null, appliedAt = null }: Props) {
  const confidence = system.confidence.overall;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: 20,
        borderRadius: 8,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--dpf-text)" }}>
            Extracted design system
          </h2>
          <ConfidenceBadge value={confidence} />
        </div>
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "4px 0 0 0" }}>
          Extracted {formatExtractedAt(system.extractedAt)} from {system.sources.length}{" "}
          source{system.sources.length === 1 ? "" : "s"}.
        </p>
        {system.gaps.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 8 }}>
            Gaps synthesized by AI: {system.gaps.slice(0, 3).join(", ")}
            {system.gaps.length > 3 ? ` (+${system.gaps.length - 3} more)` : ""}
          </div>
        )}
      </div>

      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
          Identity
        </h3>
        <div style={{ fontSize: 14, color: "var(--dpf-text)" }}>
          <div><strong>{system.identity.name || "(no name extracted)"}</strong></div>
          {system.identity.tagline && (
            <div style={{ color: "var(--dpf-muted)", fontStyle: "italic" }}>{system.identity.tagline}</div>
          )}
          {system.identity.description && (
            <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 8, maxWidth: 600 }}>
              {system.identity.description.slice(0, 240)}
              {system.identity.description.length > 240 ? "…" : ""}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
          Palette
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          <Swatch color={system.palette.primary} label="Primary" />
          {system.palette.secondary && <Swatch color={system.palette.secondary} label="Secondary" />}
          {system.palette.accents.map((c, i) => (
            <Swatch key={`accent-${i}`} color={c} label={`Accent ${i + 1}`} />
          ))}
          <Swatch color={system.palette.semantic.success} label="Success" />
          <Swatch color={system.palette.semantic.warning} label="Warning" />
          <Swatch color={system.palette.semantic.danger} label="Danger" />
          <Swatch color={system.palette.semantic.info} label="Info" />
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
          Typography
        </h3>
        <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Sans: <strong style={{ color: "var(--dpf-text)" }}>{system.typography.families.sans}</strong>
          {system.typography.families.display && (
            <>  •  Display: <strong style={{ color: "var(--dpf-text)" }}>{system.typography.families.display}</strong></>
          )}
          {system.typography.families.mono && (
            <>  •  Mono: <strong style={{ color: "var(--dpf-text)" }}>{system.typography.families.mono}</strong></>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {SCALE_KEYS.map((k) => {
            const entry = system.typography.scale[k];
            return (
              <div
                key={k}
                style={{
                  fontSize: entry.size,
                  lineHeight: entry.lineHeight,
                  fontWeight: entry.weight,
                  fontFamily: system.typography.families.sans,
                  color: "var(--dpf-text)",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--dpf-muted)", fontFamily: "monospace", marginRight: 12 }}>{k}</span>
                The quick brown fox
              </div>
            );
          })}
        </div>
      </section>

      {system.components.inventory.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
            Components ({system.components.library})
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {system.components.inventory.map((c) => (
              <span
                key={c.name}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: "var(--dpf-surface-2)",
                  color: "var(--dpf-text)",
                  border: "1px solid var(--dpf-border)",
                }}
              >
                {c.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {onApply && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid var(--dpf-border)", paddingTop: 16 }}>
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "var(--dpf-accent)",
              color: "#fff",
              cursor: applying ? "wait" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: applying ? 0.7 : 1,
            }}
          >
            {applying ? "Applying..." : "Approve & apply"}
          </button>
          {applyError && (
            <span style={{ fontSize: 12, color: "var(--dpf-error, #ef4444)" }}>{applyError}</span>
          )}
          {!applyError && appliedAt && (
            <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>
              Applied {appliedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
