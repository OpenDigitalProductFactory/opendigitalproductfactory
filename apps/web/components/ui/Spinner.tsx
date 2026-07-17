// apps/web/components/ui/Spinner.tsx
//
// Canonical indeterminate activity indicator. Server-usable (no hooks, no
// "use client") so it can appear inside server- or client-rendered surfaces.
//
// Use for an operator-triggered action of unknown/short duration, or a section
// whose layout isn't known yet. When async data fills a KNOWN layout, prefer
// ui/Skeleton instead. Never hand-roll `animate-spin`. See
// docs/platform-usability-standards.md ("Async Activity & Loading States").
//
// Colors resolve through --dpf-* tokens; motion via the `dpf-spin` keyframe in
// globals.css, which is stilled under `prefers-reduced-motion: reduce`.

import type { CSSProperties } from "react";

export type SpinnerSize = "xs" | "sm" | "md" | "lg";

export type SpinnerProps = {
  size?: SpinnerSize;
  /** Accessible label announced by screen readers. Ignored when `presentational`. */
  label?: string;
  /**
   * When true, the spinner is purely decorative: no `role="status"`, no label —
   * for use inside a region that already owns the announcement (e.g. a button
   * with `aria-busy`, or ui/InlineBusy). Defaults to a standalone, announced spinner.
   */
  presentational?: boolean;
  className?: string;
};

const SIZE_CLASS: Record<SpinnerSize, string> = {
  xs: "h-3 w-3 border-2",
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-[3px]",
};

// Track = subtle border; the leading edge picks up the accent so the ring reads
// as spinning. Both are tokens — never raw hex (AGENTS.md §12).
const RING_STYLE: CSSProperties = {
  borderColor: "var(--dpf-border)",
  borderTopColor: "var(--dpf-accent)",
};

export function Spinner({
  size = "sm",
  label = "Loading…",
  presentational = false,
  className = "",
}: SpinnerProps) {
  const ring = (
    <span
      aria-hidden="true"
      className={["dpf-spin inline-block shrink-0 rounded-full", SIZE_CLASS[size], className]
        .filter(Boolean)
        .join(" ")}
      style={RING_STYLE}
    />
  );

  if (presentational) return ring;

  return (
    <span role="status" aria-live="polite" className="inline-flex items-center">
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}
