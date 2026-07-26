// scripts/lib/worktree-janitor-core.mjs
//
// Pure worktree reaping classification (BI-42FA7DD8).
//
// Tier A (safe auto-reap when DPF_WORKTREE_JANITOR_AUTO_REAP=1):
//   merged (ancestry OR squash-merged PR) + clean + no open PR + no lease + not pinned
// Tier B (observe / propose only — never auto-delete):
//   unmerged + clean + age > graceDays
//
// Side-effecting removal stays in scripts/worktree-janitor.mjs via
// junction-safe-worktree-remove.mjs.

/** @typedef {"PRUNE_TIER_A" | "PRUNE_TIER_B" | "KEEP" | "SKIP" | "PINNED"} WorktreeVerdict */

/**
 * @typedef {object} WorktreeFacts
 * @property {string} path
 * @property {string | null} branch  null when detached
 * @property {boolean} isRoot
 * @property {boolean} pinned        .worktree-pinned present
 * @property {boolean} hasActiveLease
 * @property {boolean} hasOpenPr
 * @property {boolean} merged        ancestor of origin/main OR has merged PR
 * @property {boolean} dirty         porcelain non-empty
 * @property {number} ageDays        days since last commit (0 if unknown)
 */

/**
 * Classify one worktree. Pure.
 * @param {WorktreeFacts} facts
 * @param {{ graceDays?: number }} [opts]
 * @returns {{ verdict: WorktreeVerdict, reason: string, tier: "A" | "B" | null }}
 */
export function classifyWorktree(facts, opts = {}) {
  const graceDays = opts.graceDays ?? 14;

  if (facts.isRoot) {
    return { verdict: "SKIP", reason: "root clone", tier: null };
  }
  if (!facts.branch) {
    return { verdict: "SKIP", reason: "detached HEAD", tier: null };
  }
  if (facts.branch === "main") {
    return { verdict: "SKIP", reason: "on main branch", tier: null };
  }
  if (facts.pinned) {
    return { verdict: "PINNED", reason: `.worktree-pinned present (branch=${facts.branch})`, tier: null };
  }
  if (facts.hasActiveLease) {
    return {
      verdict: "KEEP",
      reason: `branch=${facts.branch} active NonProductionEnvironmentLease`,
      tier: null,
    };
  }
  if (facts.hasOpenPr) {
    return { verdict: "KEEP", reason: `branch=${facts.branch} open PR`, tier: null };
  }

  if (facts.merged) {
    if (facts.dirty) {
      return {
        verdict: "KEEP",
        reason: `branch=${facts.branch} merged but dirty; refuse auto-reap`,
        tier: null,
      };
    }
    return {
      verdict: "PRUNE_TIER_A",
      reason: `branch=${facts.branch} merged to origin/main, clean, no open PR/lease`,
      tier: "A",
    };
  }

  if (facts.ageDays > graceDays) {
    if (facts.dirty) {
      return {
        verdict: "KEEP",
        reason: `branch=${facts.branch} stale ${facts.ageDays}d but dirty; manual review`,
        tier: null,
      };
    }
    return {
      verdict: "PRUNE_TIER_B",
      reason: `branch=${facts.branch} stale ${facts.ageDays}d (>${graceDays}d), unmerged, clean — observe/propose only`,
      tier: "B",
    };
  }

  return {
    verdict: "KEEP",
    reason: `branch=${facts.branch} unmerged, ${facts.ageDays}d old (<${graceDays}d grace)`,
    tier: null,
  };
}

/**
 * Which verdicts are eligible for live removal under a given policy.
 * @param {"all" | "tier-a-only"} policy
 * @param {WorktreeVerdict} verdict
 */
export function isLiveReapEligible(policy, verdict) {
  if (verdict === "PRUNE_TIER_A") return true;
  if (policy === "all" && verdict === "PRUNE_TIER_B") return true;
  return false;
}

/**
 * Summarize decisions for JSON / Inngest.
 * @param {Array<{ path: string, branch: string | null, verdict: WorktreeVerdict, reason: string, tier: string | null }>} decisions
 */
export function summarizeDecisions(decisions) {
  const counts = { PRUNE_TIER_A: 0, PRUNE_TIER_B: 0, KEEP: 0, SKIP: 0, PINNED: 0 };
  for (const d of decisions) {
    if (counts[d.verdict] !== undefined) counts[d.verdict] += 1;
  }
  return {
    counts,
    tierAPaths: decisions.filter((d) => d.verdict === "PRUNE_TIER_A").map((d) => d.path),
    tierBPaths: decisions.filter((d) => d.verdict === "PRUNE_TIER_B").map((d) => d.path),
  };
}
