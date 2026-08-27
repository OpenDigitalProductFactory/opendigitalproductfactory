// Workroom claim resolution for the PreToolUse claim guard (BI-0B292D84).
//
// AGENTS.md §12: "Claim a workroom before you work — every surface, including
// the external CLIs." Until now that rule had no guard. Measured 2026-08-26 on
// this install: 30 of 79 live worktree branches carried no WorkCapsule binding
// at all, and 10 of 17 workrooms in status `working` had neither a headBranch
// nor a worktreePath. §12's *lease* rule is marked hook-refused; the *claim*
// rule was prose, and prose is not a control gate.
//
// WHAT AUTHORITY LOOKS LIKE HERE
//   MCP is the coordination plane and the only authority on whether a claim
//   exists. But a PreToolUse hook runs before EVERY edit, so it cannot make a
//   network call each time. So: MCP is consulted once and its answer is cached
//   in a marker under the shared git dir, keyed to the branch and carrying the
//   capsule's own lease expiry. The marker is a CACHE OF AN MCP ANSWER, never a
//   substitute for one — it cannot outlive the lease it records, and a branch
//   mismatch invalidates it outright.
//
// This module is pure: no fs, no network, no clock. Everything it decides is a
// function of its arguments, so the whole decision table is unit-testable and
// the guard itself stays a thin shell. That matters because a guard that is
// wrong in one direction wedges every session and in the other direction
// enforces nothing.

/** Marker filename, written beside the repo's shared git dir. */
export const CLAIM_MARKER_NAME = "dpf-workroom-claim.json";

/**
 * Branches that never require a claim.
 * - `main` is merge-queue governed and the root clone is read-only for feature
 *   work (root-clone-guard already refuses writes there).
 * - `local/main-parked` is the parked-root convention, not work.
 * - `local-integration/slot-*` are the local-CI runner's own slots; the runner
 *   is not an agent doing work and has no workroom to claim.
 */
export function isClaimExemptBranch(branch) {
  if (!branch) return false;
  const b = String(branch);
  if (b === "main" || b === "master") return true;
  if (b === "local/main-parked") return true;
  return /^local-integration\/slot-\d+\//.test(b);
}

/**
 * Parse a claim marker. Returns null for anything unusable — a corrupt marker
 * must read as "no claim", never as a pass.
 * @param {string | null | undefined} raw
 */
export function parseClaimMarker(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const capsuleId = typeof parsed.capsuleId === "string" ? parsed.capsuleId : null;
  const branch = typeof parsed.branch === "string" ? parsed.branch : null;
  const expiresAt = typeof parsed.leaseExpiresAt === "string" ? Date.parse(parsed.leaseExpiresAt) : NaN;
  if (!capsuleId || !branch || !Number.isFinite(expiresAt)) return null;
  return {
    capsuleId,
    branch,
    expiresAtMs: expiresAt,
    worktreePath: typeof parsed.worktreePath === "string" ? parsed.worktreePath : null,
    backlogItemId: typeof parsed.backlogItemId === "string" ? parsed.backlogItemId : null,
  };
}

/**
 * Decide whether work on `branch` is covered by a claim.
 *
 * Verdict kinds:
 *   allow        — exempt branch, or a valid unexpired marker for this branch
 *   deny         — no claim, wrong branch, or the lease has expired
 *   fail-open    — the guard could not determine the answer (marker unreadable
 *                  for an IO reason the caller reports). Allowed, but the caller
 *                  MUST attest it, because a silently-off gate is the exact
 *                  defect this guard exists to remove.
 *
 * @param {{ branch: string|null, marker: ReturnType<typeof parseClaimMarker>, nowMs: number, lookupFailed?: boolean }} input
 */
export function classifyClaim({ branch, marker, nowMs, lookupFailed = false }) {
  if (!branch) {
    // Detached HEAD is already refused by the branch guard; nothing to claim against.
    return { kind: "allow", reason: "no-branch" };
  }
  if (isClaimExemptBranch(branch)) {
    return { kind: "allow", reason: "exempt-branch", branch };
  }
  if (lookupFailed) {
    return { kind: "fail-open", reason: "claim-lookup-unavailable", branch };
  }
  if (!marker) {
    return { kind: "deny", reason: "no-claim", branch };
  }
  if (marker.branch !== branch) {
    return { kind: "deny", reason: "claim-branch-mismatch", branch, claimedBranch: marker.branch, capsuleId: marker.capsuleId };
  }
  if (marker.expiresAtMs <= nowMs) {
    return { kind: "deny", reason: "claim-lease-expired", branch, capsuleId: marker.capsuleId, expiredAtMs: marker.expiresAtMs };
  }
  return { kind: "allow", reason: "claimed", branch, capsuleId: marker.capsuleId };
}

/**
 * Operator-facing refusal text. Names the branch, why it was refused, and the
 * exact call that fixes it — a refusal that does not say how to comply is just
 * an obstacle.
 * @param {ReturnType<typeof classifyClaim>} verdict
 */
export function denyGuidance(verdict) {
  const head = {
    "no-claim": `No Workroom claim covers branch "${verdict.branch}".`,
    "claim-branch-mismatch": `The Workroom claim on this worktree (${verdict.capsuleId}) is for branch "${verdict.claimedBranch}", not "${verdict.branch}".`,
    "claim-lease-expired": `The Workroom claim ${verdict.capsuleId} on branch "${verdict.branch}" has an expired lease.`,
  }[verdict.reason] ?? `Work on branch "${verdict.branch}" is not covered by a Workroom claim.`;

  return (
    `${head} AGENTS.md §12 requires claiming a Workroom before you work, on every surface including the external CLIs — the unit of WIP is the Workroom, and MCP is the coordination plane. ` +
    `This was prose until BI-0B292D84; when it was measured, 30 of 79 live branches had no claim at all. ` +
    `To comply: call adopt_worktree with this repository, headBranch and worktreePath (it binds or reuses idempotently), then claim_workroom_scope for the paths you are about to edit. ` +
    `If the lease simply lapsed, heartbeat_workroom renews it. ` +
    `If you are deliberately working outside a Workroom, prefix the command with DPF_ALLOW_UNCLAIMED_WORK=1 — that is recorded, not silent.`
  );
}
