import {
  OPERATIONAL_POSTURE_PROJECTION_TEMPLATE,
  computeOperationalPosturePayloadDigest,
  validateOperationalPostureV1,
  type OperationalPostureV1,
  type PostureHealthRollupV1,
  type PosturePatchSummaryV1,
  type PostureResourceFootprintV1,
  type PostureRuntimeSummaryV1,
} from "@dpf/db/federated-operational-posture-contract";
import {
  assertNoExcludedEgress,
  projectEstatePayload,
  type ProjectionContractSpec,
} from "@dpf/db/projection-serialization";

import type { FederationIdentity } from "./demand-identity";

export interface ProjectableOperationalPostureSource {
  servedVersion: string;
  servedSha: string;
  patchPosture: PosturePatchSummaryV1;
  health: PostureHealthRollupV1;
  runtime: PostureRuntimeSummaryV1;
  resourceFootprint?: PostureResourceFootprintV1;
  capturedAt: Date;
  updatedAt: Date;
}

const clampInt = (value: number): number => Math.max(0, Math.trunc(value));

/**
 * Build only the minimized, read-only posture record; the raw estate never reaches
 * the transport. The canonical side is always `local` — the reporting install owns
 * its posture — so there is no per-record opaque ref to derive (unlike demand): a
 * singleton posture is identified by its origin install alone.
 */
export function buildOperationalPostureRecord(input: {
  source: ProjectableOperationalPostureSource;
  identity: FederationIdentity;
  contract?: ProjectionContractSpec;
}): { record: OperationalPostureV1; violations: string[] } {
  const contract = input.contract ?? OPERATIONAL_POSTURE_PROJECTION_TEMPLATE;
  const candidate: OperationalPostureV1 = {
    specVersion: "dpf.operational-posture/1",
    originInstallationId: input.identity.installationId,
    originVersion: Math.max(1, input.source.updatedAt.getTime()),
    servedVersion: input.source.servedVersion,
    servedSha: input.source.servedSha,
    patchPosture: {
      critical: clampInt(input.source.patchPosture.critical),
      high: clampInt(input.source.patchPosture.high),
      medium: clampInt(input.source.patchPosture.medium),
      low: clampInt(input.source.patchPosture.low),
    },
    health: {
      status: input.source.health.status,
      estateItemCount: clampInt(input.source.health.estateItemCount),
    },
    runtime: {
      targetCount: clampInt(input.source.runtime.targetCount),
      healthyCount: clampInt(input.source.runtime.healthyCount),
    },
    ...(input.source.resourceFootprint ? { resourceFootprint: input.source.resourceFootprint } : {}),
    capturedAt: input.source.capturedAt.toISOString(),
    payloadDigest: "sha256:pending",
  };

  const firstProjection = projectEstatePayload(contract, { posture: candidate });
  candidate.payloadDigest = computeOperationalPosturePayloadDigest(
    firstProjection.projected.posture as OperationalPostureV1,
  );

  const projection = projectEstatePayload(contract, { posture: candidate });
  const record = projection.projected.posture as OperationalPostureV1;
  const violations = [
    ...assertNoExcludedEgress(contract, projection.projected),
    ...validateOperationalPostureV1(record),
  ];
  return { record, violations };
}
