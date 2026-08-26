// BI-BB919901 — what the current release actually publishes for the edge agent.
//
// The portal must never offer a download that 404s, and it must never withhold
// one that exists. Both failures come from the same root cause: believing a
// hardcoded list instead of asking. So this asks GitHub, and treats every
// failure as "offer nothing extra" rather than as an error.
//
// Deliberately NOT a hardcoded asset list. The previous implementation encoded
// "the native binary is not published yet" in a comment; publish-release.yml
// started attaching the binaries and the comment stayed, so the portal withheld
// a download that had existed for weeks.

import type { NativeReleaseAssets } from "@/lib/edge-node/remote-provisioning";
import { DEFAULT_REPO_SLUG } from "@/lib/edge-node/remote-provisioning";

/** Cache TTL. A release's asset list does not change after publication; this
 *  only bounds how long a NEW release takes to become offerable. */
const CACHE_TTL_MS = 10 * 60 * 1000;

let cached: { at: number; value: NativeReleaseAssets | null } | null = null;

interface GitHubReleaseResponse {
  tag_name?: unknown;
  assets?: unknown;
}

/** Parse the fields we need, tolerating anything else the API returns. */
export function parseReleaseAssets(
  body: unknown,
  repoSlug: string,
): NativeReleaseAssets | null {
  if (!body || typeof body !== "object") return null;
  const release = body as GitHubReleaseResponse;
  const tag = release.tag_name;
  if (typeof tag !== "string" || tag.trim().length === 0) return null;
  if (!Array.isArray(release.assets)) return null;

  const assetNames = release.assets
    .map((asset) =>
      asset && typeof asset === "object" ? (asset as { name?: unknown }).name : null,
    )
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  return { tag: tag.trim(), assetNames, repoSlug };
}

/**
 * Resolve the latest release's assets, or null.
 *
 * Null is a first-class answer, not an error: an air-gapped install, a rate
 * limit, a network failure, or a release with no attachments all mean the same
 * thing to the caller — render the container path only. Nothing here throws, and
 * nothing here blocks token issuance.
 */
export async function resolveNativeReleaseAssets(options: {
  repoSlug?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Bypass the cache; used by tests. */
  skipCache?: boolean;
} = {}): Promise<NativeReleaseAssets | null> {
  const now = options.now ?? Date.now;
  if (!options.skipCache && cached && now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const repoSlug = options.repoSlug?.trim() || DEFAULT_REPO_SLUG;
  const fetchImpl = options.fetchImpl ?? fetch;

  let value: NativeReleaseAssets | null = null;
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repoSlug}/releases/latest`,
      {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (response.ok) {
      value = parseReleaseAssets(await response.json(), repoSlug);
    }
  } catch {
    // Offline, rate-limited, timed out, or malformed — all mean "offer nothing
    // extra". An install with no internet is a supported topology, not a fault.
    value = null;
  }

  if (!options.skipCache) cached = { at: now(), value };
  return value;
}

/** Test seam: drop the memoized release so the next call re-resolves. */
export function resetNativeReleaseAssetsCache(): void {
  cached = null;
}
