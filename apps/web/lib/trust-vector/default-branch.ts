// Shared "is this the tree everyone builds against?" vocabulary for trust
// adapters (BI-6CFC5429, BI-86EF5900).
//
// Extracted from adapters/code-graph.ts so the committed-source adapter scores
// an off-default branch the SAME way the code graph does. Two copies of this
// rule would be a second home for one contract — the single-source-of-truth
// failure the rulebook exists to prevent — and would drift the moment one
// adapter learned about a new default branch name and the other did not.

/**
 * Branch names that mean "the tree everyone builds against". Anything else is a
 * side branch: it may be perfectly current, but it is not what the default
 * branch says, so a reader cannot claim unqualified freshness from it.
 */
export const DEFAULT_BRANCH_NAMES = new Set(["main", "master", "HEAD"]);

/** Recency alone cannot score above this when the source is a side branch. */
export const OFF_DEFAULT_BRANCH_FRESHNESS_CAP = 0.4;

/** True when `branch` is a non-empty name that is not a default-branch name. */
export function isOffDefaultBranch(branch: string | null | undefined): boolean {
  if (typeof branch !== "string") return false;
  const trimmed = branch.trim();
  if (trimmed.length === 0) return false;
  return !DEFAULT_BRANCH_NAMES.has(trimmed);
}
