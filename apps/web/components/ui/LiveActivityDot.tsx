// The shared "this is happening right now" indicator.
//
// Distinct from Spinner, Skeleton, ProgressBar and InlineBusy, which all mean
// "waiting for something to finish". This one means the opposite: the system has
// fresh evidence that work is actively progressing. It carries no loading
// semantics, and it is never shown speculatively — a caller must have decided,
// from source evidence, that execution is live (BI-BBA388A1 keeps hand-rolled
// pulses out of feature code; this is the canonical home for this one).
//
// The label is required, not optional: colour and motion never carry meaning
// alone. The pulse is stilled under `prefers-reduced-motion: reduce`.

export function LiveActivityDot({
  label,
  glyph = "●",
  className = "",
  live = true,
}: {
  /** Accessible name for the state, e.g. "Working now". Required. */
  label: string;
  glyph?: string;
  className?: string;
  /** When false, the same glyph renders without motion. */
  live?: boolean;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-live={live ? "true" : "false"}
      className={`inline-block shrink-0 ${live ? "animate-pulse motion-reduce:animate-none" : ""} ${className}`}
    >
      {glyph}
    </span>
  );
}
