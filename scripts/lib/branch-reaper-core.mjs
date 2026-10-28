// scripts/lib/branch-reaper-core.mjs
//
// BI-88D75BA3 — which local branches can go. Pure over facts gathered by
// scripts/branch-reaper.mjs, so the policy is unit-tested without a repository.
//
// A branch is reaped only when deleting it loses nothing and nobody is using
// it: no worktree has it checked out, it is not the current or a protected
// branch, no live Workroom names it, no open PR heads it, and its tip is
// already on origin/main — either an ancestor of it (merge commit / rebase) or
// exactly the head a merged PR shipped (squash merge). Anything else is kept.

/** Branches that are never reaped, whatever their state. */
export const PROTECTED_BRANCH_RE = /^(?:main|master|release\/.+|hotfix\/.+)$/;

/**
 * @param {object} facts
 * @param {{ name: string, tip: string }[]} facts.branches        local branches
 * @param {Set<string>} facts.worktreeBranches                     checked out somewhere
 * @param {string|null} facts.currentBranch
 * @param {Set<string>} facts.ancestorMerged                       tip is an ancestor of origin/main
 * @param {Map<string, Set<string>>} facts.mergedPrHeads           branch → head SHAs of its merged PRs
 * @param {Set<string>} facts.openPrBranches
 * @param {Set<string>} facts.liveRoomBranches                     named by a live Workroom
 * @param {boolean} facts.ownershipAvailable                       the Workroom read completed
 * @param {Set<string>} [facts.pinned]                             operator-pinned names
 * @returns {{ name: string, tip: string, action: "reap"|"keep", reason: string }[]}
 */
export function classifyBranches(facts) {
  return facts.branches.map(({ name, tip }) => {
    const keep = (reason) => ({ name, tip, action: "keep", reason });
    if (name === facts.currentBranch) return keep("current");
    if (PROTECTED_BRANCH_RE.test(name)) return keep("protected");
    if (facts.pinned?.has(name)) return keep("pinned");
    if (facts.worktreeBranches.has(name)) return keep("has-worktree");
    if (facts.openPrBranches.has(name)) return keep("open-pr");
    // Fail closed: if who owns what could not be read, nothing is reaped.
    if (!facts.ownershipAvailable) return keep("ownership-unreadable");
    if (facts.liveRoomBranches.has(name)) return keep("live-workroom");
    if (facts.ancestorMerged.has(name)) return { name, tip, action: "reap", reason: "merged-into-main" };
    if (facts.mergedPrHeads.get(name)?.has(tip)) return { name, tip, action: "reap", reason: "squash-merged" };
    return keep("unmerged");
  });
}

export function summarizeBranchDecisions(decisions) {
  const byReason = {};
  for (const d of decisions) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  return {
    total: decisions.length,
    reap: decisions.filter((d) => d.action === "reap").length,
    keep: decisions.filter((d) => d.action === "keep").length,
    byReason,
  };
}

/**
 * Stash census (report only — the stash stack is repository-wide and holds
 * other sessions' work, so automation never drops an entry).
 * @param {string} listing  `git stash list --format=%gd%x09%ct` output
 * @param {Date} now
 */
export function stashCensus(listing, now) {
  const ages = String(listing ?? "")
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter(([ref, ts]) => ref && /^\d+$/.test(ts ?? ""))
    .map(([, ts]) => (now.getTime() - Number(ts) * 1000) / 86_400_000);
  return {
    count: ages.length,
    olderThan7Days: ages.filter((d) => d > 7).length,
    olderThan30Days: ages.filter((d) => d > 30).length,
    oldestDays: ages.length ? Math.floor(Math.max(...ages)) : null,
  };
}
