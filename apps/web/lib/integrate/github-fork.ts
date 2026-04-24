// Fork detection + creation + sync helpers for the fork-based PR contribution
// model (see docs/superpowers/specs/2026-04-23-public-contribution-mode-design.md).
//
// These helpers wrap the GitHub REST endpoints:
//   GET  /repos/{owner}/{repo}             — check existence + fork-of relation
//   POST /repos/{owner}/{repo}/forks       — create a fork under the token owner's account
//   POST /repos/{owner}/{repo}/merge-upstream — pull upstream default branch into the fork
//
// Forks are created asynchronously by GitHub. The documented upper bound is
// five minutes; typical is 1-5 seconds. createForkAndWait polls for readiness
// and returns "deferred" when readiness is not observed within the polling
// window — callers should surface this as "fork is being created, retry soon"
// rather than treating it as a failure.
//
// syncForkFromUpstream is called before every contribute_to_hive fork-pr
// contribution to keep the fork's base branch in lockstep with upstream.
// Staleness manifests as merge conflicts at PR time, not push time, so the
// pre-push sync is a cheap guard against a common failure mode.

function getHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export interface ForkCheckResult {
  exists: boolean;
  /** Only meaningful when exists === true. */
  isFork: boolean;
  /** Set when the repo is a fork, regardless of whether it points at the expected upstream. */
  parentFullName?: string;
}

export async function forkExistsAndIsFork(params: {
  owner: string;
  repo: string;
  upstreamOwner: string;
  upstreamRepo: string;
  token: string;
}): Promise<ForkCheckResult> {
  const { owner, repo, upstreamOwner, upstreamRepo, token } = params;
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await fetch(url, { headers: getHeaders(token) });

  if (res.status === 404) return { exists: false, isFork: false };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API GET ${url}: ${res.status} ${body.slice(0, 200)}`);
  }

  const body = (await res.json()) as { fork?: boolean; parent?: { full_name?: string } };

  if (!body.fork || !body.parent?.full_name) {
    return { exists: true, isFork: false };
  }

  const expected = `${upstreamOwner}/${upstreamRepo}`.toLowerCase();
  const actual = body.parent.full_name.toLowerCase();
  return {
    exists: true,
    isFork: actual === expected,
    parentFullName: body.parent.full_name,
  };
}

export type ForkCreationResult =
  | { status: "ready"; forkOwner: string; forkRepo: string }
  | { status: "deferred"; forkOwner: string; forkRepo: string };

export async function createForkAndWait(params: {
  upstreamOwner: string;
  upstreamRepo: string;
  token: string;
  /** Default 1000 ms. Pass a smaller value in tests. */
  pollIntervalMs?: number;
  /** Default 60 attempts (60 s at default interval; GitHub's documented upper bound is 5 min, so deferred-then-retry covers the rest). */
  maxAttempts?: number;
}): Promise<ForkCreationResult> {
  const { upstreamOwner, upstreamRepo, token } = params;
  const pollIntervalMs = params.pollIntervalMs ?? 1000;
  const maxAttempts = params.maxAttempts ?? 60;

  const postUrl = `https://api.github.com/repos/${upstreamOwner}/${upstreamRepo}/forks`;
  const postRes = await fetch(postUrl, {
    method: "POST",
    headers: getHeaders(token),
  });

  if (postRes.status === 401) {
    const body = await postRes.text();
    throw new Error(`Fork creation rejected (401). Token invalid or missing scope: ${body.slice(0, 200)}`);
  }
  if (postRes.status === 403) {
    const body = await postRes.text();
    throw new Error(`Fork creation forbidden (403). ${body.slice(0, 200)}`);
  }
  if (!postRes.ok && postRes.status !== 202) {
    const body = await postRes.text();
    throw new Error(`POST ${postUrl}: ${postRes.status} ${body.slice(0, 200)}`);
  }

  const forkInfo = (await postRes.json()) as { owner?: { login?: string }; name?: string };
  const forkOwner = forkInfo.owner?.login;
  const forkRepo = forkInfo.name;
  if (!forkOwner || !forkRepo) {
    throw new Error(`POST ${postUrl} returned 2xx but response body was missing owner/name.`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const check = await forkExistsAndIsFork({
      owner: forkOwner,
      repo: forkRepo,
      upstreamOwner,
      upstreamRepo,
      token,
    });
    if (check.exists && check.isFork) {
      return { status: "ready", forkOwner, forkRepo };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { status: "deferred", forkOwner, forkRepo };
}

/**
 * Pull the upstream default branch into the fork's same branch.
 *
 * Used before every fork-pr contribution so the new branch is parented off
 * an up-to-date base — a stale fork manifests as merge conflicts at PR time,
 * not push time, and the UX is worse when it happens late. Called by
 * contribute_to_hive's fork-pr dispatch in Phase 4.
 *
 * 409 is surfaced as an actionable conflict error — the admin needs to
 * resolve divergence manually (typically by rebasing or deleting the
 * conflicting fork branch).
 */
export async function syncForkFromUpstream(params: {
  forkOwner: string;
  forkRepo: string;
  branch: string;
  token: string;
}): Promise<void> {
  const { forkOwner, forkRepo, branch, token } = params;
  const url = `https://api.github.com/repos/${forkOwner}/${forkRepo}/merge-upstream`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...getHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ branch }),
  });

  if (res.ok) return;
  const body = await res.text();
  if (res.status === 409) {
    throw new Error(
      `Fork merge-upstream conflict on ${forkOwner}/${forkRepo}@${branch}: ${body.slice(0, 200)}`,
    );
  }
  throw new Error(`POST ${url}: ${res.status} ${body.slice(0, 200)}`);
}
