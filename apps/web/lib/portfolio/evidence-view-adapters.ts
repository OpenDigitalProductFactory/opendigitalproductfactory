export type EvidenceFreshness = "fresh" | "stale" | "unknown";

const DAY_MS = 86_400_000;

export function classifyEvidenceFreshness(
  asOf: Date | null,
  requestedAt: Date,
  staleAfterDays: number,
): EvidenceFreshness {
  if (!asOf || !Number.isFinite(asOf.getTime())) return "unknown";
  return requestedAt.getTime() - asOf.getTime() > staleAfterDays * DAY_MS
    ? "stale"
    : "fresh";
}

/**
 * Stable evidence ordering shared by digital-product and business-product
 * projections. A canonical id resolves timestamp ties.
 */
export function sortNewestFirst<T>(
  items: readonly T[],
  asOf: (item: T) => Date,
  canonicalId: (item: T) => string,
): T[] {
  return [...items].sort(
    (left, right) =>
      asOf(right).getTime() - asOf(left).getTime() ||
      canonicalId(left).localeCompare(canonicalId(right)),
  );
}
