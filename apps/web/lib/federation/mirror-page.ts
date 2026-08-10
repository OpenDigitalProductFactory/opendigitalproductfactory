// BI-72C3FBA2 — cursor paging for federated mirror lookups.
//
// Silent `take: 1_000` without a cursor drops every row past the first batch.
// Prefer page-until-match (or page-all with a bounded page size) so large links
// stay correct. demand-digest already uses this pattern inline; these helpers
// keep response/disposition correlation on the same contract.

/** Default page size for mirror inventory scans (not a silent total cap). */
export const DEFAULT_MIRROR_PAGE_SIZE = 100;

export type MirrorFindMany<T> = (args: Record<string, unknown>) => Promise<T[]>;

/**
 * Walk a mirror inventory in ordered pages until `match` hits or the set ends.
 * Never silently stops at a fixed total row budget.
 */
export async function findFirstMirrorAcrossPages<T extends { mirrorId?: string | null }>(
  findMany: MirrorFindMany<T>,
  base: {
    where: unknown;
    select?: unknown;
    orderBy?: unknown;
  },
  match: (row: T) => boolean,
  options?: { pageSize?: number },
): Promise<T | null> {
  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_MIRROR_PAGE_SIZE);
  let cursorId: string | undefined;
  for (;;) {
    const rows = await findMany({
      where: base.where,
      ...(base.select ? { select: base.select } : {}),
      orderBy: base.orderBy ?? { mirrorId: "asc" },
      take: pageSize,
      ...(cursorId ? { cursor: { mirrorId: cursorId }, skip: 1 } : {}),
    });
    if (rows.length === 0) return null;
    for (const row of rows) {
      if (match(row)) return row;
    }
    if (rows.length < pageSize) return null;
    const lastId = rows[rows.length - 1]?.mirrorId;
    if (!lastId) return null;
    cursorId = lastId;
  }
}
