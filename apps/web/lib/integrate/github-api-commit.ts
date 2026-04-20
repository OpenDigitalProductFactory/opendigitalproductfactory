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
 * @param owner - GitHub repo owner
 * @param repo - GitHub repo name
 * @param branchName - Feature branch name (e.g. "build/FB-XXXX/customer-complaint-tracker")
 * @param commitMessage - Full commit message including trailers
 * @param diff - The unified diff from the sandbox
 * @param prTitle - PR title
 * @param prBody - PR body markdown
 * @param labels - PR labels
 * @param token - GitHub token
 * @param baseBranch - Base branch (default: "main")
 */
export async function createBranchAndPR(input: {
  owner: string;
  repo: string;
  branchName: string;
  commitMessage: string;
  diff: string;
  prTitle: string;
  prBody: string;
  labels: string[];
  token: string;
  baseBranch?: string;
}): Promise<GitHubCommitResult> {
  const { owner, repo, branchName, commitMessage, diff, prTitle, prBody, labels, token } = input;
  const baseBranch = input.baseBranch ?? "main";
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  // 1. Get the SHA of the base branch
  //
  // Wrap the raw GitHub error with a token-access-aware hint. A 404 here is
  // almost never a GitHub outage — it's a token that can't see the repo.
  let baseRef: GitHubRef;
  try {
    baseRef = await githubGet<GitHubRef>(
      `${apiBase}/git/ref/heads/${baseBranch}`,
      token,
    );
  } catch (err) {
    throw explainBaseRefFailure(err, owner, repo, baseBranch);
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
      `${apiBase}/git/blobs`,
      { content, encoding: "utf-8" },
      token,
    );

    treeEntries.push({ path: op.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  if (treeEntries.length === 0) {
    throw new Error("No file contents could be resolved for the commit");
  }

  // 4. Create a new tree based on the base commit's tree
  const tree = await githubPost<GitHubTree>(
    `${apiBase}/git/trees`,
    { base_tree: baseSha, tree: treeEntries },
    token,
  );

  // 5. Create a commit
  const commit = await githubPost<GitHubCommit>(
    `${apiBase}/git/commits`,
    {
      message: commitMessage,
      tree: tree.sha,
      parents: [baseSha],
    },
    token,
  );

  // 6. Create the branch ref
  try {
    await githubPost(
      `${apiBase}/git/refs`,
      { ref: `refs/heads/${branchName}`, sha: commit.sha },
      token,
    );
  } catch (err) {
    // Branch might already exist — try updating it
    const response = await fetch(`${apiBase}/git/refs/heads/${branchName}`, {
      method: "PATCH",
      headers: getHeaders(token),
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create/update branch: ${(err as Error).message}`);
    }
  }

  // 7. Create the PR
  let prUrl: string | null = null;
  let prNumber: number | null = null;

  try {
    const pr = await githubPost<GitHubPR>(
      `${apiBase}/pulls`,
      { title: prTitle, body: prBody, head: branchName, base: baseBranch },
      token,
    );
    prUrl = pr.html_url;
    prNumber = pr.number;

    // Add labels (best-effort)
    if (labels.length > 0) {
      try {
        await githubPost(
          `${apiBase}/issues/${pr.number}/labels`,
          { labels },
          token,
        );
      } catch { /* label application is best-effort */ }
    }
  } catch (err) {
    console.warn(`[github-api-commit] PR creation failed: ${(err as Error).message}`);
    // A second call for the same branch commonly fails here because an open PR
    // already exists (GitHub returns 422 "A pull request already exists for …").
    // Recover the existing PR's URL so the caller can back-write it onto the
    // FeaturePack — otherwise the pack's manifest.prUrl stays null forever
    // even though the PR is live on GitHub.
    try {
      const existing = await githubGet<Array<GitHubPR & { state?: string }>>(
        `${apiBase}/pulls?head=${owner}:${branchName}&state=open`,
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

// ─── Cross-Fork PR ──────────────────────────────────────────────────────────

/**
 * Create a branch on a fork and PR targeting an upstream repo.
 * Used when the user has a fork configured as their gitRemoteUrl.
 */
export async function createCrossForkPR(input: {
  forkOwner: string;
  forkRepo: string;
  upstreamOwner: string;
  upstreamRepo: string;
  branchName: string;
  commitMessage: string;
  diff: string;
  prTitle: string;
  prBody: string;
  labels: string[];
  token: string;
  baseBranch?: string;
}): Promise<GitHubCommitResult> {
  const { forkOwner, forkRepo, upstreamOwner, upstreamRepo, branchName, commitMessage, diff, prTitle, prBody, labels, token } = input;
  const baseBranch = input.baseBranch ?? "main";

  // 1. Create branch and commit on the fork
  const result = await createBranchAndPR({
    owner: forkOwner,
    repo: forkRepo,
    branchName,
    commitMessage,
    diff,
    prTitle: prTitle, // won't create PR here — we'll create it on upstream
    prBody,
    labels: [],
    token,
    baseBranch,
  });

  // 2. Create PR on upstream targeting the fork's branch
  const upstreamApiBase = `https://api.github.com/repos/${upstreamOwner}/${upstreamRepo}`;
  let prUrl: string | null = null;
  let prNumber: number | null = null;

  try {
    const pr = await githubPost<GitHubPR>(
      `${upstreamApiBase}/pulls`,
      {
        title: prTitle,
        body: prBody,
        head: `${forkOwner}:${branchName}`,
        base: baseBranch,
      },
      token,
    );
    prUrl = pr.html_url;
    prNumber = pr.number;

    if (labels.length > 0) {
      try {
        await githubPost(
          `${upstreamApiBase}/issues/${pr.number}/labels`,
          { labels },
          token,
        );
      } catch { /* best-effort */ }
    }
  } catch (err) {
    console.warn(`[github-api-commit] Cross-fork PR creation failed: ${(err as Error).message}`);
  }

  return { branchName, commitSha: result.commitSha, prUrl, prNumber };
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
