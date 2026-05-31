// apps/web/lib/self-upgrade/impact/pr-enrich.ts
//
// Best-effort GitHub PR enrichment for the impact summary. The pipeline
// degrades gracefully when GitHub is unreachable — operators without a
// `GITHUB_TOKEN` or network access still get a usable summary built from
// commit subjects + file stats; this layer only adds PR title / labels /
// truncated body when the upstream repo is reachable.
//
// Repo coords come from the `REPO_OWNER` / `REPO_NAME` env vars (defaulting
// to the published DPF coordinates on docker-compose). Auth comes from
// `GITHUB_TOKEN` (optional; unauthenticated calls work for the public repo
// but at 60/h rate limit — we cap PR lookups accordingly).

import type { PrEnrichment } from "./types";

const DEFAULT_REPO_OWNER = "OpenDigitalProductFactory";
const DEFAULT_REPO_NAME = "opendigitalproductfactory";
const MAX_PRS_TO_ENRICH = 30; // bounded for rate-limit safety.
const BODY_TRUNCATE = 400;
const FETCH_TIMEOUT_MS = 4000;

export type PrEnrichmentDeps = {
  fetcher?: typeof fetch;
};

type GhPullResponse = {
  title?: string;
  body?: string | null;
  labels?: Array<{ name?: string }>;
};

async function fetchPr(
  prNumber: number,
  owner: string,
  repo: string,
  token: string | undefined,
  fetcher: typeof fetch,
): Promise<PrEnrichment | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const resp = await fetcher(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      { headers, signal: controller.signal },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as GhPullResponse;
    const labels = Array.isArray(data.labels)
      ? data.labels
          .map((l) => (typeof l?.name === "string" ? l.name.toLowerCase() : null))
          .filter((n): n is string => !!n)
      : [];
    const body =
      typeof data.body === "string" && data.body.length > 0
        ? data.body.slice(0, BODY_TRUNCATE)
        : null;
    return {
      prNumber,
      title: typeof data.title === "string" ? data.title : null,
      labels,
      body,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type PrEnrichmentResult = {
  /** Whether at least one PR fetch succeeded — gates UI provenance line. */
  reachable: boolean;
  /** Number of PRs successfully enriched. */
  enriched: number;
  byPr: Map<number, PrEnrichment>;
};

/**
 * Enrich up to N unique PR numbers. Best-effort: failures and missing tokens
 * silently degrade the summary to commit-subject mode.
 */
export async function enrichPrs(
  prNumbers: number[],
  deps: PrEnrichmentDeps = {},
): Promise<PrEnrichmentResult> {
  const result: PrEnrichmentResult = {
    reachable: false,
    enriched: 0,
    byPr: new Map(),
  };

  const unique = Array.from(new Set(prNumbers.filter((n) => Number.isFinite(n) && n > 0)));
  if (unique.length === 0) return result;

  const fetcher = deps.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") return result;

  const owner = process.env["REPO_OWNER"] ?? DEFAULT_REPO_OWNER;
  const repo = process.env["REPO_NAME"] ?? DEFAULT_REPO_NAME;
  const token = process.env["GITHUB_TOKEN"];

  const capped = unique.slice(0, MAX_PRS_TO_ENRICH);
  // Sequential — we explicitly do NOT parallelize so a flaky network or rate
  // limit can't burst the cap. PR enrichment is non-critical; one cold
  // request per ~30ms over 30 PRs is well under the timeout budget for the
  // operator click.
  for (const pr of capped) {
    const enriched = await fetchPr(pr, owner, repo, token, fetcher);
    if (enriched) {
      result.reachable = true;
      result.enriched += 1;
      result.byPr.set(pr, enriched);
    }
  }
  return result;
}
