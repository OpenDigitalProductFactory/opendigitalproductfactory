// apps/web/components/build/ReviewReadinessStrip.tsx
//
// Review-phase readiness strip: a compact grid of state-coded "lens" chips,
// each backed by real persisted evidence on the build (checklist review,
// architecture advisory, code review, UX checks, verification, acceptance).
//
// This is the honest realization of spec §6.2. The original sketch drew a
// roster of named reviewer agents ([EA Architect ✓] [Security ✓] …), but that
// per-reviewer identity is NOT persisted — the build review system merges its
// reviewers into a single ReviewResult. So the strip shows review *lenses*
// derived from stored fields (see lib/build/review-lenses.ts), never invented
// reviewer names.
//
// State is conveyed by colour AND glyph AND text (WCAG 1.4.1), and each chip
// carries an aria-label summarizing its lens + state + detail.
"use client";

import type { CSSProperties } from "react";
import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import {
  deriveReviewLenses,
  type ReviewLens,
  type ReviewLensState,
} from "@/lib/build/review-lenses";

type Props = {
  build: FeatureBuildRow;
  phase: BuildPhase;
};

const STATE_CONFIG: Record<ReviewLensState, { colorVar: string; glyph: string; word: string }> = {
  pass:     { colorVar: "var(--dpf-success)", glyph: "✓", word: "pass" },      // ✓
  fail:     { colorVar: "var(--dpf-error)",   glyph: "✗", word: "fail" },      // ✗
  advisory: { colorVar: "var(--dpf-info)",    glyph: "ⓘ", word: "advisory" },  // ⓘ
  partial:  { colorVar: "var(--dpf-warning)", glyph: "◐", word: "partial" },   // ◐
  pending:  { colorVar: "var(--dpf-muted)",   glyph: "○", word: "pending" },   // ○
};

export function ReviewReadinessStrip({ build, phase }: Props) {
  if (phase !== "review") return null;
  const lenses = deriveReviewLenses(build);
  if (lenses.length === 0) return null;

  const cleared = lenses.filter((l) => l.state === "pass").length;
  const blocking = lenses.filter((l) => l.state === "fail").length;

  return (
    <div style={{ marginBottom: 16 }} data-testid="review-readiness-strip">
      <div style={sectionLabelStyle}>
        Review Readiness
        <span style={{ color: "var(--dpf-muted)", fontWeight: 600, marginLeft: 6 }}>
          {cleared}/{lenses.length} cleared
          {blocking > 0 ? ` · ${blocking} blocking` : ""}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {lenses.map((lens) => (
          <LensChip key={lens.key} lens={lens} />
        ))}
      </div>
    </div>
  );
}

function LensChip({ lens }: { lens: ReviewLens }) {
  const cfg = STATE_CONFIG[lens.state];
  return (
    <div
      data-testid="review-lens"
      data-lens-key={lens.key}
      data-state={lens.state}
      aria-label={`${lens.label}: ${cfg.word}${lens.detail ? ` — ${lens.detail}` : ""}`}
      style={{
        flex: "1 1 144px",
        minWidth: 144,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "6px 8px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${cfg.colorVar} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${cfg.colorVar} 30%, transparent)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span aria-hidden="true" style={{ color: cfg.colorVar, fontSize: 11, lineHeight: 1 }}>
          {cfg.glyph}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)" }}>
          {lens.label}
        </span>
      </div>
      {lens.detail && (
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", paddingLeft: 16 }}>
          {lens.detail}
        </span>
      )}
    </div>
  );
}

const sectionLabelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0,
  color: "var(--dpf-muted)",
  marginBottom: 6,
};
