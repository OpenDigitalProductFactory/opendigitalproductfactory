// BI-4DD2F087 — render an obligation's stated retention minimum for an operator.
//
// WHY THIS IS ITS OWN MODULE
// The retention sweep already DERIVES floors from these two columns
// (apps/web/lib/operate/retention/obligation-floors.ts). Without this, the
// derivation is correct and invisible: an operator can see that a table is kept
// for seven years but not which regulator requires it. The formatting lives
// apart from the page so the wording is testable and stays terse — the route's
// UX-fit manifest measures text mass, and an explanatory sentence here would
// regress it.
//
// WORDING RULES
// A regulator states a duration in years ("seven years"), not in days, so a
// whole number of years is rendered as years. Anything else keeps days, because
// rounding 400 days to "1.1 years" would misstate a legal minimum.

/** audit | chat | telemetry, or empty meaning the minimum binds every category. */
export type RetentionMinimumInput = {
  retentionMinimumDays: number | null | undefined;
  retentionFloorBuckets: readonly string[] | null | undefined;
};

const DAYS_PER_YEAR = 365;

/**
 * The duration alone. Returns null when the obligation states no minimum, which
 * is true of every obligation whose duration exists only in its prose.
 */
export function formatRetentionDuration(days: number | null | undefined): string | null {
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return null;
  if (days % DAYS_PER_YEAR === 0) {
    const years = days / DAYS_PER_YEAR;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return days === 1 ? "1 day" : `${days.toLocaleString("en-US")} days`;
}

/**
 * The categories the minimum binds. An obligation that names none binds them
 * all — the same reading foldObligationFloors applies, so the screen cannot
 * describe a narrower rule than the sweep enforces.
 */
export function formatRetentionBuckets(buckets: readonly string[] | null | undefined): string {
  const named = (buckets ?? []).filter((b) => typeof b === "string" && b.length > 0);
  return named.length > 0 ? named.join(", ") : "all categories";
}

/**
 * One line for the metadata tile: duration and what it binds. Null when there
 * is no minimum, so the tile is omitted rather than showing an empty value.
 */
export function formatRetentionMinimum(obligation: RetentionMinimumInput): string | null {
  const duration = formatRetentionDuration(obligation.retentionMinimumDays);
  if (!duration) return null;
  return `${duration} · ${formatRetentionBuckets(obligation.retentionFloorBuckets)}`;
}
