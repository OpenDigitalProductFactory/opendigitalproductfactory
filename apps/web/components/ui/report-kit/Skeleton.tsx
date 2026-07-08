// apps/web/components/ui/report-kit/Skeleton.tsx
//
// Canonical loading placeholder for the reporting palette. Generalizes the 20+
// raw `animate-pulse` blocks across the portal into one token-backed primitive
// so loading shimmer is consistent (and the raw-utility ratchet has an escape
// hatch that lives in exactly one place). Server-usable (pure, no hooks).
//
// Color comes from `--dpf-*` tokens only — never raw hex.

import type { CSSProperties } from "react";

type Rounded = "sm" | "md" | "lg" | "full";

export interface SkeletonProps {
  /** Bar width — number (px) or any CSS length. Defaults to full width. */
  width?: string | number;
  /** Bar height — number (px) or any CSS length. Defaults to a text line. */
  height?: string | number;
  /** Corner rounding. Defaults to `md`. */
  rounded?: Rounded;
  /**
   * Render N stacked line bars (with the last one shortened) instead of a
   * single block — handy for paragraph placeholders. Defaults to 1.
   */
  lines?: number;
  className?: string;
}

const ROUNDED_CLASS: Record<Rounded, string> = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

const SHIMMER = "animate-pulse bg-[var(--dpf-surface-2)]";

function len(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * A shimmering loading placeholder. One bar by default; pass `lines` for a
 * multi-line paragraph skeleton.
 */
export function Skeleton({
  width,
  height,
  rounded = "md",
  lines = 1,
  className = "",
}: SkeletonProps) {
  const roundedClass = ROUNDED_CLASS[rounded];

  if (lines > 1) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading"
        className={["flex flex-col gap-2", className].filter(Boolean).join(" ")}
      >
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className={`block h-3 ${roundedClass} ${SHIMMER}`}
            style={{ width: i === lines - 1 ? "60%" : "100%" }}
          />
        ))}
      </div>
    );
  }

  const style: CSSProperties = {
    width: len(width) ?? "100%",
    height: len(height) ?? "0.75rem",
  };

  return (
    <span
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={`block ${roundedClass} ${SHIMMER} ${className}`.trim()}
      style={style}
    />
  );
}
