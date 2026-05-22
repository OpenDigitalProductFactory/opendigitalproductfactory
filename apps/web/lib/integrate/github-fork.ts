// Fork detection + creation helpers for the fork-based PR contribution model
// (see docs/superpowers/specs/2026-04-23-public-contribution-mode-design.md).
//
// These helpers wrap the GitHub REST endpoints:
//   GET  /repos/{owner}/{repo}           — check existence + fork-of relation
//   POST /repos/{owner}/{repo}/forks     — create a fork under the token owner's account
//
// Forks are created asynchronously by GitHub. The documented upper bound is
// five minutes; typical is 1-5 seconds. createForkAndWait polls for readiness
// and returns "deferred" when readiness is not observed within the polling
// window — callers should surface this as "fork is being created, retry soon"
// rather than treating it as a failure.

import { assertSafeOutboundUrl } from "@/lib/security/safe-fetch";

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
  // BI-5E53A265 fix (CodeQL alert #35). owner/repo flow into a fetch URL.
  // Host is hardcoded to api.github.com, but the dataflow is still
  // user→fetch. assertSafeOutboundUrl pins the host; the explicit
  // `url.hostname !== "api.github.com"` check below is the pattern
  // CodeQL's HostnameSanitizer recognizes for js/request-forgery (the
  // helper's internal check is invisible to that query).
  const url = assertSafeOutboundUrl(
    `https://api.github.com/repos/${owner}/${repo}`,
    { allowedHosts: ["api.github.com"] },
  );
  if (url.hostname !== "api.github.com") {
    // Defense-in-depth + CodeQL sanitizer signal. Helper already
    // enforced this; throwing here would only fire if the helper
    // regressed silently.
    throw new Error(`Unexpected host after sanitization: ${url.hostname}`);
  }
  const res = await fetch(url.href, { headers: getHeaders(token) });

  if (res.status === 404) return { exists: false, isFork: false };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API GET ${url.href}: ${res.status} ${body.slice(0, 200)}`);
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
