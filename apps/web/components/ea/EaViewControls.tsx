"use client";

import { useState } from "react";
import { exportEaViewDrawing } from "@/lib/actions/ea-drawing";
import type { EaDrawingFormat } from "@/lib/ea/view-drawing-export";

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

const DRAWING_EXPORTS: Array<{ format: EaDrawingFormat; label: string }> = [
  { format: "odg", label: "Draw (.odg)" },
  { format: "svg", label: "SVG (.svg)" },
  { format: "pdf", label: "PDF (.pdf)" },
  { format: "png", label: "PNG (.png)" },
];

/** Export the view as a drawing (BI-4C17BF51). Renders the saved layout on the server. */
export function EaDrawingExportMenu({ viewId }: { viewId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<EaDrawingFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: EaDrawingFormat) {
    setBusy(format);
    setError(null);
    try {
      const result = await exportEaViewDrawing({ viewId, format });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.data.base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.data.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.data.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      setError("The export did not finish. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Export the saved layout as a drawing"
        style={{
          fontSize: 10, padding: "2px 9px", borderRadius: 3, cursor: "pointer", minHeight: 24,
          background: open ? "var(--dpf-surface-2)" : "transparent",
          border: `1px solid ${open ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
          color: open ? "var(--dpf-accent)" : "var(--dpf-muted)",
        }}
      >
        {busy ? "Exporting…" : "Export ▾"}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Export view as"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20, minWidth: 160, padding: 4,
            background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 6,
            boxShadow: "var(--shadow-dpf-md)",
          }}
        >
          {DRAWING_EXPORTS.map((item) => (
            <button
              key={item.format}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => void download(item.format)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 4, border: "none",
                background: busy === item.format ? "var(--dpf-accent-soft)" : "transparent",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--dpf-text)" }}>
                {busy === item.format ? `Exporting ${item.label}…` : item.label}
              </span>
            </button>
          ))}
          {error && (
            <p role="alert" style={{ margin: "4px 8px", fontSize: 10, color: "var(--dpf-error)" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
