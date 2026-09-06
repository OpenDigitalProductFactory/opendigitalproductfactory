import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { canonicalJson } from "./shared/canonical-json";

const OBJECTIVE_MAPPING_KEY_VERSION = 3;
const LEGACY_OBJECTIVE_MAPPING_KEY_VERSION = 2;
const OBJECTIVE_MAPPING_KEY_DOMAIN = "dpf.objective-mapping.request-key.v3";
const TEST_ONLY_OBJECTIVE_MAPPING_KEY_SECRET = "dpf-objective-mapping-request-key-test-only-v1";
const ACTIVE_ENVELOPE_STATUSES = new Set(["proposed", "approved"]);
const ACTIVE_TASK_RUN_STATUSES = new Set([
  "submitted",
  "working",
  "input-required",
  "auth-required",
  "pending",
  "quiescing",
  "stalled",
]);

export type ObjectiveMappingBinding = InitiativeReviewBinding & {
  gate: "objective-mapping";
  eligibleEvidenceActivityIds: string[];
  workroomRef: NonNullable<InitiativeReviewBinding["workroomRef"]>;
};

export type ObjectiveMappingRequestPacket = {
  targetAgent: string;
  objective: string;
  questionPacketSummary: string;
  requiredToolNames: string[];
  binding: ObjectiveMappingBinding;
};

export type ObjectiveMappingRequestHistory = {
  taskRunId: string;
  status: string;
  targetAgent: string;
  objective: string;
  questionPacketSummary: string;
  idempotencyKey: string;
  requiredToolNames: string[];
  binding: {
    writerToolName: string;
    itemId: string;
    gate: "objective-mapping";
    expectedCurrentBaselineId?: string | null;
    eligibleEvidenceActivityIds?: string[];
    workroomRef?: NonNullable<InitiativeReviewBinding["workroomRef"]>;
    artifactRef: InitiativeReviewBinding["artifactRef"];
  };
  actionEnvelopeStatuses: string[];
  writerExecutions: Array<{ success: boolean; hasReceipt: boolean }>;
};

export type ObjectiveMappingEvolutionRefusal =
  | "invalid-server-request-key"
  | "immutable-identity-conflict"
  | "prior-authority-active"
  | "authoritative-output-exists";

export type ObjectiveMappingEvolutionResult =
  | { authorized: true }
  | { authorized: false; reason: ObjectiveMappingEvolutionRefusal; taskRunId?: string };

function normalizedPacket(packet: ObjectiveMappingRequestPacket, schemaVersion = OBJECTIVE_MAPPING_KEY_VERSION) {
  return {
    schemaVersion,
    targetAgent: packet.targetAgent.trim(),
    objective: packet.objective.trim(),
    questionPacketSummary: packet.questionPacketSummary.trim(),
    requiredToolNames: [...new Set(packet.requiredToolNames.map((name) => name.trim()))].sort(),
    binding: {
      writerToolName: packet.binding.writerToolName,
      itemId: packet.binding.itemId,
      gate: packet.binding.gate,
      expectedCurrentBaselineId: packet.binding.expectedCurrentBaselineId ?? null,
      eligibleEvidenceActivityIds: [...packet.binding.eligibleEvidenceActivityIds].sort(),
      workroomRef: packet.binding.workroomRef,
      artifactRef: packet.binding.artifactRef,
    },
  };
}

function legacyRequestIdentityDigest(packet: ObjectiveMappingRequestPacket): string {
  return createHash("sha256")
    .update(canonicalJson(normalizedPacket(packet, LEGACY_OBJECTIVE_MAPPING_KEY_VERSION)))
    .digest("hex");
}

function objectiveMappingRequestKeySecret(): string | null {
  for (const name of ["DPF_OBJECTIVE_MAPPING_REQUEST_KEY_SECRET", "AUTH_SECRET", "NEXTAUTH_SECRET"] as const) {
    const secret = process.env[name];
    if (typeof secret === "string" && secret.trim().length > 0) return secret;
  }
  return process.env.NODE_ENV === "test" ? TEST_ONLY_OBJECTIVE_MAPPING_KEY_SECRET : null;
}

function authenticatedRequestIdentityDigest(
  packet: ObjectiveMappingRequestPacket,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(OBJECTIVE_MAPPING_KEY_DOMAIN)
    .update("\0")
    .update(canonicalJson(normalizedPacket(packet)))
    .digest("hex");
}

function exactKeyMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function requestKey(
  packet: ObjectiveMappingRequestPacket,
  version: number,
  digest: string,
): string {
  const { itemId, workroomRef } = packet.binding;
  return `initiative-readiness:${itemId}:objective-mapping:${workroomRef.headSha}:packet-v${version}:${digest}`;
}

function normalizedToolNames(names: readonly string[]): string[] {
  return [...new Set(names.map((name) => name.trim()))].sort();
}

function exactToolNamesMatch(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = normalizedToolNames(left);
  const normalizedRight = normalizedToolNames(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((name, index) => name === normalizedRight[index]);
}

export function createObjectiveMappingRequestKey(packet: ObjectiveMappingRequestPacket): string {
  const secret = objectiveMappingRequestKeySecret();
  if (!secret) {
    throw new Error(
      "Objective-mapping request-key signing requires DPF_OBJECTIVE_MAPPING_REQUEST_KEY_SECRET, AUTH_SECRET, or NEXTAUTH_SECRET.",
    );
  }
  return requestKey(
    packet,
    OBJECTIVE_MAPPING_KEY_VERSION,
    authenticatedRequestIdentityDigest(packet, secret),
  );
}

export function validateObjectiveMappingRequestKey(
  packet: ObjectiveMappingRequestPacket & { requestKey: string },
): boolean {
  const secret = objectiveMappingRequestKeySecret();
  if (!secret) return false;
  const expected = requestKey(
    packet,
    OBJECTIVE_MAPPING_KEY_VERSION,
    authenticatedRequestIdentityDigest(packet, secret),
  );
  return exactKeyMatches(packet.requestKey, expected);
}

/**
 * Validate immutable persisted history without making a legacy self-hash
 * admissible as new work. Callers must use validateObjectiveMappingRequestKey
 * at every dispatch/admission boundary.
 */
export function validateHistoricalObjectiveMappingRequestKey(
  packet: ObjectiveMappingRequestPacket & { requestKey: string },
): boolean {
  if (validateObjectiveMappingRequestKey(packet)) return true;
  const expectedLegacy = requestKey(
    packet,
    LEGACY_OBJECTIVE_MAPPING_KEY_VERSION,
    legacyRequestIdentityDigest(packet),
  );
  return exactKeyMatches(packet.requestKey, expectedLegacy);
}

function exactArtifactMatches(
  current: ObjectiveMappingBinding["artifactRef"],
  historical: InitiativeReviewBinding["artifactRef"],
): boolean {
  return current.kind === historical.kind
    && current.repositoryFullName === historical.repositoryFullName
    && current.commitSha === historical.commitSha
    && current.path === historical.path
    && current.providerBlobId === historical.providerBlobId;
}

function historicalWorkroomMatches(
  packet: ObjectiveMappingRequestPacket,
  historical: ObjectiveMappingRequestHistory,
): boolean {
  const expected = packet.binding.workroomRef;
  const recorded = historical.binding.workroomRef;
  if (recorded) {
    return recorded.kind === expected.kind
      && recorded.workroomId === expected.workroomId
      && recorded.repositoryFullName === expected.repositoryFullName
      && recorded.branchName === expected.branchName
      && recorded.headSha === expected.headSha;
  }

  const exactLegacyIdentity = `in ${expected.workroomId} on ${expected.repositoryFullName}#${expected.branchName} at Workroom head ${expected.headSha}`;
  return historical.objective.includes(exactLegacyIdentity)
    && historical.idempotencyKey === `initiative-readiness:${packet.binding.itemId}:objective-mapping:${expected.headSha}`;
}

function isLegacyInvalidBinding(binding: ObjectiveMappingRequestHistory["binding"]): boolean {
  return binding.workroomRef === undefined || binding.eligibleEvidenceActivityIds === undefined;
}

function historicalRequestKeyIsValid(historical: ObjectiveMappingRequestHistory): boolean {
  if (isLegacyInvalidBinding(historical.binding)) return true;
  return validateHistoricalObjectiveMappingRequestKey({
    targetAgent: historical.targetAgent,
    objective: historical.objective,
    questionPacketSummary: historical.questionPacketSummary,
    requiredToolNames: historical.requiredToolNames,
    binding: historical.binding as ObjectiveMappingBinding,
    requestKey: historical.idempotencyKey,
  });
}

function sameArtifactCorpus(
  current: ObjectiveMappingBinding["artifactRef"],
  historical: InitiativeReviewBinding["artifactRef"],
): boolean {
  return current.kind === historical.kind
    && current.repositoryFullName === historical.repositoryFullName
    && current.path === historical.path;
}

export function objectiveMappingHistoricalProviderProofDigest(
  historical: ObjectiveMappingRequestHistory,
): string {
  return createHash("sha256").update(canonicalJson({
    expectedCurrentBaselineId: historical.binding.expectedCurrentBaselineId ?? null,
    legacyShape: isLegacyInvalidBinding(historical.binding),
    artifactRef: historical.binding.artifactRef,
  })).digest("hex");
}

function isProviderProvenImpossibleLegacy(
  packet: ObjectiveMappingRequestPacket,
  historical: ObjectiveMappingRequestHistory,
  providerProvenImpossibleTaskRunProofs: ReadonlyMap<string, string>,
): boolean {
  const currentBaselineId = packet.binding.expectedCurrentBaselineId ?? null;
  const historicalBaselineId = historical.binding.expectedCurrentBaselineId ?? null;
  return providerProvenImpossibleTaskRunProofs.get(historical.taskRunId)
      === objectiveMappingHistoricalProviderProofDigest(historical)
    && isLegacyInvalidBinding(historical.binding)
    && sameArtifactCorpus(packet.binding.artifactRef, historical.binding.artifactRef)
    && historical.binding.artifactRef.commitSha === packet.binding.workroomRef.headSha
    && historicalBaselineId !== null
    && historicalBaselineId !== currentBaselineId;
}

/**
 * Authorize one server-issued objective-mapping request identity against the
 * immutable history at the same item/head. Old malformed packets remain audit
 * history, but cannot reserve the one valid request identity forever.
 */
export function authorizeObjectiveMappingRequestKeyEvolution(input: {
  packet: ObjectiveMappingRequestPacket & { requestKey: string };
  history: readonly ObjectiveMappingRequestHistory[];
  /** Server-only proof digests independently derived from provider responses. */
  providerProvenImpossibleTaskRunProofs?: ReadonlyMap<string, string>;
  /** Prospective token-bound TaskRun identity for action-time creation. */
  expectedTaskRunId?: string;
}): ObjectiveMappingEvolutionResult {
  if (!validateObjectiveMappingRequestKey(input.packet)) {
    return { authorized: false, reason: "invalid-server-request-key" };
  }

  for (const historical of input.history) {
    // Structural authority is never relaxed by a provider disposition. The
    // disposition can release only the baseline/blob identity that the server
    // independently proved impossible; it cannot mask a different item, tool,
    // Workroom, repository, or path.
    if (historical.targetAgent !== input.packet.targetAgent.trim()
      || historical.objective.trim() !== input.packet.objective.trim()
      || historical.questionPacketSummary.trim() !== input.packet.questionPacketSummary.trim()
      || !exactToolNamesMatch(historical.requiredToolNames, input.packet.requiredToolNames)
      || historical.binding.itemId !== input.packet.binding.itemId
      || historical.binding.gate !== "objective-mapping"
      || historical.binding.writerToolName !== input.packet.binding.writerToolName
      || !historicalWorkroomMatches(input.packet, historical)
      || !sameArtifactCorpus(input.packet.binding.artifactRef, historical.binding.artifactRef)
      || (!isLegacyInvalidBinding(historical.binding)
        && !exactToolNamesMatch(
          historical.binding.eligibleEvidenceActivityIds ?? [],
          input.packet.binding.eligibleEvidenceActivityIds,
        ))
      || !historicalRequestKeyIsValid(historical)) {
      return { authorized: false, reason: "immutable-identity-conflict", taskRunId: historical.taskRunId };
    }

    const exactIdentity = historical.binding.expectedCurrentBaselineId === input.packet.binding.expectedCurrentBaselineId
      && exactArtifactMatches(input.packet.binding.artifactRef, historical.binding.artifactRef);
    const providerProvenImpossibleLegacy = isProviderProvenImpossibleLegacy(
      input.packet,
      historical,
      input.providerProvenImpossibleTaskRunProofs ?? new Map(),
    );
    if (!exactIdentity && !providerProvenImpossibleLegacy) {
      return { authorized: false, reason: "immutable-identity-conflict", taskRunId: historical.taskRunId };
    }

    if (historical.idempotencyKey === input.packet.requestKey) {
      if (input.expectedTaskRunId && historical.taskRunId !== input.expectedTaskRunId) {
        return { authorized: false, reason: "immutable-identity-conflict", taskRunId: historical.taskRunId };
      }
      continue;
    }

    if (historical.actionEnvelopeStatuses.some((status) => ACTIVE_ENVELOPE_STATUSES.has(status))) {
      return { authorized: false, reason: "prior-authority-active", taskRunId: historical.taskRunId };
    }

    const quiescentLegacyWait = historical.status === "input-required"
      && isLegacyInvalidBinding(historical.binding);
    if (!providerProvenImpossibleLegacy
      && !quiescentLegacyWait
      && ACTIVE_TASK_RUN_STATUSES.has(historical.status)) {
      return { authorized: false, reason: "prior-authority-active", taskRunId: historical.taskRunId };
    }

    // A writer from a packet that never carried the required evidence or
    // Workroom identity is retained for audit, but is not authoritative for
    // the now-valid packet. This is the exact BI-2B live fixture.
    if ((providerProvenImpossibleLegacy || !isLegacyInvalidBinding(historical.binding))
      && historical.writerExecutions.some((execution) => execution.success || execution.hasReceipt)) {
      return { authorized: false, reason: "authoritative-output-exists", taskRunId: historical.taskRunId };
    }
  }

  return { authorized: true };
}
