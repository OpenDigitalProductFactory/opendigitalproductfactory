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

import { parseGitHubRepositoryUrl } from "@/lib/forge/github-adapter";

/** The canonical public DPF upstream — the public hive of last resort. */
export const CANONICAL_UPSTREAM_OWNER = "OpenDigitalProductFactory";
export const CANONICAL_UPSTREAM_REPO = "opendigitalproductfactory";

export type EgressTarget = "public-hive" | "own-repo";

export interface RepoCoords {
  owner: string;
  repo: string;
}

export const HIVE_RESULT_BUNDLE_SCHEMA_VERSION = "dpf.hive-result/1" as const;

const HIVE_RESULT_ALLOWED_TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "result",
  "evidence",
  "provenance",
  "attribution",
  "review",
  "disposition",
  "sourceReceipt",
]);

const HIVE_RESULT_FORBIDDEN_FIELD = /(backlog|workcapsule|featurebuild|buildplan|priority|estimate|discussion|roadmap|customercontext|customername|customerid|localrecord|localdatabase|dbid)/i;

export interface HiveResultProjection {
  projected: Record<string, unknown>;
  violations: string[];
}

function normalizePayloadKey(key: string): string {
  return key.replace(/[_\-\s]/g, "").toLowerCase();
}

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectResultValue(value: unknown, path: string, violations: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => projectResultValue(item, `${path}[${index}]`, violations));
  }
  if (!isPayloadRecord(value)) return value;

  const projected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (HIVE_RESULT_FORBIDDEN_FIELD.test(normalizePayloadKey(key))) {
      violations.push(`forbidden-field:${childPath}`);
      continue;
    }
    projected[key] = projectResultValue(child, childPath, violations);
  }
  return projected;
}

/**
 * Build the only payload shape permitted across the public Hive result channel.
 * Unknown top-level domains and source-local planning fields are fail-visible
 * and removed before a caller can serialize the projection.
 */
export function projectHiveResultBundle(payload: Record<string, unknown>): HiveResultProjection {
  const violations: string[] = [];
  const projected: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!HIVE_RESULT_ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
      violations.push(`non-allowed-field:${key}`);
      continue;
    }
    projected[key] = projectResultValue(value, key, violations);
  }
  if (projected.schemaVersion !== HIVE_RESULT_BUNDLE_SCHEMA_VERSION) {
    violations.push("schemaVersion:unsupported");
  }
  return { projected, violations };
}

/** Parse owner/repo from a GitHub HTTPS or SSH remote URL. */
export function parseRepoCoords(url: string | null | undefined): RepoCoords | null {
  const parsed = parseGitHubRepositoryUrl(url);
  return parsed ? { owner: parsed.owner, repo: parsed.repo } : null;
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
