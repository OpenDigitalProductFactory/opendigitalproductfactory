import { prisma, type Prisma } from "@dpf/db";
import { recordExternalEvidence } from "@/lib/actions/external-evidence";
import {
  contractLocalCiPoolAfterGateResult,
  type PlatformConfigCircuitBreakerStore,
} from "./local-ci-pool-circuit-breaker";
import type { NonprodOwnerProvider } from "./nonprod-owner-provider";

export type LocalIntegrationResultInput = {
  actorUserId: string;
  provider: NonprodOwnerProvider;
  externalSessionId: string;
  routeContext: string;
  buildId?: string;
  taskRunId?: string;
  candidateBranch: string;
  mode: "single-branch" | "sibling-set" | "post-merge-main";
  // "blocked_sandbox_drift": the shared sandbox's installed dependency graph
  // did not match the lockfile (or was mid-install), so the gate refused to
  // produce product evidence. A sandbox defect, not a product failure (BI-ECDF9520).
  status:
    | "passed"
    | "failed"
    | "conflict"
    | "blocked_sandbox_drift"
    | "blocked_control_plane_starvation";
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
  const evidenceObject = input.evidence && typeof input.evidence === "object"
    && !Array.isArray(input.evidence)
    ? input.evidence as Record<string, unknown>
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
      evidence: input.evidence,
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
