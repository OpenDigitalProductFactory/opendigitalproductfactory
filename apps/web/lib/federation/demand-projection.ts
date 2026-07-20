import {
  computeDemandPayloadDigest,
  validateDemandEnvelopeV1,
  type DemandAttribution,
  type DemandAudience,
  type DemandEnvelopeV1,
} from "@dpf/db/federated-demand-contract";
import {
  assertNoExcludedEgress,
  projectEstatePayload,
  type ProjectionContractSpec,
} from "@dpf/db/projection-serialization";

import { deriveDemandNetworkRefs, type FederationIdentity } from "./demand-identity";

export interface ProjectableDemandSource {
  localRecordRef: string;
  title: string;
  summary: string;
  workType?: string | null;
  occurrenceCount: number;
  product?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Build only the minimized network contract; the raw BacklogItem never reaches the transport. */
export function buildDemandEnvelope(input: {
  source: ProjectableDemandSource;
  identity: FederationIdentity;
  contract: ProjectionContractSpec;
  audience: DemandAudience;
  attribution: DemandAttribution;
  forwarding?: DemandEnvelopeV1["forwarding"];
}): { envelope: DemandEnvelopeV1; violations: string[] } {
  const refs = deriveDemandNetworkRefs(input.identity, input.source.localRecordRef);
  const candidate: DemandEnvelopeV1 = {
    specVersion: "dpf.demand/1",
    ...refs,
    originInstallationId: input.identity.installationId,
    originVersion: Math.max(1, input.source.updatedAt.getTime()),
    route: [],
    audience: input.audience,
    title: input.source.title.slice(0, 240),
    summary: (input.source.summary.trim() || "Shared demand").slice(0, 4_000),
    ...(input.source.workType ? { workType: input.source.workType } : {}),
    ...(input.source.product ? { applicability: { product: input.source.product } } : {}),
    signal: { occurrenceCount: Math.max(0, input.source.occurrenceCount) },
    attribution: input.attribution,
    ...(input.forwarding ? { forwarding: input.forwarding } : {}),
    createdAt: input.source.createdAt.toISOString(),
    updatedAt: input.source.updatedAt.toISOString(),
    payloadDigest: "sha256:pending",
  };

  const firstProjection = projectEstatePayload(input.contract, { demand: candidate });
  candidate.payloadDigest = computeDemandPayloadDigest(
    firstProjection.projected.demand as DemandEnvelopeV1,
  );

  const projection = projectEstatePayload(input.contract, { demand: candidate });
  const envelope = projection.projected.demand as DemandEnvelopeV1;
  const violations = [
    ...assertNoExcludedEgress(input.contract, projection.projected),
    ...validateDemandEnvelopeV1(envelope),
  ];
  return { envelope, violations };
}
