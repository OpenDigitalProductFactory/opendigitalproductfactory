"use client";

import { LocalTime } from "@/components/ui/LocalTime";
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
        className="border border-[var(--dpf-border)]"
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: color,
        }}
      />
      <div>
        <div className="text-[var(--dpf-text)]" style={{ fontWeight: 600 }}>{label}</div>
        <div className="text-[var(--dpf-muted)]" style={{ fontFamily: "monospace" }}>{color}</div>
      </div>
    </div>
  );
}

export function BrandPreview({ system, onApply, applying = false, applyError = null, appliedAt = null }: Props) {
  const confidence = system.confidence.overall;

  return (
    <div
      className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: 20,
        borderRadius: 8,
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 className="text-[var(--dpf-text)]" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            Extracted design system
          </h2>
          <ConfidenceBadge value={confidence} />
        </div>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 12, margin: "4px 0 0 0" }}>
          Extracted <LocalTime value={system.extractedAt} /> from {system.sources.length}{" "}
          source{system.sources.length === 1 ? "" : "s"}.
        </p>
        {system.gaps.length > 0 && (
          <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginTop: 8 }}>
            Gaps synthesized by AI: {system.gaps.slice(0, 3).join(", ")}
            {system.gaps.length > 3 ? ` (+${system.gaps.length - 3} more)` : ""}
          </div>
        )}
      </div>

      <section>
        <h3 className="text-[var(--dpf-muted)]" style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px 0" }}>
          Identity
        </h3>
        <div className="text-[var(--dpf-text)]" style={{ fontSize: 14 }}>
          <div><strong>{system.identity.name || "(no name extracted)"}</strong></div>
          {system.identity.tagline && (
            <div className="text-[var(--dpf-muted)]" style={{ fontStyle: "italic" }}>{system.identity.tagline}</div>
          )}
          {system.identity.description && (
            <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, marginTop: 8, maxWidth: 600 }}>
              {system.identity.description.slice(0, 240)}
              {system.identity.description.length > 240 ? "…" : ""}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-[var(--dpf-muted)]" style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px 0" }}>
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
        <h3 className="text-[var(--dpf-muted)]" style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px 0" }}>
          Typography
        </h3>
        <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, marginBottom: 12 }}>
          Sans: <strong className="text-[var(--dpf-text)]">{system.typography.families.sans}</strong>
          {system.typography.families.display && (
            <>  •  Display: <strong className="text-[var(--dpf-text)]">{system.typography.families.display}</strong></>
          )}
          {system.typography.families.mono && (
            <>  •  Mono: <strong className="text-[var(--dpf-text)]">{system.typography.families.mono}</strong></>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {SCALE_KEYS.map((k) => {
            const entry = system.typography.scale[k];
            return (
              <div
                key={k}
                className="text-[var(--dpf-text)]"
                style={{
                  fontSize: entry.size,
                  lineHeight: entry.lineHeight,
                  fontWeight: entry.weight,
                  fontFamily: system.typography.families.sans,
                }}
              >
                <span className="text-[var(--dpf-muted)]" style={{ fontSize: 11, fontFamily: "monospace", marginRight: 12 }}>{k}</span>
                The quick brown fox
              </div>
            );
          })}
        </div>
      </section>

      {system.components.inventory.length > 0 && (
        <section>
          <h3 className="text-[var(--dpf-muted)]" style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px 0" }}>
            Components ({system.components.library})
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {system.components.inventory.map((c) => (
              <span
                key={c.name}
                className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] border border-[var(--dpf-border)]"
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 4,
                }}
              >
                {c.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {onApply && (
        <div className="border-t border-[var(--dpf-border)]" style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 16 }}>
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="bg-[var(--dpf-accent)] text-white"
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              cursor: applying ? "wait" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: applying ? 0.7 : 1,
            }}
          >
            {applying ? "Applying..." : "Approve & apply"}
          </button>
          {applyError && (
            <span className="text-[var(--dpf-error)]" style={{ fontSize: 12 }}>{applyError}</span>
          )}
          {!applyError && appliedAt && (
            <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
              Applied <LocalTime value={appliedAt} mode="time" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
