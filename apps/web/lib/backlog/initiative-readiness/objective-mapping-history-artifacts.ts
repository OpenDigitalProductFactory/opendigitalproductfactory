import { repoBlobArtifactRef, immutableArtifactIdentity, type InitiativeReviewArtifactRef } from "@/lib/mcp-task-review-contract";
import { objectiveMappingHistoricalProviderProofDigest, type ObjectiveMappingRequestHistory } from "@/lib/mcp-task-objective-mapping-request-key";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import type { BaselinePayload, TerminalRecoveryPorts, TerminalRecoveryRoom } from "./terminal-recovery";
import type { readRepositoryProviderBlob } from "./repository-artifact";
function baselineAncestors(
  rows: readonly BaselinePayload[],
  head: BaselinePayload,
): Map<string, BaselinePayload> {
  const byId = new Map(rows.map((row) => [row.baselineId, row]));
  const ancestors = new Map<string, BaselinePayload>();
  const visited = new Set<string>([head.baselineId]);
  let cursor = head.supersedesBaselineId;
  while (cursor) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const row = byId.get(cursor);
    if (!row) break;
    ancestors.set(cursor, row);
    cursor = row.supersedesBaselineId;
  }
  return ancestors;
}

type HistoricalRepoBlobArtifact = Extract<ObjectiveMappingRequestHistory["binding"]["artifactRef"], { kind: "repo-blob-at-commit" }>;

function sameRepositoryPath(
  left: HistoricalRepoBlobArtifact,
  right: HistoricalRepoBlobArtifact,
): boolean {
  return left.repositoryFullName.toLowerCase() === right.repositoryFullName.toLowerCase()
    && left.path === right.path;
}

export function exactArtifactRefMatches(
  left: NonNullable<BaselinePayload["artifactRef"]>,
  right: InitiativeReviewArtifactRef,
): boolean {
  const a = immutableArtifactIdentity(left);
  const b = immutableArtifactIdentity(right);
  return left.kind === right.kind
    && a.repositoryFullName.toLowerCase() === b.repositoryFullName.toLowerCase()
    && a.version.toLowerCase() === b.version.toLowerCase()
    && a.path === b.path && a.expectedBlobId.toLowerCase() === b.expectedBlobId.toLowerCase();
}

export function exactStringSetMatches(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left.map((entry) => entry.trim()))].sort();
  const normalizedRight = [...new Set(right.map((entry) => entry.trim()))].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((entry, index) => entry === normalizedRight[index]);
}

export async function classifyHistoricalObjectiveMappingArtifacts(args: {
  history: readonly ObjectiveMappingRequestHistory[];
  baselineRows: readonly BaselinePayload[];
  currentBaseline: BaselinePayload;
  currentArtifact: {
    repositoryFullName: string;
    path: string;
  };
  currentEvidenceActivityIds?: readonly string[];
  room: TerminalRecoveryRoom & {
    repositoryFullName: string;
    headSha: string;
  };
  verify: TerminalRecoveryPorts["verifyHistoricalArtifact"];
}): Promise<ActionResult<{
  history: ObjectiveMappingRequestHistory[];
  providerProvenImpossibleTaskRunProofs: ReadonlyMap<string, string>;
  serverProvenStaleBodyTaskRunProofs: ReadonlyMap<string, string>;
}>> {
  const ancestors = baselineAncestors(args.baselineRows, args.currentBaseline);
  const verificationByLocator = new Map<string, Awaited<ReturnType<typeof readRepositoryProviderBlob>>>();
  const classified: ObjectiveMappingRequestHistory[] = [];
  const providerProvenImpossibleTaskRunProofs = new Map<string, string>();
  const serverProvenStaleBodyTaskRunProofs = new Map<string, string>();

  for (const historical of args.history) {
    const baselineId = historical.binding.expectedCurrentBaselineId;
    const ancestor = typeof baselineId === "string" ? ancestors.get(baselineId) : undefined;
    const bodyVersion = ancestor ?? (baselineId === args.currentBaseline.baselineId ? args.currentBaseline : undefined);
    if (historical.binding.workroomRef && historical.binding.eligibleEvidenceActivityIds
      && args.currentBaseline.origin === "item-body" && bodyVersion?.origin === "item-body"
      && bodyVersion.artifactRef?.kind === "document-version" && historical.binding.artifactRef.kind === "document-version"
      && exactArtifactRefMatches(bodyVersion.artifactRef, historical.binding.artifactRef)
      && (ancestor || (args.currentEvidenceActivityIds && !exactStringSetMatches(
        historical.binding.eligibleEvidenceActivityIds ?? [], args.currentEvidenceActivityIds)))) {
      serverProvenStaleBodyTaskRunProofs.set(historical.taskRunId, objectiveMappingHistoricalProviderProofDigest(historical));
    }
    // BI-926A7E90: objective mapping binds acceptance to a repository blob; a
    // historical request bound to any other artifact kind is never eligible.
    const historicalArtifact = repoBlobArtifactRef(historical.binding.artifactRef);
    if (!historicalArtifact) {
      classified.push(historical);
      continue;
    }
    const ancestorArtifact = ancestor?.artifactRef && repoBlobArtifactRef(ancestor.artifactRef);
    const isLegacyInvalid = historical.binding.workroomRef === undefined
      || historical.binding.eligibleEvidenceActivityIds === undefined;
    const eligible = isLegacyInvalid
      && Boolean(ancestorArtifact)
      && sameRepositoryPath(ancestorArtifact!, historicalArtifact)
      && ancestorArtifact!.providerBlobId === historicalArtifact.providerBlobId
      && historicalArtifact.repositoryFullName.toLowerCase()
        === args.currentArtifact.repositoryFullName.toLowerCase()
      && historicalArtifact.path === args.currentArtifact.path
      && historicalArtifact.commitSha.toLowerCase() === args.room.headSha.toLowerCase();

    if (!eligible) {
      classified.push(historical);
      continue;
    }

    const locatorKey = [
      historicalArtifact.repositoryFullName.toLowerCase(),
      historicalArtifact.commitSha.toLowerCase(),
      historicalArtifact.path,
      historicalArtifact.providerBlobId.toLowerCase(),
    ].join("\u0000");
    let verification = verificationByLocator.get(locatorKey);
    if (!verification) {
      verification = await args.verify({
        repositoryFullName: historicalArtifact.repositoryFullName,
        commitSha: historicalArtifact.commitSha,
        path: historicalArtifact.path,
        expectedBlobId: historicalArtifact.providerBlobId,
      });
      verificationByLocator.set(locatorKey, verification);
    }
    if (!verification.ok && verification.code === "IMMUTABLE_SOURCE_UNAVAILABLE") {
      return err("historical-artifact-provider-unavailable");
    }
    if (!verification.ok && verification.code === "IMMUTABLE_BLOB_MISMATCH") {
      providerProvenImpossibleTaskRunProofs.set(
        historical.taskRunId,
        objectiveMappingHistoricalProviderProofDigest(historical),
      );
    }
    classified.push(historical);
  }

  return ok({ history: classified, providerProvenImpossibleTaskRunProofs, serverProvenStaleBodyTaskRunProofs });
}

