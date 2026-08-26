// apps/web/lib/skills/seed-pull-request.ts
//
// Phase 2b of BI-5798BBA3, under decision DI-36D36FEBF4BA (file-authoritative-pr):
// an approved skill change is emitted as a branch + pull request carrying the
// seed-file edit, so it lands through the same DCO/CI/review path as every other
// change to this repository.
//
// Why a PR and not just a file write. Phase 2a writes the seed into the local
// checkout, which is right on a developer machine and wrong on a production
// install: DPF_REPO_ROOT there is the deployment clone, and an uncommitted edit
// in it is drift that a self-upgrade checkout can clobber — the same hazard that
// makes the shared root clone unsafe for active work. Publishing through the
// GitHub API touches no working tree at all.
//
// This deliberately reuses the Build Studio publish primitive
// (`lib/build/github-api-commit`) rather than shelling out to git. That path
// creates the branch, blob, tree and commit over the API, so it needs no
// checkout, no sandbox, and no `sandbox_execute` grant.

import { getErrorMessage } from "@/lib/shared/get-error-message";

/**
 * Outcome of trying to publish an approved seed change. Only `pr-opened` means a
 * reviewable change exists; every other status leaves the approval un-landed and
 * the caller must say so rather than reporting success.
 */
export type SeedPullRequestStatus =
  | "pr-opened"
  | "no-change"
  | "no-token"
  | "no-repo"
  | "pr-failed";

export type SeedPullRequestResult = {
  status: SeedPullRequestStatus;
  prUrl: string | null;
  branchName: string | null;
  reason: string | null;
};

/**
 * A unified diff for one file rewrite. Returns "" when the bodies match, so a
 * caller never opens a pull request for a no-op.
 *
 * Whole-file replacement is deliberate: a skill body is reviewed as prose, and a
 * minimal hunk diff would make the reviewer reconstruct the result in their head.
 */
export function buildSeedDiff(path: string, before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.length > 0 ? before.replace(/\n$/, "").split("\n") : [];
  const afterLines = after.length > 0 ? after.replace(/\n$/, "").split("\n") : [];
  const header = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];
  const body = [
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ];
  return `${[...header, ...body].join("\n")}\n`;
}

function branchNameFor(proposalId: string): string {
  const safe = proposalId.replace(/[^A-Za-z0-9._-]/g, "-");
  return `chore/skill-seed-${safe}`;
}

/**
 * Publish an approved skill body as a branch + PR against the seed file.
 * Best-effort and non-throwing: the approval is already committed in the
 * database, so a GitHub failure is reported, never allowed to unwind it.
 */
export async function emitSeedPullRequest(input: {
  skillId: string;
  seedPath: string;
  before: string;
  after: string;
  proposalId: string;
  reviewerName: string;
  reviewerEmail: string;
  repoOwner: string | null;
  repoRepo: string | null;
}): Promise<SeedPullRequestResult> {
  const diff = buildSeedDiff(input.seedPath, input.before, input.after);
  if (!diff) {
    return { status: "no-change", prUrl: null, branchName: null, reason: "Seed already matches the approved body." };
  }
  if (!input.repoOwner || !input.repoRepo) {
    return { status: "no-repo", prUrl: null, branchName: null, reason: "Could not resolve the GitHub repository from the git remote." };
  }

  // Token resolution reads the credential store and can throw; it is inside the
  // guarded path for the same reason the publish is — the approval has already
  // committed and must not be unwound by a lookup failure.
  let token: string | null = null;
  try {
    const { resolveHiveToken } = await import("@/lib/build/identity-privacy");
    token = await resolveHiveToken();
  } catch (err) {
    const reason = getErrorMessage(err);
    console.warn(`[seed-pull-request] could not resolve a GitHub token for ${input.proposalId}:`, reason);
    return { status: "no-token", prUrl: null, branchName: null, reason };
  }
  if (!token) {
    return {
      status: "no-token",
      prUrl: null,
      branchName: null,
      reason: "No GitHub token available — configure HIVE_CONTRIBUTION_TOKEN to let approvals open a pull request.",
    };
  }

  const branchName = branchNameFor(input.proposalId);
  // publishBranchCommit asserts a DCO trailer and parses the identity from it,
  // so the sign-off is load-bearing here, not decoration.
  const commitMessage = [
    `chore(skills): apply approved change to ${input.skillId} (${input.proposalId})`,
    "",
    `Applies the body approved on proposal ${input.proposalId} to the skill's seed`,
    "file, which is the copy that ships. Without this the approval lives only in",
    "the database and the next reseed reverts it.",
    "",
    `Signed-off-by: ${input.reviewerName} <${input.reviewerEmail}>`,
  ].join("\n");

  try {
    const { createBranchAndPR } = await import("@/lib/build/github-api-commit");
    const result = await createBranchAndPR({
      headOwner: input.repoOwner,
      headRepo: input.repoRepo,
      baseOwner: input.repoOwner,
      baseRepo: input.repoRepo,
      branchName,
      commitMessage,
      diff,
      prTitle: `chore(skills): apply approved change to ${input.skillId} (${input.proposalId})`,
      prBody: [
        `Approved skill change for \`${input.skillId}\`, emitted automatically on approval of ${input.proposalId}.`,
        "",
        `The seed file is the authoritative copy (DI-36D36FEBF4BA), so an approval that does not reach it is reverted by the next reseed. This PR is that step.`,
        "",
        `Seed file: \`${input.seedPath}\``,
      ].join("\n"),
      labels: [],
      token,
    });
    return {
      status: "pr-opened",
      prUrl: result.prUrl,
      branchName: result.branchName,
      reason: null,
    };
  } catch (err) {
    const reason = getErrorMessage(err);
    console.warn(`[seed-pull-request] could not open a PR for ${input.proposalId}:`, reason);
    return { status: "pr-failed", prUrl: null, branchName, reason };
  }
}
