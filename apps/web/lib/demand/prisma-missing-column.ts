/**
 * Detect Prisma "column does not exist" errors so loaders can degrade
 * instead of crashing the RSC page when the install is behind migrations
 * (BI-PIR-1d2d84a3 — /ops/demand after estimate provenance columns ship).
 */
export function isPrismaMissingColumnError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /does not exist in the current database/i.test(msg) ||
    /column [`"]?[\w.]+[`"]? does not exist/i.test(msg) ||
    /The column `.+` does not exist/i.test(msg)
  );
}
