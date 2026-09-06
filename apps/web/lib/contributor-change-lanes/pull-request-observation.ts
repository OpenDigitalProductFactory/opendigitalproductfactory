import { createHash } from "node:crypto";

export const PULL_REQUEST_OBSERVATION_VERSION = "github-rest/2022-11-28" as const;

export type PullRequestObservation = {
  repositoryFullName: string;
  number: number;
  url: string;
  title: string;
  headBranch: string;
  headSha: string;
  state: "open" | "merged" | "closed";
  isDraft: boolean;
  mergeStateStatus: string | null;
  mergeCommitSha: string | null;
  mergedAt: string | null;
  providerUpdatedAt: string;
  observedAt: string;
  providerApiVersion: typeof PULL_REQUEST_OBSERVATION_VERSION;
  observationFingerprint: string;
};

export type PullRequestObservationInput = Omit<
  PullRequestObservation,
  "providerApiVersion" | "observationFingerprint"
>;

export type PullRequestObservationIdentity = {
  repositoryFullName: string;
  pullRequestNumber: number;
  headSha: string;
};

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/;

function canonicalFingerprintPayload(
  value: Omit<PullRequestObservation, "observationFingerprint" | "observedAt">,
): string {
  return JSON.stringify({
    providerApiVersion: value.providerApiVersion,
    repositoryFullName: value.repositoryFullName,
    number: value.number,
    url: value.url,
    title: value.title,
    headBranch: value.headBranch,
    headSha: value.headSha.toLowerCase(),
    state: value.state,
    isDraft: value.isDraft,
    mergeStateStatus: value.mergeStateStatus,
    mergeCommitSha: value.mergeCommitSha?.toLowerCase() ?? null,
    mergedAt: value.mergedAt,
    providerUpdatedAt: value.providerUpdatedAt,
  });
}

function fingerprint(
  value: Omit<PullRequestObservation, "observationFingerprint" | "observedAt">,
): string {
  return createHash("sha256").update(canonicalFingerprintPayload(value), "utf8").digest("hex");
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasMatchingPullRequestUrl(
  url: string,
  repositoryFullName: string,
  number: number,
): boolean {
  return url.toLowerCase() === `https://github.com/${repositoryFullName}/pull/${number}`.toLowerCase();
}

/**
 * Build the authenticated provider fact stored by the GitHub inventory reader.
 * The fingerprint intentionally excludes observedAt: two polls that see the same
 * provider state are duplicates, while providerUpdatedAt changes with real state.
 */
export function createPullRequestObservation(
  input: PullRequestObservationInput,
): PullRequestObservation {
  const withoutFingerprint = {
    ...input,
    providerApiVersion: PULL_REQUEST_OBSERVATION_VERSION,
  };
  return {
    ...withoutFingerprint,
    observationFingerprint: fingerprint(withoutFingerprint),
  };
}

/**
 * Verify a stored provider payload before it can influence Workroom lifecycle.
 * Legacy and partially populated snapshots remain visible as inventory history,
 * but they are not authority for either "open" or "delivered" classification.
 */
export function parseVerifiedPullRequestObservation(
  value: unknown,
): PullRequestObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.providerApiVersion !== PULL_REQUEST_OBSERVATION_VERSION ||
    typeof row.repositoryFullName !== "string" ||
    !REPOSITORY_PATTERN.test(row.repositoryFullName) ||
    typeof row.number !== "number" ||
    !Number.isSafeInteger(row.number) ||
    row.number <= 0 ||
    typeof row.url !== "string" ||
    !hasMatchingPullRequestUrl(row.url, row.repositoryFullName, row.number) ||
    typeof row.title !== "string" ||
    typeof row.headBranch !== "string" ||
    row.headBranch.length === 0 ||
    typeof row.headSha !== "string" ||
    !SHA_PATTERN.test(row.headSha) ||
    !["open", "merged", "closed"].includes(String(row.state)) ||
    typeof row.isDraft !== "boolean" ||
    !isNullableString(row.mergeStateStatus) ||
    !isNullableString(row.mergeCommitSha) ||
    (row.mergeCommitSha !== null && !SHA_PATTERN.test(row.mergeCommitSha)) ||
    !(row.mergedAt === null || isIsoTimestamp(row.mergedAt)) ||
    !isIsoTimestamp(row.providerUpdatedAt) ||
    !isIsoTimestamp(row.observedAt) ||
    typeof row.observationFingerprint !== "string" ||
    !FINGERPRINT_PATTERN.test(row.observationFingerprint)
  ) {
    return null;
  }
  const parsed = row as PullRequestObservation;
  if (
    (parsed.state === "merged" &&
      (parsed.mergedAt === null || parsed.mergeCommitSha === null)) ||
    (parsed.state !== "merged" &&
      (parsed.mergedAt !== null || parsed.mergeCommitSha !== null))
  ) {
    return null;
  }
  const expected = fingerprint(parsed);
  return expected === parsed.observationFingerprint ? parsed : null;
}

function compareNewest(a: PullRequestObservation, b: PullRequestObservation): number {
  const providerDelta = Date.parse(a.providerUpdatedAt) - Date.parse(b.providerUpdatedAt);
  if (providerDelta !== 0) return providerDelta;
  const observationDelta = Date.parse(a.observedAt) - Date.parse(b.observedAt);
  if (observationDelta !== 0) return observationDelta;
  return a.observationFingerprint.localeCompare(b.observationFingerprint);
}

/**
 * Select one exact provider fact without letting a late/out-of-order open event
 * undo a merge already observed for the same repository, PR, and authored head.
 */
export function selectLatestExactPullRequestObservation(
  payloads: readonly unknown[],
  identity: PullRequestObservationIdentity,
): PullRequestObservation | null {
  const matching = payloads
    .map(parseVerifiedPullRequestObservation)
    .filter((row): row is PullRequestObservation => Boolean(row))
    .filter(
      (row) =>
        row.repositoryFullName.toLowerCase() === identity.repositoryFullName.toLowerCase() &&
        row.number === identity.pullRequestNumber &&
        row.headSha.toLowerCase() === identity.headSha.toLowerCase(),
    );
  const merged = matching.filter((row) => row.state === "merged");
  const candidates = merged.length > 0 ? merged : matching;
  return candidates.sort(compareNewest).at(-1) ?? null;
}
