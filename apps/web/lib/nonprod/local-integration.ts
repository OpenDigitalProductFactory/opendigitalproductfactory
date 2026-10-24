import { prisma, type Prisma } from "@dpf/db";
import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/governance/reconcile-keyed-findings";
import { recordExternalEvidence } from "@/lib/actions/external-evidence";
import {
  contractLocalCiPoolAfterGateResult,
  type PlatformConfigCircuitBreakerStore,
} from "./local-ci-pool-circuit-breaker";
import {
  recordLocalCiBuilderMemorySample,
  type BuilderCalibrationStore,
} from "./local-ci-builder-memory-calibration";
import type { NonprodOwnerProvider } from "./nonprod-owner-provider";
import type { findLocalCiEvidenceWorkroom } from "./local-ci-evidence-workroom";
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
  recordEvidence?: typeof recordExternalEvidence;
  findEvidence?: (id: string) => Promise<Awaited<ReturnType<typeof recordExternalEvidence>> | null>;
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
  writeEvidenceBlob?: import("@/lib/evidence/bounded-evidence-output").EvidenceBlobWriter;
  /** BI-903FB5F9: where measured builder peaks accumulate. Defaults to PlatformConfig. */
  builderCalibration?: BuilderCalibrationStore;
  /** BI-C9912C22: where the gated branch's Workroom is found. Defaults to prisma. */
  workroom?: Parameters<typeof findLocalCiEvidenceWorkroom>[0];
};

/**
 * BI-F5344F65. `scripts/gate-worktree.mjs` run with DPF_ALLOW_LOCAL_CI_STUB=1
 * builds nothing, yet walks the whole pass path under a real lease and reports
 * status "passed". Since BI-53B189C8 it marks that payload `evidence.testStub:
 * true`; `isTestStubGateRecord` in scripts/lib/local-ci-gate-state.mjs is the
 * same mark on the gate's local record.
 *
 * A stub run measured nothing, so nothing of it is kept: no evidence row a PR
 * could cite as Local-CI-Evidence, no pool-policy change, no builder
 * calibration. The refusal carries a stable code, which the MCP handler turns
 * into a named error, so the gate fails closed instead of holding a PASS
 * nobody built.
 *
 * The rule lives here, not in a shared module: the build-evidence pack loads
 * this file with a dynamic import, and a module imported statically on both
 * sides of that boundary made Turbopack emit two different chunks to one path.
 */
export const TEST_STUB_EVIDENCE_REFUSED = "test_stub_evidence_refused";

export class TestStubEvidenceRefusedError extends Error {
  readonly code = TEST_STUB_EVIDENCE_REFUSED;

  constructor() {
    super(
      "This local-CI result came from the DPF_ALLOW_LOCAL_CI_STUB=1 test stub, which builds nothing. "
      + "It is not recorded as evidence. Run the real gate: pnpm run pregate",
    );
    this.name = "TestStubEvidenceRefusedError";
  }
}

function isTestStubEvidence(evidence: unknown): boolean {
  return typeof evidence === "object"
    && evidence !== null
    && !Array.isArray(evidence)
    && (evidence as Record<string, unknown>).testStub === true;
}

export async function recordLocalIntegrationResult(
  input: LocalIntegrationResultInput,
  dependencies?: LocalIntegrationDependencies,
): Promise<Awaited<ReturnType<typeof recordExternalEvidence>>> {
  // Serialize publication with its lease binding. A lost HTTP acknowledgement
  // can then replay the same immutable result without creating an orphan row.
  if (!dependencies && input.leaseId && input.gateKey) {
    const { recordExternalEvidenceInStore } = await import("@/lib/observability/external-evidence-store");
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "NonProductionEnvironmentLease" WHERE "leaseId" = ${input.leaseId} FOR UPDATE`;
      return recordLocalIntegrationResult(input, {
        platformConfig: tx.platformConfig,
        builderCalibration: tx.platformConfig,
        workroom: tx.workroom,
        environmentLease: tx.nonProductionEnvironmentLease,
        recordEvidence: (value) => recordExternalEvidenceInStore(value, tx),
        findEvidence: (id) => tx.externalEvidenceRecord.findUnique({ where: { id } }),
      });
    }, { timeout: 30_000 });
  }
  dependencies ??= { platformConfig: prisma.platformConfig, environmentLease: prisma.nonProductionEnvironmentLease };
  const inputFingerprint = createHash("sha256").update(stableStringify(input)).digest("hex");
  // BI-F5344F65: first, before any lease, pool or evidence write.
  if (isTestStubEvidence(input.evidence)) {
    throw new TestStubEvidenceRefusedError();
  }
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
    if (lease.ownerSessionId !== input.externalSessionId || lease.ownerProvider !== input.provider) {
      throw new Error("Only the Local-CI lease owner may record gate evidence");
    }
    if (lease.status !== "active" && lease.status !== "released") {
      throw new Error("Local-CI gate evidence requires the canonical executor lease");
    }
    if (lease.evidenceRecordId) {
      const prior = await (dependencies.findEvidence ?? ((id) => prisma.externalEvidenceRecord.findUnique({ where: { id } })))(lease.evidenceRecordId);
      const details = prior?.details as Record<string, unknown> | null;
      const sameContent = details?.inputFingerprint
        ? details.inputFingerprint === inputFingerprint
        : stableStringify(details?.evidence) === stableStringify(input.evidence);
      if (!prior || prior.actorUserId !== input.actorUserId || prior.provider !== input.provider
        || prior.target !== input.candidateBranch || prior.operationType !== "local_integration_ci"
        || details?.gateKey !== gateKey || details?.leaseId !== leaseId
        || details?.externalSessionId !== input.externalSessionId || details?.status !== input.status || !sameContent) {
        throw new Error("Local-CI evidence replay conflicts with the canonical receipt");
      }
      return prior;
    }
  }
  // BI-39AAE9B8: the full console output leaves the JSON column. The record
  // keeps a head+tail excerpt (still a string, so every existing reader works)
  // plus {sha256, storageKey, sizeBytes}; the bytes live once in the
  // content-addressed blob store, shared with the ToolExecution ledger copy.
  const { offloadEvidenceOutput, projectLocalCiObservationTails } = await import("@/lib/evidence/bounded-evidence-output");
  const blobOptions = {
    ...(dependencies.writeEvidenceBlob ? { writeBlob: dependencies.writeEvidenceBlob } : {}),
  };
  const projectedEvidence = await projectLocalCiObservationTails(input.evidence, blobOptions);
  const boundedEvidence = await offloadEvidenceOutput(projectedEvidence, blobOptions);
  const evidenceObject = boundedEvidence && typeof boundedEvidence === "object"
    && !Array.isArray(boundedEvidence)
    ? boundedEvidence as Record<string, unknown>
    : null;

  const circuitBreaker = await contractLocalCiPoolAfterGateResult({
    platformConfig: dependencies.platformConfig,
    status: input.status,
    evidence: input.evidence,
  });
  // BI-903FB5F9: only a canonical leased gate run measured the real builder,
  // so only it feeds the admission reserve. Best-effort: calibration refines
  // admission and is never a reason to lose the gate's verdict.
  const builderMemoryCalibration = gateKey && leaseId
    ? (await recordLocalCiBuilderMemorySample({
      platformConfig: dependencies.builderCalibration ?? prisma.platformConfig,
      evidence: input.evidence,
      now: new Date(),
    }).catch(() => ({ status: "error" as const }))).status
    : "not-leased";
  if (circuitBreaker.status === "concurrent-update-exhausted") {
    throw new Error(
      "Local-CI capacity circuit breaker could not persist a safe singleton policy",
    );
  }

  // Loaded like the blob writer above: a dynamic import keeps this module's
  // static graph unchanged across the build-evidence pack's dynamic boundary.
  const { findLocalCiEvidenceWorkroom } = await import("./local-ci-evidence-workroom");
  const room = typeof evidenceObject?.headTreeHash === "string"
    ? await findLocalCiEvidenceWorkroom(dependencies.workroom ?? prisma.workroom, {
      branch: input.candidateBranch, sha: String(evidenceObject.sha ?? ""), sessionId: input.externalSessionId,
    })
    : undefined;
  const result = await (dependencies.recordEvidence ?? recordExternalEvidence)({
    ...(room !== undefined ? { workCapsuleId: room && room !== "ambiguous" ? room.id : undefined } : {}),
    actorUserId: input.actorUserId,
    routeContext: input.routeContext,
    operationType: "local_integration_ci",
    target: input.candidateBranch,
    provider: input.provider,
    resultSummary: input.summary,
    buildId: input.buildId,
    taskRunId: input.taskRunId,
    details: {
      ...(gateKey && leaseId ? { inputFingerprint } : {}),
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
      builderMemoryCalibration,
      evidence: boundedEvidence,
    } as Prisma.InputJsonValue,
  });
  if (gateKey && leaseId) {
    const binding = await environmentLease.updateMany({
      where: {
        leaseId,
        claimKey: `gate:${gateKey}`,
        ownerSessionId: input.externalSessionId,
        ownerProvider: input.provider,
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
