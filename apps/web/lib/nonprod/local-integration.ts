import { prisma, type Prisma } from "@dpf/db";
import { recordExternalEvidence } from "@/lib/actions/external-evidence";
import {
  contractLocalCiPoolAfterGateResult,
  type PlatformConfigCircuitBreakerStore,
} from "./local-ci-pool-circuit-breaker";
import type { NonprodOwnerProvider } from "./nonprod-owner-provider";
import type { LocalIntegrationStatus } from "../../../../scripts/lib/local-integration-status.mjs";

export type LocalIntegrationResultInput = {
  actorUserId: string;
  provider: NonprodOwnerProvider;
  externalSessionId: string;
  routeContext: string;
  buildId?: string;
  taskRunId?: string;
  candidateBranch: string;
  mode: "single-branch" | "sibling-set" | "post-merge-main";
  // Every `blocked_*` status is a gate/infrastructure defect, not a product
  // failure: the sandbox's dependency graph did not match the lockfile
  // (BI-ECDF9520), the control plane degraded, or the build child was killed by
  // a signal. The set is shared with the gate scripts so the producer and the
  // recorder cannot drift apart again (BI-C59AC8AF).
  status: LocalIntegrationStatus;
  summary: string;
  evidence: Prisma.InputJsonValue;
  gateKey?: string;
  leaseId?: string;
};

type LocalIntegrationDependencies = {
  platformConfig: PlatformConfigCircuitBreakerStore;
  environmentLease?: Pick<
    typeof prisma.nonProductionEnvironmentLease,
    "findUnique" | "updateMany"
  >;
  /**
   * BI-39AAE9B8: writes an oversized evidence.output to the content-addressed
   * blob store. Defaults to the real writer; tests inject a fake. Small outputs
   * never reach it.
   */
  writeEvidenceBlob?: import("@/lib/evidence/bounded-output").EvidenceBlobWriter;
};

export async function recordLocalIntegrationResult(
  input: LocalIntegrationResultInput,
  dependencies: LocalIntegrationDependencies = {
    platformConfig: prisma.platformConfig,
    environmentLease: prisma.nonProductionEnvironmentLease,
  },
) {
  const gateKey = input.gateKey?.trim().toLowerCase();
  const leaseId = input.leaseId?.trim();
  if (Boolean(gateKey) !== Boolean(leaseId)) {
    throw new Error("Local-CI gateKey and leaseId must be supplied together");
  }
  const environmentLease = dependencies.environmentLease
    ?? prisma.nonProductionEnvironmentLease;
  if (gateKey && leaseId) {
    if (!/^[0-9a-f]{64}$/.test(gateKey)) {
      throw new Error("Invalid Local-CI gate key");
    }
    const lease = await environmentLease.findUnique({ where: { leaseId } });
    if (!lease || lease.claimKey !== `gate:${gateKey}`) {
      throw new Error("Local-CI lease does not match the immutable gate key");
    }
    if (lease.ownerSessionId !== input.externalSessionId) {
      throw new Error("Only the Local-CI lease owner may record gate evidence");
    }
    if (lease.status !== "active" && lease.status !== "released") {
      throw new Error("Local-CI gate evidence requires the canonical executor lease");
    }
  }
  // BI-39AAE9B8: the full console output leaves the JSON column. The record
  // keeps a head+tail excerpt (still a string, so every existing reader works)
  // plus {sha256, storageKey, sizeBytes}; the bytes live once in the
  // content-addressed blob store, shared with the ToolExecution ledger copy.
  const { offloadEvidenceOutput } = await import("@/lib/evidence/bounded-output");
  const boundedEvidence = await offloadEvidenceOutput(input.evidence, {
    ...(dependencies.writeEvidenceBlob ? { writeBlob: dependencies.writeEvidenceBlob } : {}),
  });
  const evidenceObject = boundedEvidence && typeof boundedEvidence === "object"
    && !Array.isArray(boundedEvidence)
    ? boundedEvidence as Record<string, unknown>
    : null;

  const circuitBreaker = await contractLocalCiPoolAfterGateResult({
    platformConfig: dependencies.platformConfig,
    status: input.status,
    evidence: input.evidence,
  });
  if (circuitBreaker.status === "concurrent-update-exhausted") {
    throw new Error(
      "Local-CI capacity circuit breaker could not persist a safe singleton policy",
    );
  }

  const result = await recordExternalEvidence({
    ...(typeof evidenceObject?.headTreeHash === "string" ? {
      workCapsuleId: (await prisma.workroom.findFirst({ where: {
        headBranch: input.candidateBranch, headSha: String(evidenceObject.sha ?? ""),
        executorRef: input.externalSessionId, archivedAt: null,
      }, select: { id: true } }))?.id,
    } : {}),
    actorUserId: input.actorUserId,
    routeContext: input.routeContext,
    operationType: "local_integration_ci",
    target: input.candidateBranch,
    provider: input.provider,
    resultSummary: input.summary,
    buildId: input.buildId,
    taskRunId: input.taskRunId,
    details: {
      externalSessionId: input.externalSessionId,
      mode: input.mode,
      status: input.status,
      ...(gateKey && leaseId
        ? {
          gateKey,
          leaseId,
          evidenceValidity: evidenceObject?.evidenceValidity ?? null,
        }
        : {}),
      capacityCircuitBreaker: circuitBreaker.status,
      evidence: boundedEvidence,
    } as Prisma.InputJsonValue,
  });
  if (gateKey && leaseId) {
    const binding = await environmentLease.updateMany({
      where: {
        leaseId,
        claimKey: `gate:${gateKey}`,
        ownerSessionId: input.externalSessionId,
        evidenceRecordId: null,
      },
      data: { evidenceRecordId: result.id },
    });
    if (binding.count !== 1) {
      throw new Error("Local-CI evidence could not bind to the canonical lease");
    }
  }
  return result;
}
