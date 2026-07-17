// apps/web/components/ui/ProgressBar.tsx
//
// Canonical determinate/indeterminate progress indicator. Server-usable (no
// hooks, no "use client"). Use when total work is known and you can show how
// far along it is (uploads, multi-step flows, builds). For an unknown-duration
// action use ui/Spinner; for content loading into a known layout use
// ui/Skeleton. See docs/platform-usability-standards.md.
//
// Exposes the proper `role="progressbar"` + `aria-valuenow/min/max` semantics
// that hand-rolled track+fill divs across the codebase omit. Colors resolve
// through --dpf-* tokens; the indeterminate sweep uses the `dpf-shimmer`
// keyframe (stilled under `prefers-reduced-motion: reduce`).

import type { CSSProperties } from "react";

export type ProgressBarSize = "sm" | "md";

export type ProgressBarProps = {
  /** 0–100. Omit (or set `indeterminate`) when the total isn't known. */
  value?: number;
  /** Unknown-total mode: a shimmering full-width fill instead of a fixed width. */
  indeterminate?: boolean;
  /** Accessible label for the operation (e.g. "Uploading files"). */
  label?: string;
  size?: ProgressBarSize;
  className?: string;
};

const TRACK_SIZE: Record<ProgressBarSize, string> = {
  sm: "h-1.5",
  md: "h-2.5",
};

const INDETERMINATE_FILL: CSSProperties = {
  backgroundImage:
    "linear-gradient(90deg, color-mix(in srgb, var(--dpf-accent) 30%, var(--dpf-surface-2)) 25%, var(--dpf-accent) 50%, color-mix(in srgb, var(--dpf-accent) 30%, var(--dpf-surface-2)) 75%)",
  backgroundSize: "200% 100%",
};

export function ProgressBar({
  value,
  indeterminate = false,
  label = "Progress",
  size = "md",
  className = "",
}: ProgressBarProps) {
  const clamped =
    typeof value === "number" ? Math.min(100, Math.max(0, value)) : undefined;
  const isIndeterminate = indeterminate || clamped === undefined;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isIndeterminate ? undefined : clamped}
      className={[
        "w-full overflow-hidden rounded-full",
        TRACK_SIZE[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundColor: "var(--dpf-surface-2)" }}
    >
      <div
        className={["h-full rounded-full", isIndeterminate ? "dpf-shimmer" : ""]
          .filter(Boolean)
          .join(" ")}
        style={
          isIndeterminate
            ? { ...INDETERMINATE_FILL, width: "100%" }
            : {
                width: `${clamped}%`,
                backgroundColor: "var(--dpf-accent)",
                transition: "width 240ms ease-out",
              }
        }
      />
    </div>
  );
}
