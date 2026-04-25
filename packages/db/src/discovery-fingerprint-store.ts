import type { BlastRadiusTier, RedactionStatus } from "./discovery-fingerprint-types";

type PrismaWriteAction<TResult = unknown> = (args: unknown) => Promise<TResult>;

export type FingerprintStoreClient = {
  discoveryFingerprintObservation: {
    upsert: PrismaWriteAction;
    update: PrismaWriteAction;
  };
  discoveryFingerprintReview: {
    create: PrismaWriteAction;
  };
  discoveryFingerprintRule: {
    update: PrismaWriteAction;
  };
};

type FingerprintObservationUpsertClient = {
  discoveryFingerprintObservation: {
    upsert: PrismaWriteAction;
  };
};

type FingerprintReviewCreateClient = {
  discoveryFingerprintReview: {
    create: PrismaWriteAction;
  };
};

type FingerprintRuleActivationClient = {
  discoveryFingerprintObservation: {
    update: PrismaWriteAction;
  };
  discoveryFingerprintRule: {
    update: PrismaWriteAction;
  };
};

export type UpsertFingerprintObservationInput = {
  observationKey: string;
  sourceKind: string;
  signalClass: string;
  protocol?: string | null;
  inventoryEntityId?: string | null;
  discoveryRunId?: string | null;
  rawEvidenceLocal?: unknown;
  normalizedEvidence: unknown;
  redactionStatus: RedactionStatus;
  evidenceFamilies: string[];
  identityCandidates?: unknown;
  taxonomyCandidates?: unknown;
  identityConfidence?: number | null;
  taxonomyConfidence?: number | null;
  candidateMargin?: number | null;
  blastRadiusTier?: BlastRadiusTier;
  decisionStatus?: string;
  reviewReason?: string | null;
};

export type RecordFingerprintReviewInput = {
  observationId: string;
  reviewerType: string;
  reviewerId?: string | null;
  decision: string;
  reason?: string | null;
  previousStatus?: string | null;
  nextStatus: string;
  auditPayload?: unknown;
};

export type ActivateFingerprintRuleInput = {
  ruleId: string;
  observationId: string;
};

export async function upsertFingerprintObservation(
  db: FingerprintObservationUpsertClient,
  input: UpsertFingerprintObservationInput,
): Promise<unknown> {
  const updateData = {
    inventoryEntityId: input.inventoryEntityId,
    discoveryRunId: input.discoveryRunId,
    sourceKind: input.sourceKind,
    signalClass: input.signalClass,
    protocol: input.protocol,
    rawEvidenceLocal: input.rawEvidenceLocal,
    normalizedEvidence: input.normalizedEvidence,
    redactionStatus: input.redactionStatus,
    evidenceFamilies: input.evidenceFamilies,
    identityCandidates: input.identityCandidates ?? [],
    taxonomyCandidates: input.taxonomyCandidates ?? [],
    identityConfidence: input.identityConfidence,
    taxonomyConfidence: input.taxonomyConfidence,
    candidateMargin: input.candidateMargin,
    blastRadiusTier: input.blastRadiusTier ?? "medium",
    decisionStatus: input.decisionStatus ?? "pending",
    reviewReason: input.reviewReason,
    lastSeenAt: new Date(),
  };

  return db.discoveryFingerprintObservation.upsert({
    where: { observationKey: input.observationKey },
    create: {
      observationKey: input.observationKey,
      ...updateData,
    },
    update: updateData,
  });
}

export async function recordFingerprintReview(
  db: FingerprintReviewCreateClient,
  input: RecordFingerprintReviewInput,
): Promise<unknown> {
  return db.discoveryFingerprintReview.create({
    data: {
      observationId: input.observationId,
      reviewerType: input.reviewerType,
      reviewerId: input.reviewerId,
      decision: input.decision,
      reason: input.reason,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
      auditPayload: input.auditPayload ?? {},
    },
  });
}

export async function activateFingerprintRule(
  db: FingerprintRuleActivationClient,
  input: ActivateFingerprintRuleInput,
): Promise<void> {
  await db.discoveryFingerprintRule.update({
    where: { id: input.ruleId },
    data: { status: "active" },
  });
  await db.discoveryFingerprintObservation.update({
    where: { id: input.observationId },
    data: {
      approvedRuleId: input.ruleId,
      decisionStatus: "approved",
    },
  });
}
