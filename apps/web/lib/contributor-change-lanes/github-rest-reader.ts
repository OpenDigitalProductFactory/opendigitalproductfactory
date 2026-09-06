// apps/web/lib/contributor-change-lanes/github-rest-reader.ts
// Phase 4 of BI-063BDF1B — real GitHub REST reader.
//
// Replaces the Phase 2 stub. Authenticates via the CredentialEntry row
// with providerId "github-pr-sync" when one exists, falling back to the
// contribution-pipeline rows when it does not — see the comment on
// GITHUB_READ_CREDENTIAL_PROVIDER_IDS below. The header used to say this row
// was "created by the Contributor MCP card from PR #1204"; no such writer
// exists in the tree, and believing it cost a day of looking for a settings
// page that was never built (BI-69BBC446). Etag persistence uses
// ScheduledJob.metadata.githubPrEtag so the rate-budget protection
// survives the ContributorInventorySnapshot 7-day retention sweep.
//
// Spec: docs/superpowers/specs/2026-05-26-contributor-inventory-sync-design.md
//   §"Per-source work" item 3, §"Etag persistence".

import { createOffThreadpoolFetchTransport } from "@/lib/network/off-threadpool-fetch";

import {
  createPullRequestObservation,
  parseVerifiedPullRequestObservation,
} from "./pull-request-observation";
import type { PullRequestSnapshot } from "./types";

const GITHUB_PR_CREDENTIAL_PROVIDER_ID = "github-pr-sync";
const CONTRIBUTOR_INVENTORY_SYNC_JOB_ID = "contributor-inventory-sync";
const FALLBACK_REPO_OWNER = "OpenDigitalProductFactory";
const FALLBACK_REPO_NAME = "opendigitalproductfactory";
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PER_PAGE = 100;

export type SnapshotRowPayload = {
  sourceKey: string;
  payload: unknown;
};

export type GithubReaderResult =
  | {
      ok: true;
      rows: SnapshotRowPayload[];
      unchanged?: boolean;
      rateLimitRemaining?: number;
      rateLimitResetAt?: Date | null;
    }
  | {
      ok: false;
      error: string;
      state: "not-configured" | "error";
    };

export type GithubReaderDeps = {
  /** Injection point so tests don't fetch real URLs. */
  fetchImpl?: typeof fetch;
  /** One operation timestamp, injected so every page in a sync is comparable. */
  now?: () => Date;
};

/** Resolved repo coordinates `{owner}/{repo}`. */
export type RepoIdentity = { owner: string; name: string };

export type GithubReadTransport = Readonly<{
  fetch: typeof fetch;
  close(): Promise<void>;
}>;

/**
 * Control-plane GitHub reads must not inherit Next.js' framework-patched
 * global fetch. Own the dispatcher explicitly and close it at the operation
 * boundary; callers still inject a plain Fetch implementation in tests.
 */
export function createGithubReadTransport(): GithubReadTransport {
  return createOffThreadpoolFetchTransport();
}

/** Release an unconsumed provider response before retrying or closing its dispatcher. */
export async function cancelGithubResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup cannot change the typed provider verdict already established.
  }
}

/**
 * Production GitHub PR reader. Returns the rows for the open and terminal PR list,
 * tagged with sourceKey = PR number as string. The pure runner in
 * contributor-inventory-sync.ts wraps this into a SyncSourceResult.
 */
export async function readGithubPullRequests(
  deps: GithubReaderDeps = {},
): Promise<GithubReaderResult> {
  const { prisma } = await import("@dpf/db");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const observedAt = (deps.now ?? (() => new Date()))().toISOString();

  const token = await resolveGithubToken(prisma);
  if (!token) {
    return {
      ok: false,
      error:
        "no GitHub credential bound — connect GitHub on the contributor MCP readiness card to populate PR data",
      state: "not-configured",
    };
  }

  const repo = await resolveRepoIdentity(prisma);
  const previousEtag = await loadEtag(prisma);

  try {
    const result = await fetchPullRequests(fetchImpl, repo, token, previousEtag, observedAt);
    if (result.kind === "not-modified") {
      return {
        ok: true,
        rows: [],
        unchanged: true,
        rateLimitRemaining: result.rateLimitRemaining,
        rateLimitResetAt: result.rateLimitResetAt,
      };
    }
    if (result.kind === "rows") {
      // Persist new etag if one was returned.
      if (result.etag) {
        await persistEtag(prisma, result.etag);
      }
      return {
        ok: true,
        rows: result.rows,
        unchanged: false,
        rateLimitRemaining: result.rateLimitRemaining,
        rateLimitResetAt: result.rateLimitResetAt,
      };
    }
    return {
      ok: false,
      error: result.error,
      state: "error",
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? "fetch failed",
      state: "error",
    };
  }
}

// ─── Internals ──────────────────────────────────────────────────────────────

import type { prisma } from "@dpf/db";

export type PrismaLike = Pick<
  typeof prisma,
  "credentialEntry" | "platformDevConfig" | "scheduledJob"
>;

/**
 * Credentials this reader will authenticate with, best first.
 *
 * "github-pr-sync" stays the preferred row: the disjoint-credential intent in
 * this file's header is a real one, and an install that sets it keeps a token
 * scoped to exactly this job.
 *
 * The fallbacks exist because that intent was never reachable. Nothing in the
 * product writes "github-pr-sync" — the Contributor MCP card named in the
 * header does not exist in the tree. The GitHub device flow writes
 * "hive-contribution"; the Admin > Platform Development panel writes
 * "git-backup". So this resolver returned null on every install, and every
 * caller degraded to an unauthenticated request, which against a private
 * repository fails outright (BI-69BBC446).
 *
 * That took down the whole initiative-readiness chain: no repository
 * provenance means no plan-coverage receipt, so no spec-approval baseline, so
 * no reviewer binding, so no independent design review — on an install that
 * had a perfectly good active credential sitting one row away. Preferring a
 * dedicated credential is right; being dead without one is not.
 *
 * These are read-only calls against the same repository the fallback tokens
 * already push to, so no fallback widens what the install can reach.
 */
const GITHUB_READ_CREDENTIAL_PROVIDER_IDS = [
  GITHUB_PR_CREDENTIAL_PROVIDER_ID,
  "hive-contribution",
  "git-backup",
] as const;

async function readCredential(prisma: PrismaLike, providerId: string): Promise<string | null> {
  const cred = await prisma.credentialEntry.findUnique({
    where: { providerId },
    select: { secretRef: true, status: true },
  });
  if (!cred || cred.status !== "active" || !cred.secretRef) return null;

  const stored = cred.secretRef;
  try {
    const { decryptSecret } = await import("@/lib/credential-crypto");
    // A key rotation leaves an undecryptable row: skip it and try the next
    // credential rather than reporting "no token" for a store that has one.
    return stored.startsWith("enc:") ? decryptSecret(stored) : stored;
  } catch {
    return null;
  }
}

// Exported for reuse by release-health (BI-3630773C); callers that can read
// public repos treat a null return as "proceed unauthenticated", not an error.
export async function resolveGithubToken(prisma: PrismaLike): Promise<string | null> {
  for (const providerId of GITHUB_READ_CREDENTIAL_PROVIDER_IDS) {
    const token = await readCredential(prisma, providerId);
    if (token) return token;
  }
  // Legacy env fallback, matching resolveHiveToken's chain so the two resolvers
  // cannot disagree about whether this install has GitHub access.
  return process.env.GITHUB_TOKEN ?? null;
}

// Exported for reuse by release-health (BI-3630773C).
export async function resolveRepoIdentity(prisma: PrismaLike): Promise<RepoIdentity> {
  const cfg = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { upstreamRemoteUrl: true },
  });
  if (cfg?.upstreamRemoteUrl) {
    const parsed = parseRepoFromUrl(cfg.upstreamRemoteUrl);
    if (parsed) return parsed;
  }
  return { owner: FALLBACK_REPO_OWNER, name: FALLBACK_REPO_NAME };
}

export function parseRepoFromUrl(url: string): RepoIdentity | null {
  // Accepts both https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git).
  const https = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!https) return null;
  return { owner: https[1]!, name: https[2]! };
}

async function loadEtag(prisma: PrismaLike): Promise<string | null> {
  const row = await prisma.scheduledJob.findUnique({
    where: { jobId: CONTRIBUTOR_INVENTORY_SYNC_JOB_ID },
    select: { metadata: true },
  });
  const md = (row?.metadata ?? null) as { githubPrEtag?: string } | null;
  return md?.githubPrEtag ?? null;
}

async function persistEtag(prisma: PrismaLike, etag: string): Promise<void> {
  const row = await prisma.scheduledJob.findUnique({
    where: { jobId: CONTRIBUTOR_INVENTORY_SYNC_JOB_ID },
    select: { metadata: true },
  });
  const md = (row?.metadata ?? {}) as Record<string, unknown>;
  await prisma.scheduledJob.update({
    where: { jobId: CONTRIBUTOR_INVENTORY_SYNC_JOB_ID },
    data: {
      metadata: { ...md, githubPrEtag: etag },
    },
  });
}

type FetchOutcome =
  | { kind: "rows"; rows: SnapshotRowPayload[]; etag: string | null; rateLimitRemaining?: number; rateLimitResetAt?: Date | null }
  | { kind: "not-modified"; rateLimitRemaining?: number; rateLimitResetAt?: Date | null }
  | { kind: "error"; error: string };

async function fetchPullRequests(
  fetchImpl: typeof fetch,
  repo: RepoIdentity,
  token: string,
  ifNoneMatch: string | null,
  observedAt: string,
): Promise<FetchOutcome> {
  const rows: SnapshotRowPayload[] = [];
  let etag: string | null = null;
  let rateLimitRemaining: number | undefined;
  let rateLimitResetAt: Date | null | undefined;

  for (let page = 1; page <= DEFAULT_MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls?state=all&sort=updated&direction=desc&per_page=${DEFAULT_PER_PAGE}&page=${page}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dpf-contributor-inventory-sync",
    };
    // Only send If-None-Match on the first page — subsequent pages are
    // tied to that page's own etag (which the GitHub API does support but
    // we don't store), so we just refetch them on each run.
    if (page === 1 && ifNoneMatch) {
      headers["If-None-Match"] = ifNoneMatch;
    }

    const res = await fetchImpl(url, { method: "GET", headers });

    captureRateLimit(res, (rem, reset) => {
      rateLimitRemaining = rem;
      rateLimitResetAt = reset;
    });

    if (res.status === 304 && page === 1) {
      return { kind: "not-modified", rateLimitRemaining, rateLimitResetAt };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        kind: "error",
        error: `GitHub auth failed (${res.status}) — token may be revoked or lack required scopes`,
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        kind: "error",
        error: `GitHub PR list failed: HTTP ${res.status} ${body.slice(0, 200)}`,
      };
    }

    if (page === 1) {
      etag = res.headers.get("etag");
    }

    const json = (await res.json()) as RawPullRequest[];
    for (const pr of json) {
      const parsed = parsePullRequest(pr, repo, observedAt);
      if (parsed) {
        rows.push({ sourceKey: String(parsed.number), payload: parsed });
      }
    }
    if (json.length < DEFAULT_PER_PAGE) {
      break;
    }
  }

  return { kind: "rows", rows, etag, rateLimitRemaining, rateLimitResetAt };
}

function captureRateLimit(
  res: Response,
  setter: (remaining: number | undefined, reset: Date | null) => void,
): void {
  const remainingStr = res.headers.get("x-ratelimit-remaining");
  const resetStr = res.headers.get("x-ratelimit-reset");
  // Only update when the header is actually present — otherwise a paginated
  // run would clobber the page-1 capture with the page-N response (which may
  // omit headers entirely, depending on the proxy).
  if (remainingStr === null && resetStr === null) return;
  const remaining = remainingStr !== null ? Number.parseInt(remainingStr, 10) : undefined;
  const reset =
    resetStr !== null && !Number.isNaN(Number.parseInt(resetStr, 10))
      ? new Date(Number.parseInt(resetStr, 10) * 1000)
      : null;
  setter(Number.isNaN(remaining as number) ? undefined : remaining, reset);
}

type RawPullRequest = {
  number?: number;
  url?: string;
  html_url?: string;
  title?: string;
  head?: { ref?: string; sha?: string };
  state?: string;
  draft?: boolean;
  mergeable_state?: string;
  merge_commit_sha?: string | null;
  merged_at?: string | null;
  updated_at?: string;
};

function parsePullRequest(
  pr: RawPullRequest,
  repo: RepoIdentity,
  observedAt: string,
): PullRequestSnapshot | null {
  if (
    typeof pr.number !== "number" ||
    !pr.head?.ref ||
    !pr.head.sha ||
    !pr.html_url ||
    !pr.updated_at
  ) {
    return null;
  }
  const state = normalizeState(pr);
  if (!state) return null;
  const observation = createPullRequestObservation({
    repositoryFullName: `${repo.owner}/${repo.name}`,
    number: pr.number,
    url: pr.html_url,
    title: pr.title ?? "",
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    state,
    isDraft: pr.draft === true,
    mergeStateStatus: pr.mergeable_state ?? null,
    mergeCommitSha: state === "merged" ? pr.merge_commit_sha ?? null : null,
    mergedAt: state === "merged" ? pr.merged_at ?? null : null,
    providerUpdatedAt: pr.updated_at,
    observedAt,
  });
  return parseVerifiedPullRequestObservation(observation);
}

function normalizeState(pr: RawPullRequest): PullRequestSnapshot["state"] | null {
  if (pr.merged_at) return "merged";
  if (pr.state === "open") return "open";
  if (pr.state === "closed") return "closed";
  return null;
}
