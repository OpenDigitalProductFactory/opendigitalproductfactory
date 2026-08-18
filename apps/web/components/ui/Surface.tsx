// apps/web/components/ui/Surface.tsx
//
// Canonical card/panel wrapper (BI-D25ED55D, Simplify & Strengthen W5 —
// architecture pass 2026-08-16 §3.3-b). Server-usable (no hooks, no
// "use client"), pure markup.
//
// The string `border-[var(--dpf-border)] … bg-[var(--dpf-surface-1)]` was the
// single most-repeated markup pattern in the portal (~727 occurrences in 426
// files) with drifting radius/padding per page. This component encodes the
// variants those sites actually use — padding density, corner radius, and the
// surface elevation level — so a card is a named thing, not a re-typed string.
// The ratchet (scripts/check-ux-primitive-adoption.mjs) freezes the residual
// inline card strings outside components/ui.
//
// Spec: docs/superpowers/specs/2026-08-16-ux-foundation-button-surface-design.md

import type { ComponentPropsWithoutRef } from "react";

/** Elevation: 1 = card on the page bg (default); 2 = nested panel on a card. */
export type SurfaceLevel = 1 | 2;
export type SurfacePadding = "none" | "sm" | "md" | "lg";
export type SurfaceRounded = "md" | "lg" | "xl";
/** Semantic elements a card commonly renders as. */
export type SurfaceElement = "div" | "section" | "article" | "aside" | "li";

export type SurfaceProps = ComponentPropsWithoutRef<"div"> & {
  /** Rendered element — "div" by default; use "section"/"article"/"li" for semantics. */
  as?: SurfaceElement;
  level?: SurfaceLevel;
  padding?: SurfacePadding;
  rounded?: SurfaceRounded;
};

const LEVEL_CLASS: Record<SurfaceLevel, string> = {
  1: "border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]",
  2: "border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]",
};

// p-3 / p-4 / p-6 are the padding densities the 727 inline sites actually use
// (measured 2026-08-16); "none" serves table/list wrappers that pad per row.
const PADDING_CLASS: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

const ROUNDED_CLASS: Record<SurfaceRounded, string> = {
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
};

/**
 * Render a themed card/panel surface. Defaults match the dominant inline
 * pattern (`rounded-lg border … bg-surface-1 p-4`) so most migrations are a
 * 1:1 swap: `<div className="rounded-lg border …">` → `<Surface>`.
 */
export function Surface({
  as = "div",
  level = 1,
  padding = "md",
  rounded = "lg",
  className = "",
  ...rest
}: SurfaceProps) {
  // The prop contract is div-shaped for every allowed element; TS can't unify
  // per-element JSX handler types across the union, so render through a
  // div-typed alias while emitting the real tag.
  const Tag = as as "div";
  return (
    <Tag
      className={[LEVEL_CLASS[level], ROUNDED_CLASS[rounded], PADDING_CLASS[padding], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
