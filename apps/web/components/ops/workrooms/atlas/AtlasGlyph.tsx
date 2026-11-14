// Work Atlas glyph (BI-3791FDD8, design §3.3): one 14px mark per room. Every
// state has its own shape as well as its colour, so no two states differ by
// colour alone (WCAG 1.4.1). Grey is the baseline; only states an operator
// should look at carry a colour.

import type { CSSProperties } from "react";

import type { AtlasHealth } from "@/lib/work-management/atlas-health";
import { intentStyle, resolveIntent } from "@/lib/ui-model/statusColors";

const HATCH = "repeating-linear-gradient(135deg, var(--dpf-muted) 0 1.5px, transparent 1.5px 4px)";

function glyphStyle(health: AtlasHealth): CSSProperties {
  const colour = intentStyle(resolveIntent("atlasHealth", health)).fg;
  switch (health) {
    case "needs-person":
      // A diamond: a rotated square in the need colour.
      return { background: colour, transform: "rotate(45deg) scale(0.78)", borderRadius: 1 };
    case "stuck":
      // A red square crossed by a bar (drawn by the child span).
      return { background: colour, borderRadius: 2 };
    case "no-signal":
      return { background: HATCH, border: "1px solid var(--dpf-muted)", borderRadius: 2 };
    case "working":
      return { background: "var(--dpf-muted)", borderRadius: 2 };
    case "waiting":
      return { background: "var(--dpf-border)", borderRadius: 2 };
    case "finished":
      return { background: "transparent", border: "1px dashed var(--dpf-border)", borderRadius: 2 };
  }
}

/** The mark alone. Its meaning is carried by the label of the element that contains it. */
export function AtlasGlyph({ health, className = "" }: { health: AtlasHealth; className?: string }) {
  return (
    <span aria-hidden data-atlas-health={health}
      className={`relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center ${className}`}
      style={glyphStyle(health)}>
      {health === "stuck" ? <span className="block h-0.5 w-2 rounded-full bg-[var(--dpf-surface-1)]" /> : null}
    </span>
  );
}
