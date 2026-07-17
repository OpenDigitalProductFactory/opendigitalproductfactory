// apps/web/components/ui/Skeleton.tsx
//
// Canonical shape-of-content placeholder. Server-usable (no hooks, no
// "use client"). Use while async data fills a KNOWN layout (panels, cards,
// lists, tables) — skeletons give the best perceived performance for content
// with a predictable shape. For a triggered action of unknown shape/duration,
// prefer ui/Spinner instead. Never combine a skeleton with a spinner, and never
// hand-roll `animate-pulse`. See docs/platform-usability-standards.md.
//
// The shimmer gradient + motion resolve through --dpf-* tokens and the
// `dpf-shimmer` keyframe in globals.css, which freezes to a flat muted fill
// under `prefers-reduced-motion: reduce`.
//
// A skeleton is decorative: the wrapping region should own the live
// announcement (set `aria-busy="true"` on it). Every skeleton element is
// `aria-hidden` so screen readers don't read placeholder noise.

import type { CSSProperties } from "react";

export type SkeletonProps = {
  /** CSS width (e.g. "100%", "8rem", 120). Defaults to full width. */
  width?: string | number;
  /** CSS height (e.g. "1rem", 12). Defaults to a text-line height. */
  height?: string | number;
  /** Fully rounded (pill/circle). Overrides the default small radius. */
  circle?: boolean;
  rounded?: boolean;
  className?: string;
};

// A token-tinted gradient the `dpf-shimmer` keyframe sweeps across.
const SHIMMER_STYLE: CSSProperties = {
  backgroundImage:
    "linear-gradient(90deg, var(--dpf-surface-2) 25%, var(--dpf-surface-3) 37%, var(--dpf-surface-2) 63%)",
  backgroundSize: "200% 100%",
};

function dim(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

export function Skeleton({
  width,
  height,
  circle = false,
  rounded = true,
  className = "",
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={[
        "dpf-shimmer block",
        circle ? "rounded-full" : rounded ? "rounded" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...SHIMMER_STYLE,
        width: dim(width) ?? "100%",
        height: dim(height) ?? "0.85rem",
      }}
    />
  );
}

export type SkeletonTextProps = {
  /** Number of shimmer lines to render. */
  lines?: number;
  /** Width of the final line (shorter reads as a paragraph tail). */
  lastLineWidth?: string;
  className?: string;
};

/** A stack of shimmer lines approximating a block of text. */
export function SkeletonText({
  lines = 3,
  lastLineWidth = "60%",
  className = "",
}: SkeletonTextProps) {
  return (
    <span
      aria-hidden="true"
      className={["flex flex-col gap-2", className].filter(Boolean).join(" ")}
    >
      {Array.from({ length: Math.max(1, lines) }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 && lines > 1 ? lastLineWidth : "100%"}
        />
      ))}
    </span>
  );
}
