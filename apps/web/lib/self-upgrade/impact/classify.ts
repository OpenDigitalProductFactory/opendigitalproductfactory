// apps/web/lib/self-upgrade/impact/classify.ts
//
// Pure aggregation over ParsedCommit[] — counts that feed the headline and
// the deterministic ordering rule for the foldable "all items" view.

import type { ImpactCategoryCounts, ParsedCommit } from "./types";

export function countCategories(commits: ParsedCommit[]): ImpactCategoryCounts {
  const counts: ImpactCategoryCounts = {
    breaking: 0,
    feature: 0,
    fix: 0,
    performance: 0,
    other: 0,
    total: commits.length,
  };
  for (const c of commits) {
    counts[c.category] += 1;
  }
  return counts;
}

const CATEGORY_RANK: Record<ParsedCommit["category"], number> = {
  breaking: 0,
  feature: 1,
  performance: 2,
  fix: 3,
  other: 4,
};

/**
 * Ordering for the full foldable list: breaking → feature → perf → fix → other,
 * stable within bucket by author date descending (newest first).
 */
export function orderForFullList(commits: ParsedCommit[]): ParsedCommit[] {
  return [...commits].sort((a, b) => {
    const rankDiff = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
    if (rankDiff !== 0) return rankDiff;
    // Within bucket, newer first.
    return b.authorDate.localeCompare(a.authorDate);
  });
}
