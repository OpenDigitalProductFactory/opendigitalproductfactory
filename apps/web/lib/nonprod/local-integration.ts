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
};

type LocalIntegrationDependencies = {
  platformConfig: PlatformConfigCircuitBreakerStore;
};

export async function recordLocalIntegrationResult(
  input: LocalIntegrationResultInput,
  dependencies: LocalIntegrationDependencies = {
    platformConfig: prisma.platformConfig,
  },
) {
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

  return recordExternalEvidence({
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
      capacityCircuitBreaker: circuitBreaker.status,
      evidence: input.evidence,
    } as Prisma.InputJsonValue,
  });
}
