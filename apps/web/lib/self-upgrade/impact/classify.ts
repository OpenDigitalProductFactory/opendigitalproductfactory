// apps/web/lib/self-upgrade/impact/classify.ts
//
// Pure aggregation over ParsedCommit[] — counts that feed the headline and
// the deterministic ordering rule for the foldable "all items" view.

import type { ChangeCategory, ImpactCategoryCounts, ParsedCommit } from "./types";

export function countCategories(commits: ParsedCommit[]): ImpactCategoryCounts {
  const counts: ImpactCategoryCounts = {
    breaking: 0,
    security: 0,
    feature: 0,
    fix: 0,
    performance: 0,
    dependency: 0,
    documentation: 0,
    maintenance: 0,
    other: 0,
    total: commits.length,
  };
  for (const c of commits) {
    counts[c.category] += 1;
  }
  return counts;
}

/**
 * Canonical severity ordering for every category — the single source of truth
 * for "which bucket outranks which", shared by the foldable list here and the
 * scored ordering in ./score. Risk first (breaking, then security), then the
 * changes an operator asked for, then the upkeep they did not.
 */
export const CATEGORY_RANK: Record<ChangeCategory, number> = {
  breaking: 0,
  security: 1,
  feature: 2,
  performance: 3,
  fix: 4,
  dependency: 5,
  documentation: 6,
  maintenance: 7,
  other: 8,
};

/**
 * Ordering for the full foldable list: by CATEGORY_RANK, stable within bucket
 * by author date descending (newest first).
 */
export function orderForFullList(commits: ParsedCommit[]): ParsedCommit[] {
  return [...commits].sort((a, b) => {
    const rankDiff = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
    if (rankDiff !== 0) return rankDiff;
    // Within bucket, newer first.
    return b.authorDate.localeCompare(a.authorDate);
  });
}
