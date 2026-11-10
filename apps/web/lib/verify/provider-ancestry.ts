import { prisma } from "@dpf/db";

import {
  resolveGithubToken,
  resolveRepoIdentity,
  type RepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";
import { assertSafeOutboundUrl } from "@/lib/security/safe-fetch";

const GITHUB_API_HOST = "api.github.com";
const PROVIDER_DEADLINE_MS = 5_000;
const FULL_GIT_SHA = /^[a-f0-9]{40}$/i;

type GithubResolverDb = Parameters<typeof resolveGithubToken>[0];

export type ProviderAncestryDeps = {
  fetchImpl: typeof fetch;
  resolveRepository: () => Promise<RepoIdentity>;
  resolveToken: () => Promise<string | null>;
  timeoutSignal: (milliseconds: number) => AbortSignal;
};

const defaultDeps: ProviderAncestryDeps = {
  fetchImpl: fetch,
  resolveRepository: () => resolveRepoIdentity(prisma as unknown as GithubResolverDb),
  resolveToken: () => resolveGithubToken(prisma as unknown as GithubResolverDb),
  timeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
};

type CompareStatus = "ahead" | "identical" | "behind" | "diverged";

function parseCompareStatus(payload: unknown): CompareStatus | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const status = (payload as Record<string, unknown>).status;
  return status === "ahead"
      || status === "identical"
      || status === "behind"
      || status === "diverged"
    ? status
    : null;
}

/**
 * Resolve feature containment through the canonical GitHub repository when a
 * validated consumer has no local Git object store. This is a bounded,
 * side-effect-free fallback: any provider/configuration failure returns null.
 */
export async function resolveProviderAncestry(
  featureSha: string,
  servedSha: string,
  deps: ProviderAncestryDeps = defaultDeps,
): Promise<boolean | null> {
  if (!FULL_GIT_SHA.test(featureSha) || !FULL_GIT_SHA.test(servedSha)) return null;

  try {
    const [repo, token] = await Promise.all([
      deps.resolveRepository(),
      deps.resolveToken(),
    ]);
    const compareUrl = assertSafeOutboundUrl(
      `https://${GITHUB_API_HOST}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/compare/${encodeURIComponent(featureSha)}...${encodeURIComponent(servedSha)}`,
      { allowedHosts: [GITHUB_API_HOST] },
    );
    const response = await deps.fetchImpl(compareUrl.href, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dpf-live-verification-preflight",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      signal: deps.timeoutSignal(PROVIDER_DEADLINE_MS),
    });
    if (!response.ok) return null;

    const status = parseCompareStatus(await response.json());
    if (status === "ahead" || status === "identical") return true;
    if (status === "behind" || status === "diverged") return false;
    return null;
  } catch {
    return null;
  }
}
