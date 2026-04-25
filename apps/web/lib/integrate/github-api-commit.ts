/**
 * GitHub API-based commit creation — EP-BUILD-HANDOFF-002 Phase 2e
 *
 * Creates branches, commits, and PRs entirely via the GitHub REST API
 * (Git Data API). This eliminates the need for a local .git directory,
 * which is critical because the portal Docker container has no .git
 * (it's excluded by .dockerignore).
 *
 * Flow:
 *   1. Parse the unified diff to extract file paths and operations
 *   2. Read final file contents from the sandbox workspace
 *   3. Create blobs for each file via GitHub API
 *   4. Create a tree from those blobs
 *   5. Create a commit pointing to the tree
 *   6. Create a branch ref for the commit
 *   7. Create a PR (handled by the calling code)
 */

import { lazyFsPromises, lazyPath } from "@/lib/shared/lazy-node";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileOperation {
  path: string;
  operation: "add" | "modify" | "delete";
}

interface GitHubRef {
  ref: string;
  object: { sha: string; type: string };
}

interface GitHubBlob {
  sha: string;
}

interface GitHubTree {
  sha: string;
}

interface GitHubCommit {
  sha: string;
  html_url: string;
}

interface GitHubPR {
  number: number;
  html_url: string;
}

export interface GitHubCommitResult {
  branchName: string;
  commitSha: string;
  prUrl: string | null;
  prNumber: number | null;
}

export interface GitHubCommitIdentity {
  name: string;
  email: string;
}

// ─── Diff Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a unified diff to extract file operations (add/modify/delete).
 */
export function parseFileOperations(diff: string): FileOperation[] {
  const ops: FileOperation[] = [];
  const diffHeaderRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
  // Collect all diff segments with their positions
  const segments: Array<{ path: string; startIndex: number }> = [];
  let match;
  while ((match = diffHeaderRegex.exec(diff)) !== null) {
    segments.push({ path: match[2], startIndex: match.index });
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const endIndex = i + 1 < segments.length ? segments[i + 1].startIndex : diff.length;
    const segmentText = diff.slice(seg.startIndex, endIndex);

    if (segmentText.includes("--- /dev/null")) {
      ops.push({ path: seg.path, operation: "add" });
    } else if (segmentText.includes("+++ /dev/null")) {
      ops.push({ path: seg.path, operation: "delete" });
    } else {
      ops.push({ path: seg.path, operation: "modify" });
    }
  }

  return ops;
}

/**
 * Extract the full content of a NEW file from a unified diff.
 * Only works for files where the entire content is added (--- /dev/null).
 */
export function extractNewFileContent(diff: string, filePath: string): string | null {
  // Find the diff segment for this file
  const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const segmentRegex = new RegExp(
    `^diff --git a/.+ b/${escapedPath}\\n.*?\\n--- /dev/null\\n\\+\\+\\+ b/.+\\n(@@[\\s\\S]*?)(?=^diff --git|$)`,
    "m",
  );
  const match = segmentRegex.exec(diff);
  if (!match) return null;

  const hunkContent = match[1];
  const lines: string[] = [];
  for (const line of hunkContent.split("\n")) {
    if (line.startsWith("@@")) continue; // Skip hunk headers
    if (line.startsWith("+")) {
      lines.push(line.slice(1)); // Remove the leading +
    }
    // Skip context lines (shouldn't exist for new files) and - lines
  }

  // Remove trailing empty line that git diff adds
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n") + "\n";
}

// ─── Sandbox File Reading ───────────────────────────────────────────────────

/**
 * Read a file's content from the sandbox workspace volume.
 * The sandbox workspace is mounted at /sandbox-workspace in the portal container.
 */
export async function readSandboxFile(filePath: string): Promise<string | null> {
  const { readFile } = lazyFsPromises();
  const { resolve } = lazyPath();

  // The sandbox workspace is mounted at /sandbox-workspace
  const sandboxRoot = process.env.SANDBOX_WORKSPACE_PATH ?? "/sandbox-workspace";
  const fullPath = resolve(sandboxRoot, filePath);

  // Security: ensure path stays within sandbox root
  if (!fullPath.startsWith(resolve(sandboxRoot))) return null;

  try {
    return await readFile(fullPath, "utf-8");
  } catch {
    return null;
  }
}

// ─── GitHub API Helpers ─────────────────────────────────────────────────────

function getHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: getHeaders(token) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API GET ${url}: ${response.status} ${text.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Build a specific error for a base-branch lookup failure.
 *
 * GitHub returns 404 for BOTH "repo doesn't exist" and "token can't see this
 * repo" (this is deliberate — it hides private-repo existence from unauthorized
 * callers). The raw "GitHub API GET …: 404 Not Found" reads like a GitHub outage
 * when in practice it's almost always a token-access problem.
 *
 * 401 means token itself is invalid. 403 usually means a scope or rate limit.
 */
function explainBaseRefFailure(
  err: unknown,
  owner: string,
  repo: string,
  baseBranch: string,
): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const is404 = /:\s*404\b/.test(msg);
  const is401 = /:\s*401\b/.test(msg);
  const is403 = /:\s*403\b/.test(msg);
  if (is404) {
    return new Error(
      `Could not read ${owner}/${repo}@${baseBranch}. Token likely lacks Contents: Read access to this repo, or the repo is private and the token wasn't granted access to it. (GitHub returns 404 for unauthorized reads of private repos.) Original: ${msg}`,
    );
  }
  if (is401) {
    return new Error(
      `Token rejected by GitHub (401 Unauthorized) when reading ${owner}/${repo}@${baseBranch}. The token is invalid or revoked. Reissue it and update the hive-contribution credential. Original: ${msg}`,
    );
  }
  if (is403) {
    return new Error(
      `Token forbidden (403) from reading ${owner}/${repo}@${baseBranch}. Likely missing Contents: Read scope or hitting a rate limit. Original: ${msg}`,
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

async function githubPost<T>(url: string, body: unknown, token: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API POST ${url}: ${response.status} ${text.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Create a branch with committed files and a PR, entirely via GitHub API.
 *
 * Supports both same-repo and cross-repo (fork → upstream) PRs through the
 * head/base parameter split introduced for the fork-based contribution model.
 * When headOwner === baseOwner (same repo), the PR body uses the bare branch
 * name. When they differ (contributor fork → upstream), the PR body uses the
 * cross-repo shape `{headOwner}:{branchName}`.
 *
 * Behavioral invariants (preserved from the pre-split implementation):
 *   1. Order of side effects on the HEAD repo: base-sha lookup → blobs →
 *      tree → commit → ref. Then PR POST + labels POST on the BASE repo.
 *   2. The base-ref lookup reads from HEAD (the commit must be parented off a
 *      sha that exists in the head repo). For fork-pr this requires the fork
 *      to be in sync with upstream — Phase 4 adds a merge-upstream step
 *      before this call.
 *   3. Labels are POSTed to the BASE repo's issue (where the PR lives),
 *      not the HEAD repo's.
 *   4. explainBaseRefFailure wraps 401/403/404 on the base-ref lookup.
 *   5. Existing-PR recovery on 422 looks up open PRs on the BASE repo and
 *      surfaces their URL so callers can back-write the PR URL onto the
 *      FeaturePack.
 */
export async function createBranchAndPR(input: {
  /** Where the branch is pushed. For fork-pr, this is the contributor's fork. */
  headOwner: string;
  headRepo: string;
  /** Where the PR is opened against. Always the upstream in fork-pr. */
  baseOwner: string;
  baseRepo: string;
  /** Base branch — typically "main". */
  baseBranch?: string;
  branchName: string;
  commitMessage: string;
  commitAuthor?: GitHubCommitIdentity;
  diff: string;
  prTitle: string;
  prBody: string;
  labels: string[];
  token: string;
}): Promise<GitHubCommitResult> {
  const {
    headOwner,
    headRepo,
    baseOwner,
    baseRepo,
    branchName,
    commitMessage,
    commitAuthor,
    diff,
    prTitle,
    prBody,
    labels,
    token,
  } = input;
  const baseBranch = input.baseBranch ?? "main";
  const headApiBase = `https://api.github.com/repos/${headOwner}/${headRepo}`;
  const baseApiBase = `https://api.github.com/repos/${baseOwner}/${baseRepo}`;
  const isCrossRepo = headOwner !== baseOwner || headRepo !== baseRepo;
  const prHead = isCrossRepo ? `${headOwner}:${branchName}` : branchName;

  // 1. Get the SHA of the base branch on the HEAD repo.
  //
  // For cross-repo PRs this reads from the fork, not upstream — the new
  // commit must be parented off a sha that exists in the head repo. Forks
  // share history with upstream, so this works as long as the fork is not
  // behind upstream (Phase 4 adds a merge-upstream step to guarantee that).
  //
  // Wrap the raw GitHub error with a token-access-aware hint. A 404 here is
  // almost never a GitHub outage — it's a token that can't see the repo.
  let baseRef: GitHubRef;
  try {
    baseRef = await githubGet<GitHubRef>(
      `${headApiBase}/git/ref/heads/${baseBranch}`,
      token,
    );
  } catch (err) {
    throw explainBaseRefFailure(err, headOwner, headRepo, baseBranch);
  }
  const baseSha = baseRef.object.sha;

  // 2. Parse file operations from the diff
  const fileOps = parseFileOperations(diff);
  if (fileOps.length === 0) {
    throw new Error("No file changes found in the diff");
  }

  // 3. Create blobs for each added/modified file
  const treeEntries: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    sha: string | null;
  }> = [];

  for (const op of fileOps) {
    if (op.operation === "delete") {
      // Mark file for deletion by setting sha to null
      treeEntries.push({ path: op.path, mode: "100644", type: "blob", sha: null });
      continue;
    }

    // Try to read from sandbox workspace first, fall back to extracting from diff
    let content = await readSandboxFile(op.path);
    if (content === null && op.operation === "add") {
      content = extractNewFileContent(diff, op.path);
    }

    if (content === null) {
      console.warn(`[github-api-commit] Could not read content for ${op.path}, skipping`);
      continue;
    }

    // Create a blob for this file
    const blob = await githubPost<GitHubBlob>(
      `${headApiBase}/git/blobs`,
      { content, encoding: "utf-8" },
      token,
    );

    treeEntries.push({ path: op.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  if (treeEntries.length === 0) {
    throw new Error("No file contents could be resolved for the commit");
  }

  // 4. Create a new tree based on the base commit's tree (on HEAD repo).
  const tree = await githubPost<GitHubTree>(
    `${headApiBase}/git/trees`,
    { base_tree: baseSha, tree: treeEntries },
    token,
  );

  // 5. Create a commit on the HEAD repo.
  const commit = await githubPost<GitHubCommit>(
    `${headApiBase}/git/commits`,
    {
      message: commitMessage,
      tree: tree.sha,
      parents: [baseSha],
      ...(commitAuthor ? { author: commitAuthor, committer: commitAuthor } : {}),
    },
    token,
  );

  // 6. Create the branch ref on the HEAD repo.
  try {
    await githubPost(
      `${headApiBase}/git/refs`,
      { ref: `refs/heads/${branchName}`, sha: commit.sha },
      token,
    );
  } catch (err) {
    // Branch might already exist — try updating it
    const response = await fetch(`${headApiBase}/git/refs/heads/${branchName}`, {
      method: "PATCH",
      headers: getHeaders(token),
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create/update branch: ${(err as Error).message}`);
    }
  }

  // 7. Create the PR on the BASE repo. head is "{headOwner}:{branchName}" for
  // cross-repo PRs, bare branch name for same-repo.
  let prUrl: string | null = null;
  let prNumber: number | null = null;

  try {
    const pr = await githubPost<GitHubPR>(
      `${baseApiBase}/pulls`,
      { title: prTitle, body: prBody, head: prHead, base: baseBranch },
      token,
    );
    prUrl = pr.html_url;
    prNumber = pr.number;

    // Add labels on the BASE repo's issue (not HEAD) — best-effort.
    if (labels.length > 0) {
      try {
        await githubPost(
          `${baseApiBase}/issues/${pr.number}/labels`,
          { labels },
          token,
        );
      } catch { /* label application is best-effort */ }
    }
  } catch (err) {
    console.warn(`[github-api-commit] PR creation failed: ${(err as Error).message}`);
    // A second call for the same branch commonly fails here because an open PR
    // already exists (GitHub returns 422 "A pull request already exists for …").
    // Recover the existing PR's URL from the BASE repo (where the PR lives) so
    // the caller can back-write it onto the FeaturePack — otherwise the pack's
    // manifest.prUrl stays null forever even though the PR is live on GitHub.
    try {
      const existing = await githubGet<Array<GitHubPR & { state?: string }>>(
        `${baseApiBase}/pulls?head=${headOwner}:${branchName}&state=open`,
        token,
      );
      if (Array.isArray(existing) && existing.length > 0) {
        prUrl = existing[0].html_url;
        prNumber = existing[0].number;
      }
    } catch (lookupErr) {
      console.warn(`[github-api-commit] existing-PR lookup failed: ${(lookupErr as Error).message?.slice(0, 200)}`);
    }
  }

  return { branchName, commitSha: commit.sha, prUrl, prNumber };
}

// ─── PR Status & Merge ─────────────────────────────────────────────────────

export interface PRStatus {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  mergeable: boolean | null;
  title: string;
  checksPass: boolean | null;
}

/**
 * Get the status of a PR including merge readiness.
 */
export async function getPRStatus(input: {
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
}): Promise<PRStatus> {
  const { owner, repo, prNumber, token } = input;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  const pr = await githubGet<{
    number: number;
    state: string;
    merged: boolean;
    mergeable: boolean | null;
    title: string;
  }>(`${apiBase}/pulls/${prNumber}`, token);

  // Check combined status for the head SHA
  let checksPass: boolean | null = null;
  try {
    const checks = await githubGet<{ state: string }>(
      `${apiBase}/commits/${pr.number}/status`,
      token,
    );
    checksPass = checks.state === "success";
  } catch {
    // Status checks may not be configured
  }

  return {
    number: pr.number,
    state: pr.state as "open" | "closed",
    merged: pr.merged,
    mergeable: pr.mergeable,
    title: pr.title,
    checksPass,
  };
}

export interface MergeResult {
  merged: boolean;
  sha: string | null;
  message: string;
}

/**
 * Merge a PR via the GitHub API. Uses squash merge by default.
 */
export async function mergePR(input: {
  owner: string;
  repo: string;
  prNumber: number;
  commitTitle?: string;
  mergeMethod?: "merge" | "squash" | "rebase";
  token: string;
}): Promise<MergeResult> {
  const { owner, repo, prNumber, token } = input;
  const mergeMethod = input.mergeMethod ?? "squash";
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const result = await githubPost<{ merged: boolean; sha: string; message: string }>(
      `${apiBase}/pulls/${prNumber}/merge`,
      {
        merge_method: mergeMethod,
        ...(input.commitTitle ? { commit_title: input.commitTitle } : {}),
      },
      token,
    );
    return { merged: result.merged, sha: result.sha, message: result.message };
  } catch (err) {
    return {
      merged: false,
      sha: null,
      message: err instanceof Error ? err.message : "Merge failed",
    };
  }
}

/**
 * Post a comment on a PR.
 */
export async function commentOnPR(input: {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  token: string;
}): Promise<void> {
  const { owner, repo, prNumber, body, token } = input;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  await githubPost(
    `${apiBase}/issues/${prNumber}/comments`,
    { body },
    token,
  );
}
