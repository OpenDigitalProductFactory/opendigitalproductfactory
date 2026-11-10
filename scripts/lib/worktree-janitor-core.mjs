// scripts/lib/worktree-janitor-core.mjs
//
// Pure worktree reaping classification (BI-42FA7DD8; liveness + abandoned-merge
// quarantine added under EP-PROCESS-SPINE, plan 2026-08-11-worktree-lifecycle-hygiene).
//
// KEEP (live session): a session heartbeat is fresh in the worktree — NEVER reap
//   it out from under a live session, even when it is otherwise Tier-A eligible.
//   This is the safety fix for the "janitor reaped an active session's worktree"
//   near-miss: a merged+clean tree that a peer session is still working in.
// FLAG_ABANDONED_MERGE (quarantine / observe): a merge is in progress (MERGE_HEAD
//   present) but no live session heartbeat — the merge was abandoned mid-flight.
//   Surfaced, never auto-deleted (an interrupted merge can hide un-reconciled work).
// Tier A (safe auto-reap when DPF_WORKTREE_JANITOR_AUTO_REAP=1):
//   merged (ancestry OR squash-merged PR) + clean + no open PR + no lease + not
//   pinned + no live session + not mid-merge
// Tier B (observe / propose only — never auto-delete):
//   unmerged + clean + age > graceDays
//
// Side-effecting removal stays in scripts/worktree-janitor.mjs via
// junction-safe-worktree-remove.mjs.

/** @typedef {"PRUNE_TIER_A" | "PRUNE_TIER_B" | "KEEP" | "SKIP" | "PINNED" | "FLAG_ABANDONED_MERGE"} WorktreeVerdict */

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
 * @property {boolean} [hasLiveSession]  a fresh session heartbeat is present
 * @property {boolean} [hasActiveClaim]  an active Workroom claims this worktree
 * @property {boolean} [claimSourceUnavailable]  the claim record could not be read
 * @property {string}  [claimSourceReason]  why it could not be read
 * @property {boolean} [midMerge]        a merge is in progress (MERGE_HEAD present)
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

  // Liveness gate — the safety fix. A fresh session heartbeat means a session is
  // actively working in this tree; removing its .git linkage now is the near-miss
  // that stranded a live session onto the root clone. This must sit ABOVE the
  // merged/Tier-A check: the moment a live session's PR merges, its clean tree
  // first becomes Tier-A eligible — exactly when it must NOT be reaped.
  if (facts.hasLiveSession) {
    return {
      verdict: "KEEP",
      reason: `branch=${facts.branch} live session heartbeat — refuse to reap an in-use worktree`,
      tier: null,
    };
  }

  // The PLATFORM's answer to "is anyone working here", which outranks the
  // client-written heartbeat above because it is the same record every surface
  // writes to. The heartbeat is a Claude Code plugin hook: Codex, Grok and Build
  // Studio write nothing, so on 2026-09-02 the gate above read "no heartbeat" as
  // "no live session" and reaped 24 claimed worktrees, one of them a
  // codex-desktop room touched minutes earlier (BI-99395B29 follow-up).
  if (facts.hasActiveClaim) {
    return {
      verdict: "KEEP",
      reason: `branch=${facts.branch} claimed by an active Workroom — refuse to reap owned work`,
      tier: null,
    };
  }

  // FAIL SAFE. When the claim record could not be read at all, "nobody is
  // working here" is a guess, not a finding — and it is the guess that cost 24
  // worktrees. Refuse to reap rather than assume the platform is idle.
  if (facts.claimSourceUnavailable) {
    return {
      verdict: "KEEP",
      reason:
        `branch=${facts.branch} Workroom claims unreadable (${facts.claimSourceReason ?? "unknown"}) — ` +
        "refusing to reap on absent evidence",
      tier: null,
    };
  }

  // Abandoned mid-merge quarantine. A merge in progress with no live session was
  // interrupted; it can hide un-reconciled work, so flag it for review rather than
  // silently leaving it (or reaping it). Reached only when NOT live (live returned
  // KEEP above), so the heartbeat's absence supplies the "stale" half.
  if (facts.midMerge) {
    return {
      verdict: "FLAG_ABANDONED_MERGE",
      reason: `branch=${facts.branch} MERGE_HEAD present with no live session — abandoned mid-merge; quarantined for review, never auto-reaped`,
      tier: null,
    };
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
  const counts = {
    PRUNE_TIER_A: 0,
    PRUNE_TIER_B: 0,
    KEEP: 0,
    SKIP: 0,
    PINNED: 0,
    FLAG_ABANDONED_MERGE: 0,
  };
  for (const d of decisions) {
    if (counts[d.verdict] !== undefined) counts[d.verdict] += 1;
  }
  return {
    counts,
    tierAPaths: decisions.filter((d) => d.verdict === "PRUNE_TIER_A").map((d) => d.path),
    tierBPaths: decisions.filter((d) => d.verdict === "PRUNE_TIER_B").map((d) => d.path),
    flaggedPaths: decisions
      .filter((d) => d.verdict === "FLAG_ABANDONED_MERGE")
      .map((d) => d.path),
  };
}
