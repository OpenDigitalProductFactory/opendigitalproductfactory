/**
 * Contribution egress classification — Private/Public Change Segregation.
 * Spec: docs/superpowers/specs/2026-06-19-hive-contribution-architecture-and-egress-model.md
 *
 * The private/public boundary applies at PUBLIC-HIVE egress only. A PR to the
 * install's OWN repo is its private home and must keep the full diff (incl.
 * proprietary paths); a PR to the public upstream hive is gated by disposition
 * and private-paths stripping.
 *
 * `create_portal_pr` resolves its target from the local git remote first and
 * silently falls back to the public upstream, so the publicness of its target
 * varies at runtime — the boundary must key off the resolved target, not the
 * tool that produced it.
 */

/** The canonical public DPF upstream — the public hive of last resort. */
export const CANONICAL_UPSTREAM_OWNER = "OpenDigitalProductFactory";
export const CANONICAL_UPSTREAM_REPO = "opendigitalproductfactory";

export type EgressTarget = "public-hive" | "own-repo";

export interface RepoCoords {
  owner: string;
  repo: string;
}

/** Parse owner/repo from a GitHub HTTPS or SSH remote URL. */
export function parseRepoCoords(url: string | null | undefined): RepoCoords | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Classify a resolved PR target as the public hive or the install's own repo.
 *
 * A target is the public hive when it matches the configured
 * `upstreamRemoteUrl`, OR the canonical DPF upstream (so a customer who left
 * the default never silently leaks proprietary work to it). Everything else is
 * the install's own repo — unfiltered, its private home.
 */
export function classifyEgress(
  target: RepoCoords,
  upstreamRemoteUrl: string | null | undefined,
): EgressTarget {
  const configured = parseRepoCoords(upstreamRemoteUrl);
  if (configured && eq(target.owner, configured.owner) && eq(target.repo, configured.repo)) {
    return "public-hive";
  }
  if (eq(target.owner, CANONICAL_UPSTREAM_OWNER) && eq(target.repo, CANONICAL_UPSTREAM_REPO)) {
    return "public-hive";
  }
  return "own-repo";
}
