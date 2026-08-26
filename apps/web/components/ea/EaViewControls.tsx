"use client";

export type PresentationMode = "diagram" | "table";
export type EdgeVariant = "straight" | "bezier" | "step";

const EDGE_VARIANT_LABELS: Record<EdgeVariant, string> = {
  straight: "━ Straight",
  bezier: "⌒ Curved",
  step: "⌐ Angled",
};

export function PresentationToggle({ value, onChange }: {
  value: PresentationMode;
  onChange: (mode: PresentationMode) => void;
}) {
  return (
    <div aria-label="Process presentation" role="group" style={{ display: "flex", gap: 2, padding: 2, borderRadius: 5, border: "1px solid var(--dpf-border)" }}>
      {(["diagram", "table"] as PresentationMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          style={{
            minHeight: 28,
            padding: "3px 9px",
            border: "none",
            borderRadius: 3,
            cursor: "pointer",
            background: value === mode ? "var(--dpf-accent-subtle)" : "transparent",
            color: value === mode ? "var(--dpf-accent)" : "var(--dpf-muted)",
            fontSize: 11,
            fontWeight: value === mode ? 600 : 400,
          }}
        >
          {mode === "diagram" ? "Diagram" : "Table"}
        </button>
      ))}
    </div>
  );
}

export function EdgeVariantToggle({ value, onChange }: {
  value: EdgeVariant;
  onChange: (variant: EdgeVariant) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {(Object.keys(EDGE_VARIANT_LABELS) as EdgeVariant[]).map((variant) => (
        <button
          key={variant}
          onClick={() => onChange(variant)}
          title={variant.charAt(0).toUpperCase() + variant.slice(1)}
          style={{
            fontSize: 10,
            padding: "2px 7px",
            borderRadius: 3,
            cursor: "pointer",
            background: value === variant ? "var(--dpf-surface-2)" : "transparent",
            border: `1px solid ${value === variant ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
            color: value === variant ? "var(--dpf-accent)" : "var(--dpf-muted)",
          }}
        >
          {EDGE_VARIANT_LABELS[variant]}
        </button>
      ))}
    </div>
  );
}
