/**
 * Upstream issue READER (BI-F47386ED).
 *
 * Before this module the platform could only ever POST an issue: the forge
 * adapter's single `/issues` URL was write-only, so nothing an install
 * submitted could ever be read back and the inbound half of the ecosystem loop
 * did not exist. This is that half.
 *
 * Deliberately reuses the existing GitHub read plumbing — token resolution,
 * repo identity and the off-threadpool transport — rather than standing up a
 * second GitHub client. Only the endpoint and the parsing are new.
 */

import {
  createGithubReadTransport,
  resolveGithubToken,
  resolveRepoIdentity,
  type PrismaLike,
  type RepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PER_PAGE = 100;

export interface UpstreamIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export type UpstreamIssueReadResult =
  | { ok: true; issues: UpstreamIssue[] }
  | { ok: false; state: "not-configured" | "error"; error: string };

export interface UpstreamIssueReaderDeps {
  fetchImpl?: typeof fetch;
  prisma?: PrismaLike;
  repo?: RepoIdentity;
  token?: string | null;
  /** Issue states to read. Default "all" so a closed item can still be reconciled. */
  state?: "open" | "closed" | "all";
  /** Only issues updated at or after this instant, so a sweep is incremental. */
  since?: Date | null;
  maxPages?: number;
}

interface RawIssue {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  html_url?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  labels?: unknown;
  /** GitHub returns PULL REQUESTS from the issues endpoint; this key marks them. */
  pull_request?: unknown;
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((label) => {
      if (typeof label === "string") return label;
      if (label && typeof label === "object" && typeof (label as { name?: unknown }).name === "string") {
        return (label as { name: string }).name;
      }
      return null;
    })
    .filter((name): name is string => Boolean(name));
}

/**
 * Normalize one raw issue, or null when it must be skipped.
 *
 * GitHub's issues endpoint returns pull requests as well — every PR is an issue
 * in that API — so an unfiltered read would ingest the project's own pull
 * requests as if they were ecosystem submissions. The `pull_request` key is the
 * documented discriminator.
 */
export function parseUpstreamIssue(raw: RawIssue): UpstreamIssue | null {
  if (raw.pull_request !== undefined && raw.pull_request !== null) return null;
  if (typeof raw.number !== "number" || !Number.isFinite(raw.number)) return null;
  if (typeof raw.title !== "string" || !raw.title.trim()) return null;
  return {
    number: raw.number,
    title: raw.title,
    body: typeof raw.body === "string" ? raw.body : null,
    state: typeof raw.state === "string" ? raw.state : "open",
    labels: labelNames(raw.labels),
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : "",
    createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : "",
  };
}

export async function readUpstreamIssues(
  deps: UpstreamIssueReaderDeps = {},
): Promise<UpstreamIssueReadResult> {
  const prisma = deps.prisma ?? ((await import("@dpf/db")).prisma as unknown as PrismaLike);
  const token = deps.token !== undefined ? deps.token : await resolveGithubToken(prisma);
  if (!token) {
    return {
      ok: false,
      state: "not-configured",
      error: "No GitHub token available — upstream issues cannot be read on this install.",
    };
  }
  const repo = deps.repo ?? (await resolveRepoIdentity(prisma));

  // Own the dispatcher explicitly, exactly as the PR reader does, so a
  // control-plane read never inherits the framework-patched global fetch.
  const transport = deps.fetchImpl ? null : createGithubReadTransport();
  const fetchImpl = deps.fetchImpl ?? transport!.fetch;
  try {
    return await fetchIssues(fetchImpl, repo, token, deps);
  } finally {
    await transport?.close();
  }
}

async function fetchIssues(
  fetchImpl: typeof fetch,
  repo: RepoIdentity,
  token: string,
  deps: UpstreamIssueReaderDeps,
): Promise<UpstreamIssueReadResult> {
  const issues: UpstreamIssue[] = [];
  const state = deps.state ?? "all";
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const since = deps.since ? `&since=${encodeURIComponent(deps.since.toISOString())}` : "";

  for (let page = 1; page <= maxPages; page++) {
    const url =
      `https://api.github.com/repos/${repo.owner}/${repo.name}/issues`
      + `?state=${state}&sort=updated&direction=desc&per_page=${DEFAULT_PER_PAGE}&page=${page}${since}`;

    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dpf-ecosystem-inbound-triage",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        state: "error",
        error: `GitHub auth failed (${res.status}) — token may be revoked or lack required scopes`,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, state: "error", error: `GitHub issue list failed: HTTP ${res.status} ${body.slice(0, 200)}` };
    }

    const json = (await res.json()) as RawIssue[];
    if (!Array.isArray(json)) {
      return { ok: false, state: "error", error: "GitHub issue list returned a non-array body" };
    }
    for (const raw of json) {
      const parsed = parseUpstreamIssue(raw);
      if (parsed) issues.push(parsed);
    }
    // Page on the RAW length: a page that is all pull requests still means
    // there may be more pages, and stopping on the filtered count would
    // silently truncate the sweep.
    if (json.length < DEFAULT_PER_PAGE) break;
  }

  return { ok: true, issues };
}
