// A merged pull request is a fact the platform should be TOLD, not one it has
// to go looking for (BI-A6E4D205).
//
// The webhook receiver at /api/platform/git/updates has always been signed,
// idempotent and wired to Inngest — it just refused to look at anything but
// `push`. So the one event that answers "did this ship" arrived, was signature
// verified, was filed as an inert candidate, and nothing acted on it.
//
// What we did instead: `build/pr-delivery-reconcile` polls the GitHub REST API
// every five minutes, and only for Workrooms carrying a linked feature build.
// Agent-authored pull requests were never covered at all. Two consequences,
// both measured on this install 2026-09-09:
//
//   * A worktree becomes Tier-A reapable at the instant its PR merges, and
//     nothing observed that instant. 48 merged worktrees, never reaped.
//   * Completion needs `mergedThroughGates`, which had to be DISCOVERED rather
//     than DELIVERED. 150 items held evidence with no receipt.
//
// This module is the pure half: given a GitHub `pull_request` payload, decide
// whether it is a merge and extract the identity downstream needs. It reads a
// payload and returns a value — no I/O, no Prisma, no fetch — so the decision
// is testable without a webhook.

/** The identity a merged pull request contributes to the delivery record. */
export type PullRequestMergedSignal = {
  repositoryFullName: string;
  number: number;
  headRefName: string;
  headSha: string;
  mergeCommitSha: string | null;
  mergedAt: string | null;
  baseRefName: string | null;
  title: string | null;
};

export type PullRequestMergedVerdict =
  | { merged: true; signal: PullRequestMergedSignal }
  | { merged: false; reason: PullRequestMergedSkipReason };

export type PullRequestMergedSkipReason =
  /** Not a `pull_request` event at all. */
  | "not-a-pull-request-event"
  /** A pull_request event, but not the closing one (opened, synchronize, ...). */
  | "not-a-close-action"
  /** Closed WITHOUT merging. Real and common; the branch did not ship. */
  | "closed-unmerged"
  /** Shaped like a merge but missing identity we refuse to guess at. */
  | "incomplete-identity";

const SHA_RE = /^[a-f0-9]{40}$/i;

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Is this webhook delivery a merged pull request, and if so, what merged?
 *
 * `action: "closed"` alone is NOT a merge — a closed-unmerged PR carries the
 * same action and `merged: false`. Conflating them would record delivery
 * evidence for work that was abandoned, which is the worst possible direction
 * for this error: it would mark a Workroom shipped and reap the worktree
 * holding the only copy of the branch.
 *
 * Identity is required, not inferred. A payload missing the head branch or a
 * well-formed head sha is reported as `incomplete-identity` rather than
 * half-applied, because every downstream consumer keys on one of those.
 */
export function readPullRequestMergedSignal(
  eventName: string,
  payload: unknown,
): PullRequestMergedVerdict {
  if (eventName !== "pull_request") {
    return { merged: false, reason: "not-a-pull-request-event" };
  }
  const body = (payload ?? {}) as Record<string, unknown>;
  if (body.action !== "closed") {
    return { merged: false, reason: "not-a-close-action" };
  }

  const pr = (body.pull_request ?? {}) as Record<string, unknown>;
  if (pr.merged !== true) {
    return { merged: false, reason: "closed-unmerged" };
  }

  const repository = (body.repository ?? {}) as Record<string, unknown>;
  const head = (pr.head ?? {}) as Record<string, unknown>;
  const base = (pr.base ?? {}) as Record<string, unknown>;

  const repositoryFullName = nonEmpty(repository.full_name);
  const headRefName = nonEmpty(head.ref);
  const headSha = nonEmpty(head.sha);
  const number = typeof pr.number === "number" && Number.isInteger(pr.number) ? pr.number : null;

  if (!repositoryFullName || !headRefName || !headSha || !SHA_RE.test(headSha) || number === null) {
    return { merged: false, reason: "incomplete-identity" };
  }

  const mergeCommitSha = nonEmpty(pr.merge_commit_sha);

  return {
    merged: true,
    signal: {
      repositoryFullName,
      number,
      headRefName,
      headSha,
      // A merge commit sha is absent for a rebase merge, which is legitimate.
      // Downstream keys on headRefName + number, so this stays optional rather
      // than making a rebase-merged PR look malformed.
      mergeCommitSha: mergeCommitSha && SHA_RE.test(mergeCommitSha) ? mergeCommitSha : null,
      mergedAt: nonEmpty(pr.merged_at),
      baseRefName: nonEmpty(base.ref),
      title: nonEmpty(pr.title),
    },
  };
}

/** The operator-facing sentence for a non-merge verdict. */
export function describePullRequestMergedSkip(reason: PullRequestMergedSkipReason): string {
  switch (reason) {
    case "not-a-pull-request-event":
      return "Not a pull_request delivery; no merge signal is owed.";
    case "not-a-close-action":
      return "A pull_request event that is not the closing one; nothing has shipped yet.";
    case "closed-unmerged":
      return "The pull request was closed without merging, so no work was delivered.";
    default:
      return "Shaped like a merge but missing repository, number, head branch or a well-formed head sha; refusing to guess.";
  }
}
