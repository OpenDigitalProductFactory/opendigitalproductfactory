// apps/web/lib/release-health/state.ts
// BI-3630773C — last-known release verification state.
//
// PlatformConfig key-value row (same pattern as self_upgrade.lastCheckedAt
// in lib/self-upgrade/last-check.ts): the state is one small JSON blob, the
// health card reads it server-side, and it survives portal restarts without
// a dedicated model or migration.

import type { ReleaseInstallContext } from "@/lib/self-upgrade/release-target";
import {
  RELEASE_IMAGE_TAG,
  type RegistryReleaseCandidate,
} from "@/lib/self-upgrade/registry-release";
import type { ReleaseStampSnapshot } from "./release-runs-reader";

const RELEASE_HEALTH_CONFIG_KEY = "release_health.latest";
const SHA_256 = /^sha256:[a-f0-9]{64}$/;
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const REGISTRY_OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const OCI_TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export const VERIFIED_RELEASE_TARGET_MAX_AGE_MS = 30 * 60 * 1_000;

export type VerifiedReleaseTargetEvidence = {
  schemaVersion: 1;
  publisherRunId: number;
  verifiedAt: string;
  ghcrOwner: string;
  channelTag: string;
  installMode: ReleaseInstallContext["installMode"];
  installedImageTag: string;
  currentConfigDigest: string;
  candidate: RegistryReleaseCandidate;
};

export type ReleaseHealthState = {
  /** Latest observed stamp, or null when the repo has never been stamped. */
  snapshot: ReleaseStampSnapshot | null;
  /** ISO timestamp of the last successful poll. */
  checkedAt: string;
  /** Run id an open red-stamp notification was written for (alert dedupe). */
  notifiedRunId: number | null;
  /**
   * Registry proof captured only after live discovery agrees with this exact
   * verified publisher snapshot. It is a bounded fallback, not a second
   * release-health source of truth.
   */
  verifiedTarget?: VerifiedReleaseTargetEvidence | null;
};

function parseReleaseHealthState(value: unknown): ReleaseHealthState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  if (typeof state.checkedAt !== "string") return null;
  return {
    snapshot: (state.snapshot ?? null) as ReleaseStampSnapshot | null,
    checkedAt: state.checkedAt,
    notifiedRunId: typeof state.notifiedRunId === "number" ? state.notifiedRunId : null,
    verifiedTarget: (state.verifiedTarget ?? null) as VerifiedReleaseTargetEvidence | null,
  };
}

export async function loadReleaseHealthState(): Promise<ReleaseHealthState | null> {
  const { prisma } = await import("@dpf/db");
  const row = await prisma.platformConfig.findUnique({
    where: { key: RELEASE_HEALTH_CONFIG_KEY },
  });
  return parseReleaseHealthState(row?.value);
}

function runtimeArchitecture(architecture: string = process.arch): string {
  return architecture === "x64" ? "amd64" : architecture;
}

function freshTimestamp(value: unknown, now: Date): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = now.getTime() - timestamp;
  return age >= 0 && age <= VERIFIED_RELEASE_TARGET_MAX_AGE_MS;
}

function validCandidate(value: unknown): value is RegistryReleaseCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tag === "string" &&
    RELEASE_IMAGE_TAG.test(candidate.tag) &&
    typeof candidate.sourceSha === "string" &&
    SOURCE_SHA.test(candidate.sourceSha) &&
    typeof candidate.channelDigest === "string" &&
    SHA_256.test(candidate.channelDigest) &&
    typeof candidate.platformManifestDigest === "string" &&
    SHA_256.test(candidate.platformManifestDigest) &&
    typeof candidate.configDigest === "string" &&
    SHA_256.test(candidate.configDigest) &&
    candidate.platformOs === "linux" &&
    typeof candidate.platformArchitecture === "string" &&
    candidate.platformArchitecture.length > 0
  );
}

function verifiedPublisherMatches(
  state: ReleaseHealthState,
  candidate: RegistryReleaseCandidate,
  now: Date,
): boolean {
  const snapshot = state.snapshot;
  return Boolean(
    snapshot &&
      snapshot.status === "verified" &&
      snapshot.runConclusion === "success" &&
      Number.isSafeInteger(snapshot.runId) &&
      snapshot.runId > 0 &&
      snapshot.tag === candidate.tag &&
      snapshot.headSha?.toLowerCase() === candidate.sourceSha.toLowerCase() &&
      freshTimestamp(state.checkedAt, now),
  );
}

function evidenceMatches(input: {
  state: ReleaseHealthState;
  context: ReleaseInstallContext;
  currentConfigDigest: string;
  now: Date;
  platformArchitecture: string;
}): input is typeof input & { state: ReleaseHealthState & { verifiedTarget: VerifiedReleaseTargetEvidence } } {
  const evidence = input.state.verifiedTarget;
  if (!evidence || typeof evidence !== "object" || evidence.schemaVersion !== 1) return false;
  if (!validCandidate(evidence.candidate)) return false;
  if (!verifiedPublisherMatches(input.state, evidence.candidate, input.now)) return false;
  return (
    evidence.publisherRunId === input.state.snapshot?.runId &&
    freshTimestamp(evidence.verifiedAt, input.now) &&
    REGISTRY_OWNER.test(evidence.ghcrOwner) &&
    OCI_TAG.test(evidence.channelTag) &&
    evidence.ghcrOwner.toLowerCase() === input.context.ghcrOwner.toLowerCase() &&
    evidence.channelTag === input.context.channelTag &&
    evidence.installMode === input.context.installMode &&
    evidence.installedImageTag === input.context.imageTag &&
    SHA_256.test(evidence.currentConfigDigest) &&
    evidence.currentConfigDigest === input.currentConfigDigest.toLowerCase() &&
    evidence.candidate.platformArchitecture === input.platformArchitecture
  );
}

export async function loadVerifiedReleaseTargetEvidence(input: {
  context: ReleaseInstallContext;
  currentConfigDigest: string;
  now?: Date;
  platformArchitecture?: string;
}): Promise<RegistryReleaseCandidate | null> {
  if (!SHA_256.test(input.currentConfigDigest)) return null;
  const state = await loadReleaseHealthState();
  if (!state) return null;
  const normalized = {
    ...input,
    state,
    now: input.now ?? new Date(),
    platformArchitecture: runtimeArchitecture(input.platformArchitecture),
    currentConfigDigest: input.currentConfigDigest.toLowerCase(),
  };
  return evidenceMatches(normalized) ? normalized.state.verifiedTarget.candidate : null;
}

/**
 * Attach a registry candidate to the already-persisted verified publisher
 * snapshot. Serializable isolation prevents a concurrent health poll from
 * being overwritten by an older page-time observation.
 */
export async function recordVerifiedReleaseTargetEvidence(input: {
  candidate: RegistryReleaseCandidate;
  context: ReleaseInstallContext;
  currentConfigDigest: string;
  now?: Date;
}): Promise<boolean> {
  if (!validCandidate(input.candidate) || !SHA_256.test(input.currentConfigDigest)) return false;
  if (!REGISTRY_OWNER.test(input.context.ghcrOwner) || !OCI_TAG.test(input.context.channelTag)) {
    return false;
  }
  const now = input.now ?? new Date();
  const { prisma } = await import("@dpf/db");
  return prisma.$transaction(async (tx) => {
    const row = await tx.platformConfig.findUnique({
      where: { key: RELEASE_HEALTH_CONFIG_KEY },
    });
    const state = parseReleaseHealthState(row?.value);
    if (!state || !verifiedPublisherMatches(state, input.candidate, now)) return false;
    const value: ReleaseHealthState = {
      ...state,
      verifiedTarget: {
        schemaVersion: 1,
        publisherRunId: state.snapshot!.runId,
        verifiedAt: now.toISOString(),
        ghcrOwner: input.context.ghcrOwner.toLowerCase(),
        channelTag: input.context.channelTag,
        installMode: input.context.installMode,
        installedImageTag: input.context.imageTag,
        currentConfigDigest: input.currentConfigDigest.toLowerCase(),
        candidate: input.candidate,
      },
    };
    await tx.platformConfig.update({
      where: { key: RELEASE_HEALTH_CONFIG_KEY },
      data: { value: value as unknown as object },
    });
    return true;
  }, { isolationLevel: "Serializable" });
}

export async function saveReleaseHealthState(state: ReleaseHealthState): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const value = state as unknown as object;
  await prisma.platformConfig.upsert({
    where: { key: RELEASE_HEALTH_CONFIG_KEY },
    update: { value },
    create: { key: RELEASE_HEALTH_CONFIG_KEY, value },
  });
}
