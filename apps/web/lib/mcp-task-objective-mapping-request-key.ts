import { createHash } from "node:crypto";

import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { canonicalJson } from "./shared/canonical-json";

const OBJECTIVE_MAPPING_KEY_VERSION = 2;
const ACTIVE_ENVELOPE_STATUSES = new Set(["proposed", "approved"]);

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
  objective: string;
  idempotencyKey: string;
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

function normalizedPacket(packet: ObjectiveMappingRequestPacket) {
  return {
    schemaVersion: OBJECTIVE_MAPPING_KEY_VERSION,
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

function requestIdentityDigest(packet: ObjectiveMappingRequestPacket): string {
  return createHash("sha256").update(canonicalJson(normalizedPacket(packet))).digest("hex");
}

export function createObjectiveMappingRequestKey(packet: ObjectiveMappingRequestPacket): string {
  const { itemId, workroomRef } = packet.binding;
  return `initiative-readiness:${itemId}:objective-mapping:${workroomRef.headSha}:packet-v${OBJECTIVE_MAPPING_KEY_VERSION}:${requestIdentityDigest(packet)}`;
}

export function validateObjectiveMappingRequestKey(
  packet: ObjectiveMappingRequestPacket & { requestKey: string },
): boolean {
  return packet.requestKey === createObjectiveMappingRequestKey(packet);
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

/**
 * Authorize one server-issued objective-mapping request identity against the
 * immutable history at the same item/head. Old malformed packets remain audit
 * history, but cannot reserve the one valid request identity forever.
 */
export function authorizeObjectiveMappingRequestKeyEvolution(input: {
  packet: ObjectiveMappingRequestPacket & { requestKey: string };
  history: readonly ObjectiveMappingRequestHistory[];
}): ObjectiveMappingEvolutionResult {
  if (!validateObjectiveMappingRequestKey(input.packet)) {
    return { authorized: false, reason: "invalid-server-request-key" };
  }

  for (const historical of input.history) {
    if (
      historical.binding.itemId !== input.packet.binding.itemId
      || historical.binding.gate !== "objective-mapping"
      || historical.binding.writerToolName !== input.packet.binding.writerToolName
      || historical.binding.expectedCurrentBaselineId !== input.packet.binding.expectedCurrentBaselineId
      || !exactArtifactMatches(input.packet.binding.artifactRef, historical.binding.artifactRef)
      || !historicalWorkroomMatches(input.packet, historical)
    ) {
      return { authorized: false, reason: "immutable-identity-conflict", taskRunId: historical.taskRunId };
    }

    if (historical.idempotencyKey === input.packet.requestKey) continue;

    if (historical.actionEnvelopeStatuses.some((status) => ACTIVE_ENVELOPE_STATUSES.has(status))) {
      return { authorized: false, reason: "prior-authority-active", taskRunId: historical.taskRunId };
    }

    // A writer from a packet that never carried the required evidence or
    // Workroom identity is retained for audit, but is not authoritative for
    // the now-valid packet. This is the exact BI-2B live fixture.
    if (!isLegacyInvalidBinding(historical.binding)
      && historical.writerExecutions.some((execution) => execution.success || execution.hasReceipt)) {
      return { authorized: false, reason: "authoritative-output-exists", taskRunId: historical.taskRunId };
    }
  }

  return { authorized: true };
}
