import { spawnSync } from "node:child_process";

import { RESUME_MARKER_ENV } from "./durable-wait-resumer.mjs";

// BI-D35B85BF. The decisions a RESUMED local-CI gate makes that a fresh run
// does not, kept pure so they are tested without a gate process:
//
// - a resumed gate runs the candidate it queued, or nothing (AC-DW-03);
// - a cancellation of the lease it waits on is final (AC-DW-01);
// - only evidenced quiescence re-establishes queue intent (AC-DW-05);
// - a re-claim names the lease it resumes, so the server can supersede that
//   owner's obsolete queued row and nobody else's (AC-DW-02).

/** A gate is resumed when its resumer pinned a lease or marked the environment. */
export function isResumedGateRun({ resumeLeaseId, env = process.env }) {
  return Boolean(resumeLeaseId) || env[RESUME_MARKER_ENV] === "1";
}

function git(worktreePath, args) {
  const result = spawnSync("git", args, { cwd: worktreePath, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout).trim() : null;
}

/**
 * Does the worktree still hold exactly the pinned candidate?
 *
 * HEAD, the branch ref and a clean tree are all checked: a branch moved from
 * another worktree changes what the runner would build even when this HEAD did
 * not, and an uncommitted change is a tree nobody queued.
 */
export function verifyPinnedSource({ worktreePath, branch, sha }) {
  if (!sha) return { ok: false, reasons: ["no-pinned-sha"], head: null };
  const reasons = [];
  const head = git(worktreePath, ["rev-parse", "HEAD"]);
  if (head !== sha) reasons.push("head-moved");
  if (branch) {
    const branchHead = git(worktreePath, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    if (branchHead !== sha) reasons.push("branch-moved");
  }
  const status = git(worktreePath, ["status", "--porcelain"]);
  if (status === null) reasons.push("status-unreadable");
  else if (status.length > 0) reasons.push("worktree-dirty");
  return { ok: reasons.length === 0, reasons, head };
}

/**
 * What to do when the server says the claim is terminal.
 *
 * `stop` for a cancellation of a lease this run was waiting on or held: that is
 * someone's decision, and re-claiming would override it. A fresh explicit run
 * meeting somebody's earlier cancelled row is a person asking again and still
 * gets a fresh attempt (BI-C59AC8AF). Queue intent is re-established only when
 * quiescence interrupted the claim AND the lease expired; an operator cancelling
 * during quiescence is still a cancellation.
 */
export function decideTerminalClaim({ terminalReason, resumed, heldLeaseId, interruptedByQuiescence }) {
  if (terminalReason === "cancelled" && (resumed || heldLeaseId)) {
    return { action: "stop", reason: "cancelled" };
  }
  return {
    action: "replace",
    reestablishQueueIntent: Boolean(interruptedByQuiescence) && terminalReason === "expired",
  };
}

/** The lease a claim resumes: the one this process holds, else the one its resumer pinned. */
export function resumeClaimFields({ heldLeaseId, pinnedLeaseId }) {
  const resumeLeaseId = heldLeaseId || pinnedLeaseId;
  return resumeLeaseId ? { resumeLeaseId } : {};
}
